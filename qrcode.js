/**
 * DriveStampQR — 外部依存なしの軽量 QRコード生成モジュール（ISO/IEC 18004 準拠）
 * Byteモード / 誤り訂正レベル L / Version 1〜20（最大約850バイト）対応
 */
(() => {
  'use strict';

  // EC Level L: 1ブロックあたりの誤り訂正コード語数（index = version 1..20）
  const ECC_PER_BLOCK_L = [
    0,
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18,
    20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
  ];

  // EC Level L: エラー訂正ブロック数（index = version 1..20）
  const NUM_BLOCKS_L = [
    0,
    1, 1, 1, 1, 1, 2, 2, 2, 2, 4,
    4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
  ];

  // GF(256) 乗算（原始多項式 0x11d）
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  // Reed-Solomon 生成多項式の係数を算出
  function rsComputeDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  // Reed-Solomon 剰余（誤り訂正コード語）を算出
  function rsComputeRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let j = 0; j < divisor.length; j++) {
        result[j] ^= gfMul(divisor[j], factor);
      }
    }
    return result;
  }

  // 指定バージョンの生データモジュール総数（ビット数）
  function getNumRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  // 指定バージョン（EC Level L）のデータ容量（バイト数）
  function getNumDataCodewords(ver) {
    return Math.floor(getNumRawDataModules(ver) / 8) - ECC_PER_BLOCK_L[ver] * NUM_BLOCKS_L[ver];
  }

  // アライメントパターンの座標リスト
  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }

  // ビットバッファへの書き込みヘルパー
  function appendBits(bitBuf, val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf.push((val >>> i) & 1);
    }
  }

  // UTF-8 バイト列を最小バージョンの QR マトリクスへ変換
  function encodeText(text) {
    const dataBytes = new TextEncoder().encode(String(text));

    // 格納可能な最小バージョン（1〜20）を決定
    let version = -1;
    for (let v = 1; v <= 20; v++) {
      const charCountBits = v <= 9 ? 8 : 16;
      const neededBits = 4 + charCountBits + dataBytes.length * 8;
      if (neededBits <= getNumDataCodewords(v) * 8) {
        version = v;
        break;
      }
    }
    if (version === -1) return null;

    // データビット列構築（Byteモード = 0100）
    const bitBuf = [];
    appendBits(bitBuf, 0x4, 4);
    appendBits(bitBuf, dataBytes.length, version <= 9 ? 8 : 16);
    for (const b of dataBytes) {
      appendBits(bitBuf, b, 8);
    }

    const dataCapacityBits = getNumDataCodewords(version) * 8;
    // 終端パターン（最大4ビットの0）
    appendBits(bitBuf, 0, Math.min(4, dataCapacityBits - bitBuf.length));
    // バイト境界まで0埋め
    appendBits(bitBuf, 0, (8 - (bitBuf.length % 8)) % 8);
    // 残りを 0xEC / 0x11 で交互パディング
    for (let padByte = 0xec; bitBuf.length < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
      appendBits(bitBuf, padByte, 8);
    }

    // データコード語配列へ変換
    const dataCodewords = new Uint8Array(bitBuf.length / 8);
    for (let i = 0; i < bitBuf.length; i++) {
      dataCodewords[i >>> 3] |= bitBuf[i] << (7 - (i & 7));
    }

    // ブロック分割＆RS誤り訂正＆インターリーブ
    const allCodewords = addEccAndInterleave(dataCodewords, version);

    // モジュール配置
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

    drawFunctionPatterns(modules, isFunction, version, size);
    drawCodewords(modules, isFunction, allCodewords, size);

    // 8種類のマスクからペナルティ最小のマスクを選択
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(modules, isFunction, size, mask);
      drawFormatBits(modules, isFunction, size, mask);
      const penalty = computePenalty(modules, size);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
      }
      applyMask(modules, isFunction, size, mask); // 元に戻す
    }

    applyMask(modules, isFunction, size, bestMask);
    drawFormatBits(modules, isFunction, size, bestMask);

    return { version, size, modules };
  }

  function addEccAndInterleave(data, ver) {
    const numBlocks = NUM_BLOCKS_L[ver];
    const blockEccLen = ECC_PER_BLOCK_L[ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const rsDiv = rsComputeDivisor(blockEccLen);
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.subarray(k, k + datLen);
      k += datLen;
      const ecc = rsComputeRemainder(dat, rsDiv);
      blocks.push({ dat, ecc });
    }

    const result = [];
    const maxDatLen = shortBlockLen - blockEccLen + (numShortBlocks < numBlocks ? 1 : 0);
    for (let i = 0; i < maxDatLen; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i < blocks[j].dat.length) result.push(blocks[j].dat[i]);
      }
    }
    for (let i = 0; i < blockEccLen; i++) {
      for (let j = 0; j < blocks.length; j++) {
        result.push(blocks[j].ecc[i]);
      }
    }
    return new Uint8Array(result);
  }

  function setFuncMod(modules, isFunction, x, y, dark) {
    modules[y][x] = dark ? 1 : 0;
    isFunction[y][x] = 1;
  }

  function drawFinderPattern(modules, isFunction, size, cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFuncMod(modules, isFunction, xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  function drawAlignmentPattern(modules, isFunction, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFuncMod(modules, isFunction, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFunctionPatterns(modules, isFunction, ver, size) {
    // タイミングパターン
    for (let i = 0; i < size; i++) {
      setFuncMod(modules, isFunction, 6, i, i % 2 === 0);
      setFuncMod(modules, isFunction, i, 6, i % 2 === 0);
    }

    // ファインダパターン（3隅）
    drawFinderPattern(modules, isFunction, size, 3, 3);
    drawFinderPattern(modules, isFunction, size, size - 4, 3);
    drawFinderPattern(modules, isFunction, size, 3, size - 4);

    // アライメントパターン
    const alignPos = getAlignmentPatternPositions(ver);
    const n = alignPos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const isCorner = (i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0);
        if (!isCorner) {
          drawAlignmentPattern(modules, isFunction, alignPos[i], alignPos[j]);
        }
      }
    }

    // フォーマット情報領域を予約（仮描画）
    drawFormatBits(modules, isFunction, size, 0);

    // バージョン情報（Version 7以上）
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) {
        rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      }
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFuncMod(modules, isFunction, a, b, dark);
        setFuncMod(modules, isFunction, b, a, dark);
      }
    }
  }

  function drawFormatBits(modules, isFunction, size, mask) {
    // EC Level L のフォーマット指示子は 01 (binary)
    const data = (0x01 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    const bits = ((data << 10) | rem) ^ 0x5412;

    // 左上周辺
    for (let i = 0; i <= 5; i++) setFuncMod(modules, isFunction, 8, i, ((bits >>> i) & 1) !== 0);
    setFuncMod(modules, isFunction, 8, 7, ((bits >>> 6) & 1) !== 0);
    setFuncMod(modules, isFunction, 8, 8, ((bits >>> 7) & 1) !== 0);
    setFuncMod(modules, isFunction, 7, 8, ((bits >>> 8) & 1) !== 0);
    for (let i = 9; i < 15; i++) setFuncMod(modules, isFunction, 14 - i, 8, ((bits >>> i) & 1) !== 0);

    // 右上＆左下周辺
    for (let i = 0; i < 8; i++) setFuncMod(modules, isFunction, size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
    for (let i = 8; i < 15; i++) setFuncMod(modules, isFunction, 8, size - 15 + i, ((bits >>> i) & 1) !== 0);
    setFuncMod(modules, isFunction, 8, size - 8, true); // 固定ダークモジュール
  }

  function drawCodewords(modules, isFunction, data, size) {
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < data.length * 8) {
            modules[y][x] = (data[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
          }
        }
      }
    }
  }

  function applyMask(modules, isFunction, size, mask) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert = false;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) modules[y][x] ^= 1;
      }
    }
  }

  // ISO/IEC 18004 マスク評価（ペナルティ計算）
  function computePenalty(modules, size) {
    let penalty = 0;

    // ルール1: 同色5連続以上（行・列）
    for (let y = 0; y < size; y++) {
      let runColor = modules[y][0];
      let runLen = 1;
      for (let x = 1; x < size; x++) {
        if (modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runColor = modules[y][x];
          runLen = 1;
        }
      }
    }
    for (let x = 0; x < size; x++) {
      let runColor = modules[0][x];
      let runLen = 1;
      for (let y = 1; y < size; y++) {
        if (modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runColor = modules[y][x];
          runLen = 1;
        }
      }
    }

    // ルール2: 2x2 同色ブロック
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          penalty += 3;
        }
      }
    }

    // ルール4: 全体に対する黒モジュール比率の偏り
    let darkCount = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) darkCount++;
      }
    }
    const total = size * size;
    const k = Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
    penalty += k * 10;

    return penalty;
  }

  /** Canvas へ鮮明に QR コードを描画 */
  function drawToCanvas(canvas, text, options = {}) {
    const qr = encodeText(text);
    const displaySize = options.size || 220;
    const margin = options.margin !== undefined ? options.margin : 2;
    const ctx = canvas.getContext('2d');

    if (!qr) {
      canvas.width = displaySize;
      canvas.height = displaySize;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, displaySize, displaySize);
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('URLが長すぎます', displaySize / 2, displaySize / 2);
      return false;
    }

    const totalCells = qr.size + margin * 2;
    const scale = Math.max(2, Math.floor((displaySize * 2) / totalCells));
    const pixelSize = totalCells * scale;

    canvas.width = pixelSize;
    canvas.height = pixelSize;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pixelSize, pixelSize);

    ctx.fillStyle = '#0f172a';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
        }
      }
    }
    return true;
  }

  const api = { encodeText, drawToCanvas };
  if (typeof window !== 'undefined') {
    window.DriveStampQR = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
