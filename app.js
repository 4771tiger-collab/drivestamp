/**
 * DriveStamp — Googleドライブ公開MP3プレイヤー＆YouTube風タイムスタンプメモ
 * 静的サイト（GitHub Pages / Netlify等）だけで動作するよう設計
 */
(() => {
  'use strict';

  // =========================================================
  // 定数・デフォルト設定
  // =========================================================
  const STORAGE_KEY = 'drivestamp_state_v1';
  const DEFAULT_FILE_ID = '1q_6A95ETpr2VELnziqTb_RmldXeLOGce';
  const DEFAULT_DRIVE_URL = `https://drive.google.com/file/d/${DEFAULT_FILE_ID}/view?usp=drive_link`;
  const DEFAULT_TITLE = '音楽決定稿.mp3';
  const MAX_BLOB_FETCH_BYTES = 35 * 1024 * 1024; // 35MB以下は一括取得して高速シーク＆波形生成
  const WAVEFORM_BARS = 140;

  const TAG_META = {
    memo: { label: 'メモ', short: 'm', color: '#38bdf8' },
    fix: { label: '修正', short: 'f', color: '#fb7185' },
    good: { label: '良い', short: 'g', color: '#34d399' },
    important: { label: '重要', short: 'i', color: '#fbbf24' },
  };
  const TAG_BY_SHORT = { m: 'memo', f: 'fix', g: 'good', i: 'important' };

  // =========================================================
  // DOM 要素参照
  // =========================================================
  const $ = (id) => document.getElementById(id);

  const els = {
    audio: $('audioEl'),
    toggleSourceBtn: $('toggleSourceBtn'),
    closeSourceBtn: $('closeSourceBtn'),
    sourcePanel: $('sourcePanel'),
    driveUrlForm: $('driveUrlForm'),
    driveUrlInput: $('driveUrlInput'),
    driveTitleInput: $('driveTitleInput'),
    localFileInput: $('localFileInput'),
    trackHistoryWrap: $('trackHistoryWrap'),
    trackHistoryList: $('trackHistoryList'),

    themeToggleBtn: $('themeToggleBtn'),
    openShareBtn: $('openShareBtn'),

    playerCard: $('playerCard'),
    trackTitleBtn: $('trackTitleBtn'),
    trackTitleText: $('trackTitleText'),
    trackTitleEdit: $('trackTitleEdit'),
    sourceBadge: $('sourceBadge'),
    audioStatusBadge: $('audioStatusBadge'),
    driveOpenLink: $('driveOpenLink'),

    loadProgressBox: $('loadProgressBox'),
    loadProgressLabel: $('loadProgressLabel'),
    loadProgressPercent: $('loadProgressPercent'),
    loadProgressBar: $('loadProgressBar'),

    loadErrorBox: $('loadErrorBox'),
    loadErrorText: $('loadErrorText'),
    retryLoadBtn: $('retryLoadBtn'),
    streamFallbackBtn: $('streamFallbackBtn'),

    waveformContainer: $('waveformContainer'),
    waveformCanvas: $('waveformCanvas'),
    waveformPins: $('waveformPins'),
    abOverlay: $('abOverlay'),
    waveformTooltip: $('waveformTooltip'),

    currentTimeLabel: $('currentTimeLabel'),
    remainingTimeLabel: $('remainingTimeLabel'),
    durationLabel: $('durationLabel'),

    playPauseBtn: $('playPauseBtn'),
    seekBackBtn: $('seekBackBtn'),
    seekFwdBtn: $('seekFwdBtn'),
    quickMarkBtn: $('quickMarkBtn'),

    speedSelect: $('speedSelect'),
    loopBtn: $('loopBtn'),
    abRepeatBtn: $('abRepeatBtn'),
    abRepeatLabel: $('abRepeatLabel'),
    volumeGroup: document.querySelector('.volume-group'),
    muteBtn: $('muteBtn'),
    volumeSlider: $('volumeSlider'),

    memoCountBadge: $('memoCountBadge'),
    copyYoutubeTextBtn: $('copyYoutubeTextBtn'),
    openIoBtn: $('openIoBtn'),

    memoForm: $('memoForm'),
    tsMinusBtn: $('tsMinusBtn'),
    tsPlusBtn: $('tsPlusBtn'),
    memoTimeInput: $('memoTimeInput'),
    tsSyncBtn: $('tsSyncBtn'),
    tsSyncLabel: $('tsSyncLabel'),
    tagOptions: document.querySelectorAll('.tag-option'),
    memoTextInput: $('memoTextInput'),
    memoAuthorInput: $('memoAuthorInput'),

    filterChips: document.querySelectorAll('.filter-chip'),
    memoSearchInput: $('memoSearchInput'),
    memoSortSelect: $('memoSortSelect'),
    memoList: $('memoList'),

    miniPlayer: $('miniPlayer'),
    miniPlayBtn: $('miniPlayBtn'),
    miniTitle: $('miniTitle'),
    miniCurrentTime: $('miniCurrentTime'),
    miniDuration: $('miniDuration'),
    miniBackBtn: $('miniBackBtn'),
    miniMarkBtn: $('miniMarkBtn'),

    shareModal: $('shareModal'),
    localhostNotice: $('localhostNotice'),
    shareIncludeMemos: $('shareIncludeMemos'),
    shareMemoCount: $('shareMemoCount'),
    qrCanvas: $('qrCanvas'),
    qrCaption: $('qrCaption'),
    shareUrlOutput: $('shareUrlOutput'),
    copyShareUrlBtn: $('copyShareUrlBtn'),
    nativeShareBtn: $('nativeShareBtn'),

    ioModal: $('ioModal'),
    bulkImportTextarea: $('bulkImportTextarea'),
    bulkImportBtn: $('bulkImportBtn'),
    exportJsonBtn: $('exportJsonBtn'),
    importJsonInput: $('importJsonInput'),

    toast: $('toast'),
    toastMessage: $('toastMessage'),
    toastUndoBtn: $('toastUndoBtn'),
  };

  // =========================================================
  // アプリケーション状態
  // =========================================================
  let state = loadState();
  let runtime = {
    blobUrl: null,
    fetchAbort: null,
    peaks: null,
    isScrubbing: false,
    scrubPercent: 0,
    isTimeLocked: false,
    lockedTime: 0,
    selectedTag: 'memo',
    activeFilter: 'all',
    searchQuery: '',
    sortMode: 'time-asc',
    editingMemoId: null,
    activeMemoId: null,
    abStart: null,
    abEnd: null,
    pendingJumpSec: null,
    toastTimer: null,
    undoCallback: null,
    lastSavePosAt: 0,
    localFileBlobMap: new Map(), // 端末から開いたローカルMP3の一時保持
  };

  // =========================================================
  // ユーティリティ関数
  // =========================================================

  /** 秒数を M:SS または H:MM:SS 形式に変換 */
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    }
    return `${m}:${ss}`;
  }

  /** M:SS / MM:SS / H:MM:SS / 数値文字列 を秒数に変換（失敗時は null） */
  function parseTimeString(str) {
    if (!str) return null;
    const trimmed = String(str).trim().replace(/[：]/g, ':');
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return Math.max(0, parseFloat(trimmed));
    }
    const parts = trimmed.split(':').map((p) => p.trim());
    if (parts.length < 2 || parts.length > 3) return null;
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    if (parts.length === 2) {
      return nums[0] * 60 + nums[1];
    }
    return nums[0] * 3600 + nums[1] * 60 + nums[2];
  }

  /** GoogleドライブURLやIDからファイルIDを抽出 */
  function extractGoogleDriveId(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return null;

    // 生のGoogleドライブIDのみ貼り付けた場合
    if (/^[a-zA-Z0-9_-]{20,60}$/.test(trimmed)) {
      return trimmed;
    }

    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
      /\/d\/([a-zA-Z0-9_-]{10,})/,
      /[?&]id=([a-zA-Z0-9_-]{10,})/,
      /drive\.usercontent\.google\.com\/download\?.*id=([a-zA-Z0-9_-]{10,})/,
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  /** GoogleドライブのCORS対応・直接音声URLを構築 */
  function buildDriveDirectUrl(fileId) {
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  }

  /** Googleドライブの通常閲覧リンクを構築 */
  function buildDriveViewUrl(fileId) {
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  }

  /** HTMLエスケープ */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** メモ本文中のタイムスタンプ（例: 0:45, 1:24:05）をクリック可能リンクに変換 */
  function renderMemoBodyHtml(text) {
    const escaped = escapeHtml(text);
    const tsRegex = /(^|[^\d:])(\d{1,2}:[0-5]\d(?::[0-5]\d)?)(?![\d:])/g;
    return escaped.replace(tsRegex, (match, prefix, ts) => {
      const sec = parseTimeString(ts);
      if (sec === null) return match;
      return `${prefix}<button type="button" class="inline-ts-link" data-jump-sec="${sec}" title="${ts} から再生">${ts}</button>`;
    });
  }

  /** 相対日時ラベル */
  function formatShortDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - ms) / 1000);
    if (diffSec < 60) return 'たった今';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
    if (diffSec < 86400 && d.getDate() === now.getDate()) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** ユニークID生成 */
  function createId(prefix = 'm') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /** クリップボードコピー（フォールバック付き） */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // フォールバックへ
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  /** トースト通知 */
  function showToast(message, options = {}) {
    if (runtime.toastTimer) clearTimeout(runtime.toastTimer);
    els.toastMessage.textContent = message;
    if (options.undo) {
      runtime.undoCallback = options.undo;
      els.toastUndoBtn.hidden = false;
    } else {
      runtime.undoCallback = null;
      els.toastUndoBtn.hidden = true;
    }
    els.toast.hidden = false;
    runtime.toastTimer = setTimeout(() => {
      els.toast.hidden = true;
      runtime.undoCallback = null;
    }, options.duration || 3200);
  }

  // =========================================================
  // 永続化（localStorage）
  // =========================================================
  function createDefaultState() {
    const defaultKey = `gdrive:${DEFAULT_FILE_ID}`;
    return {
      currentTrackKey: defaultKey,
      authorName: '',
      theme: 'dark',
      tracks: {
        [defaultKey]: {
          key: defaultKey,
          type: 'gdrive',
          fileId: DEFAULT_FILE_ID,
          sourceUrl: DEFAULT_DRIVE_URL,
          title: DEFAULT_TITLE,
          lastPosition: 0,
          updatedAt: Date.now(),
          memos: [],
        },
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.tracks) {
        return createDefaultState();
      }
      // デフォルト音源が未登録なら追加しておく
      const defaultKey = `gdrive:${DEFAULT_FILE_ID}`;
      if (!parsed.tracks[defaultKey]) {
        parsed.tracks[defaultKey] = createDefaultState().tracks[defaultKey];
      }
      if (!parsed.currentTrackKey || !parsed.tracks[parsed.currentTrackKey]) {
        parsed.currentTrackKey = defaultKey;
      }
      return parsed;
    } catch (_) {
      return createDefaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // プライベートブラウジング等の容量制限時は黙って継続
    }
  }

  function getCurrentTrack() {
    return state.tracks[state.currentTrackKey];
  }

  // =========================================================
  // ID3v2 簡易タイトル読み取り（任意）
  // =========================================================
  function parseId3Title(arrayBuffer) {
    try {
      const bytes = new Uint8Array(arrayBuffer);
      if (bytes.length < 10) return null;
      if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"
      const version = bytes[3];
      const tagSize =
        ((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f);
      let pos = 10;
      const end = Math.min(bytes.length, 10 + tagSize);

      while (pos + 10 < end) {
        const frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
        const size =
          version >= 4
            ? ((bytes[pos + 4] & 0x7f) << 21) |
              ((bytes[pos + 5] & 0x7f) << 14) |
              ((bytes[pos + 6] & 0x7f) << 7) |
              (bytes[pos + 7] & 0x7f)
            : (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
        pos += 10;
        if (size <= 0 || pos + size > end) break;
        if (frameId === 'TIT2') {
          const enc = bytes[pos];
          const data = bytes.subarray(pos + 1, pos + size);
          let decoderName = 'utf-8';
          if (enc === 0) decoderName = 'iso-8859-1';
          else if (enc === 1) decoderName = 'utf-16';
          else if (enc === 2) decoderName = 'utf-16be';
          const text = new TextDecoder(decoderName).decode(data).replace(/\0/g, '').trim();
          return text || null;
        }
        pos += size;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  // =========================================================
  // 音声読み込み（Googleドライブ CORS取得 → Blob / ストリーミング）
  // =========================================================
  function setAudioStatus(text, kind = '') {
    els.audioStatusBadge.textContent = text;
    els.audioStatusBadge.className = 'badge badge-status' + (kind ? ` is-${kind}` : '');
  }

  function showLoadProgress(label, percent) {
    els.loadErrorBox.hidden = true;
    els.loadProgressBox.hidden = false;
    els.loadProgressLabel.textContent = label;
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    els.loadProgressPercent.textContent = `${clamped}%`;
    els.loadProgressBar.style.width = `${clamped}%`;
  }

  function hideLoadProgress() {
    els.loadProgressBox.hidden = true;
  }

  function showLoadError(msg) {
    hideLoadProgress();
    els.loadErrorText.textContent = msg;
    els.loadErrorBox.hidden = false;
    setAudioStatus('読み込みエラー', 'error');
  }

  function clearAbRepeat() {
    runtime.abStart = null;
    runtime.abEnd = null;
    updateAbRepeatUi();
  }

  async function loadTrack(trackKey, options = {}) {
    const track = state.tracks[trackKey];
    if (!track) return;

    state.currentTrackKey = trackKey;
    track.updatedAt = Date.now();
    saveState();

    // 進行中の読み込みを中断
    if (runtime.fetchAbort) {
      runtime.fetchAbort.abort();
      runtime.fetchAbort = null;
    }
    if (runtime.blobUrl && !options.keepBlob) {
      URL.revokeObjectURL(runtime.blobUrl);
      runtime.blobUrl = null;
    }

    runtime.peaks = null;
    runtime.editingMemoId = null;
    runtime.activeMemoId = null;
    clearAbRepeat();
    unlockTimeSync();

    // UI更新
    updateTrackHeaderUi();
    renderTrackHistory();
    renderMemos();
    drawWaveform();

    // ローカルファイルの場合
    if (track.type === 'local') {
      const file = runtime.localFileBlobMap.get(track.key);
      if (!file) {
        showLoadError('端末のローカルファイルは再読み込み後に再選択が必要です。「音源を変更」からファイルを選び直してください。');
        return;
      }
      const blobUrl = URL.createObjectURL(file);
      runtime.blobUrl = blobUrl;
      els.audio.removeAttribute('crossorigin');
      els.audio.src = blobUrl;
      els.audio.load();
      setAudioStatus('ローカル読込済', 'ready');
      file.arrayBuffer().then((buf) => decodeWaveformAsync(buf)).catch(() => {});
      return;
    }

    const directUrl = track.type === 'gdrive'
      ? buildDriveDirectUrl(track.fileId)
      : track.sourceUrl;

    if (options.forceStream) {
      loadViaDirectStream(directUrl);
      return;
    }

    // 通常の推奨ルート：CORS fetch で1回取得 → Blob再生（iPhone Safari安定＆高速シーク＆実波形）
    await loadViaFetchBlob(directUrl, track);
  }

  async function loadViaFetchBlob(directUrl, track) {
    const controller = new AbortController();
    runtime.fetchAbort = controller;

    els.loadErrorBox.hidden = true;
    setAudioStatus('読み込み中...', 'loading');
    showLoadProgress('GoogleドライブからMP3を読み込み中...', 4);

    try {
      const response = await fetch(directUrl, {
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${response.statusText || '取得エラー'})`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html')) {
        throw new Error(
          'Googleドライブから音声ではなくHTMLページが返されました。ファイルの共有設定が「リンクを知っている全員（閲覧者）」になっているかご確認ください。'
        );
      }

      const totalBytes = parseInt(response.headers.get('content-length') || '0', 10) || 0;
      if (totalBytes > MAX_BLOB_FETCH_BYTES) {
        // 35MBを超える大きな音声はメモリ保護のため直接ストリーミングへ切替
        controller.abort();
        loadViaDirectStream(directUrl);
        return;
      }

      let chunks = [];
      let received = 0;

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (totalBytes > 0) {
            const pct = (received / totalBytes) * 100;
            const mbDone = (received / 1048576).toFixed(1);
            const mbTotal = (totalBytes / 1048576).toFixed(1);
            showLoadProgress(`MP3をダウンロード中... (${mbDone} / ${mbTotal} MB)`, pct);
          } else {
            const mbDone = (received / 1048576).toFixed(1);
            showLoadProgress(`MP3をダウンロード中... (${mbDone} MB)`, 60);
          }
        }
      } else {
        const buf = await response.arrayBuffer();
        chunks = [new Uint8Array(buf)];
        received = buf.byteLength;
      }

      if (controller.signal.aborted) return;

      // 結合して Blob + ArrayBuffer を作成
      const combined = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      // 念のため先頭がHTMLでないか再チェック
      const headAscii = String.fromCharCode(...combined.subarray(0, 64)).trim().toLowerCase();
      if (headAscii.startsWith('<!doctype') || headAscii.startsWith('<html')) {
        throw new Error(
          '音声データではなくHTMLページが返されました。Googleドライブの共有権限が「リンクを知っている全員」になっているか確認してください。'
        );
      }

      const mimeType = contentType.startsWith('audio/') ? contentType : 'audio/mpeg';
      const blob = new Blob([combined], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      runtime.blobUrl = blobUrl;

      els.audio.removeAttribute('crossorigin');
      els.audio.src = blobUrl;
      els.audio.load();

      // タイトルが仮名だった場合は ID3 タグの曲名を自動反映
      if (track.title === 'Google Drive MP3' || track.title.startsWith('Drive音声 ')) {
        const id3Title = parseId3Title(combined.buffer);
        if (id3Title) {
          track.title = id3Title;
          saveState();
          updateTrackHeaderUi();
          renderTrackHistory();
        }
      }

      hideLoadProgress();
      setAudioStatus('再生可能', 'ready');

      // バックグラウンドで実波形をデコード
      decodeWaveformAsync(combined.buffer.slice(0));
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('CORS fetch fallback:', err);

      // HTML応答エラー（共有設定ミス）はそのまま分かりやすく表示
      if (err && String(err.message).includes('HTML')) {
        showLoadError(err.message);
        return;
      }

      // それ以外のCORS/ネットワーク系は直接ストリーミングを自動試行
      showToast('ストリーミング再生モードへ自動切替します');
      loadViaDirectStream(directUrl);
    } finally {
      if (runtime.fetchAbort === controller) {
        runtime.fetchAbort = null;
      }
    }
  }

  function loadViaDirectStream(directUrl) {
    hideLoadProgress();
    els.loadErrorBox.hidden = true;
    setAudioStatus('ストリーミング読込中', 'loading');
    els.audio.setAttribute('crossorigin', 'anonymous');
    els.audio.src = directUrl;
    els.audio.load();
  }

  /** Web Audio API で実際の音声ピーク配列を生成 */
  async function decodeWaveformAsync(arrayBuffer) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    let ctx = null;
    try {
      ctx = new AudioCtx();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const channel = audioBuffer.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(channel.length / WAVEFORM_BARS));
      const peaks = new Float32Array(WAVEFORM_BARS);
      let maxPeak = 0.001;

      for (let i = 0; i < WAVEFORM_BARS; i++) {
        const start = i * blockSize;
        const end = Math.min(channel.length, start + blockSize);
        let sumSq = 0;
        let peak = 0;
        const step = Math.max(1, Math.floor((end - start) / 400));
        let count = 0;
        for (let j = start; j < end; j += step) {
          const v = Math.abs(channel[j]);
          if (v > peak) peak = v;
          sumSq += v * v;
          count++;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, count));
        const val = rms * 0.65 + peak * 0.35;
        peaks[i] = val;
        if (val > maxPeak) maxPeak = val;
      }

      for (let i = 0; i < WAVEFORM_BARS; i++) {
        peaks[i] = Math.max(0.08, peaks[i] / maxPeak);
      }

      runtime.peaks = peaks;
      drawWaveform();
    } catch (_) {
      // デコード非対応環境ではフォールバック波形のまま継続
    } finally {
      if (ctx && typeof ctx.close === 'function') {
        ctx.close().catch(() => {});
      }
    }
  }

  // =========================================================
  // 波形キャンバス描画 & シーク操作
  // =========================================================
  function getPlaceholderPeak(i, total) {
    const x = i / total;
    return 0.25 + 0.45 * Math.abs(Math.sin(x * Math.PI * 5.2) * Math.cos(x * Math.PI * 13.7));
  }

  function drawWaveform() {
    const canvas = els.waveformCanvas;
    const container = els.waveformContainer;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const duration = els.audio.duration || 0;
    const progress = runtime.isScrubbing
      ? runtime.scrubPercent
      : duration > 0
        ? Math.max(0, Math.min(1, els.audio.currentTime / duration))
        : 0;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const barCount = Math.min(WAVEFORM_BARS, Math.max(48, Math.floor(width / 4.5)));
    const gap = 2;
    const barW = Math.max(2, (width - gap * (barCount - 1) - 16) / barCount);
    const padX = 8;
    const midY = height / 2;
    const maxBarH = height - 22;

    const playedGrad = ctx.createLinearGradient(0, 0, width, 0);
    playedGrad.addColorStop(0, '#6366f1');
    playedGrad.addColorStop(0.55, '#38bdf8');
    playedGrad.addColorStop(1, '#22d3ee');

    const unplayedColor = isLight ? 'rgba(100, 116, 139, 0.26)' : 'rgba(148, 163, 184, 0.24)';

    for (let i = 0; i < barCount; i++) {
      let amp;
      if (runtime.peaks) {
        const idx = Math.min(runtime.peaks.length - 1, Math.floor((i / barCount) * runtime.peaks.length));
        amp = runtime.peaks[idx];
      } else {
        amp = getPlaceholderPeak(i, barCount);
      }

      const barH = Math.max(5, amp * maxBarH);
      const x = padX + i * (barW + gap);
      const y = midY - barH / 2;
      const barRatio = (x + barW / 2) / width;

      ctx.fillStyle = barRatio <= progress ? playedGrad : unplayedColor;
      const r = Math.min(barW / 2, 3);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barW, barH, r);
      } else {
        ctx.rect(x, y, barW, barH);
      }
      ctx.fill();
    }

    // プレイヘッド（現在再生位置バー）
    if (duration > 0 || runtime.isScrubbing) {
      const headX = Math.max(2, Math.min(width - 2, progress * width));
      ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
      ctx.fillRect(headX - 1, 4, 2, height - 8);
    }

    // ARIA更新
    els.waveformContainer.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }

  /** 波形上にタイムスタンプメモのピンを配置 */
  function renderWaveformPins() {
    const track = getCurrentTrack();
    const duration = els.audio.duration || 0;
    els.waveformPins.innerHTML = '';
    if (!track || !duration || duration <= 0) return;

    const frag = document.createDocumentFragment();
    for (const memo of track.memos) {
      const ratio = Math.max(0, Math.min(1, memo.time / duration));
      const pin = document.createElement('div');
      pin.className = 'wave-pin' + (memo.id === runtime.activeMemoId ? ' is-active' : '');
      pin.style.left = `${(ratio * 100).toFixed(3)}%`;
      const meta = TAG_META[memo.tag] || TAG_META.memo;
      pin.style.setProperty('--pin-color', meta.color);
      pin.title = `${formatTime(memo.time)} — ${memo.text}`;
      pin.dataset.memoId = memo.id;
      pin.addEventListener('pointerdown', (e) => e.stopPropagation());
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        jumpToTime(memo.time, true);
        highlightMemoCard(memo.id, true);
      });
      frag.appendChild(pin);
    }
    els.waveformPins.appendChild(frag);
  }

  function updateAbRepeatUi() {
    const duration = els.audio.duration || 0;
    if (runtime.abStart !== null && runtime.abEnd !== null) {
      els.abRepeatBtn.classList.add('is-ab-set');
      els.abRepeatLabel.textContent = `A ${formatTime(runtime.abStart)}–${formatTime(runtime.abEnd)}`;
      if (duration > 0) {
        const left = Math.max(0, Math.min(100, (runtime.abStart / duration) * 100));
        const right = Math.max(0, Math.min(100, (runtime.abEnd / duration) * 100));
        els.abOverlay.style.left = `${left}%`;
        els.abOverlay.style.width = `${Math.max(0.5, right - left)}%`;
        els.abOverlay.hidden = false;
      }
    } else if (runtime.abStart !== null) {
      els.abRepeatBtn.classList.add('is-ab-set');
      els.abRepeatLabel.textContent = `A ${formatTime(runtime.abStart)} → B?`;
      els.abOverlay.hidden = true;
    } else {
      els.abRepeatBtn.classList.remove('is-ab-set');
      els.abRepeatLabel.textContent = 'A-B';
      els.abOverlay.hidden = true;
    }
  }

  // =========================================================
  // 再生制御 & 時間ジャンプ
  // =========================================================
  function togglePlayPause() {
    if (!els.audio.src) return;
    if (els.audio.paused) {
      els.audio.play().catch((err) => {
        console.warn('Play failed:', err);
        showToast('再生できませんでした。もう一度タップしてください。');
      });
    } else {
      els.audio.pause();
    }
  }

  function seekBy(deltaSec) {
    const dur = els.audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const next = Math.max(0, Math.min(dur, els.audio.currentTime + deltaSec));
    els.audio.currentTime = next;
    updateTimeDisplays();
    drawWaveform();
  }

  function jumpToTime(seconds, autoPlay = true) {
    const sec = Math.max(0, Number(seconds) || 0);
    const dur = els.audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      runtime.pendingJumpSec = sec;
      showToast(`${formatTime(sec)} へ移動待機中...`);
      return;
    }
    els.audio.currentTime = Math.min(dur, sec);
    updateTimeDisplays();
    drawWaveform();
    if (autoPlay && els.audio.paused) {
      els.audio.play().catch(() => {});
    }
  }

  function updatePlayButtonUi() {
    const playing = !els.audio.paused && !els.audio.ended;
    els.playPauseBtn.classList.toggle('is-playing', playing);
    els.miniPlayBtn.classList.toggle('is-playing', playing);
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      } catch (_) {}
    }
  }

  function updateTimeDisplays() {
    const cur = runtime.isScrubbing && Number.isFinite(els.audio.duration)
      ? runtime.scrubPercent * els.audio.duration
      : els.audio.currentTime || 0;
    const dur = Number.isFinite(els.audio.duration) ? els.audio.duration : 0;
    const rem = Math.max(0, dur - cur);

    const curStr = formatTime(cur);
    const durStr = formatTime(dur);

    els.currentTimeLabel.textContent = curStr;
    els.remainingTimeLabel.textContent = `-${formatTime(rem)}`;
    els.durationLabel.textContent = durStr;
    els.miniCurrentTime.textContent = curStr;
    els.miniDuration.textContent = durStr;

    if (!runtime.isTimeLocked) {
      els.memoTimeInput.value = curStr;
    }

    // 現在再生中の位置に最も近いメモをハイライト
    updateActiveMemoHighlight(cur);
  }

  function updateActiveMemoHighlight(currentSec) {
    const track = getCurrentTrack();
    if (!track || !track.memos.length) return;
    let candidate = null;
    for (const m of track.memos) {
      if (m.time <= currentSec + 0.4) {
        if (!candidate || m.time > candidate.time) {
          candidate = m;
        }
      }
    }
    const nextId = candidate ? candidate.id : null;
    if (nextId !== runtime.activeMemoId) {
      runtime.activeMemoId = nextId;
      document.querySelectorAll('.memo-item').forEach((el) => {
        el.classList.toggle('is-current', el.dataset.memoId === nextId);
      });
      document.querySelectorAll('.wave-pin').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.memoId === nextId);
      });
    }
  }

  function highlightMemoCard(memoId, scrollIntoView = false) {
    const el = els.memoList.querySelector(`.memo-item[data-memo-id="${CSS.escape(memoId)}"]`);
    if (!el) return;
    if (scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    el.classList.add('is-current');
  }

  // =========================================================
  // Media Session API（スマホのロック画面コントロール対応）
  // =========================================================
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const track = getCurrentTrack();
    if (!track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.type === 'gdrive' ? 'Google Drive — DriveStamp' : 'DriveStamp',
        album: 'タイムスタンプメモ',
      });
      navigator.mediaSession.setActionHandler('play', () => els.audio.play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => els.audio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-5));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(5));
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details && Number.isFinite(details.seekTime)) {
          jumpToTime(details.seekTime, false);
        }
      });
    } catch (_) {
      // 未対応環境は無視
    }
  }

  // =========================================================
  // タイムスタンプ入力（自動ロック & 同期切替）
  // =========================================================
  function lockTimeSync(sec) {
    runtime.isTimeLocked = true;
    runtime.lockedTime = Math.max(0, Number.isFinite(sec) ? sec : els.audio.currentTime || 0);
    els.memoTimeInput.value = formatTime(runtime.lockedTime);
    els.tsSyncBtn.classList.remove('is-live');
    els.tsSyncLabel.textContent = '固定中';
  }

  function unlockTimeSync() {
    runtime.isTimeLocked = false;
    els.tsSyncBtn.classList.add('is-live');
    els.tsSyncLabel.textContent = '連動中';
    els.memoTimeInput.value = formatTime(els.audio.currentTime || 0);
  }

  function getComposerTimestamp() {
    const parsed = parseTimeString(els.memoTimeInput.value);
    if (parsed !== null) return parsed;
    return runtime.isTimeLocked ? runtime.lockedTime : els.audio.currentTime || 0;
  }

  // =========================================================
  // メモ CRUD & レンダリング
  // =========================================================
  function addMemo({ time, text, tag = 'memo', author = '' }) {
    const track = getCurrentTrack();
    if (!track) return null;
    const cleanText = String(text || '').trim();
    if (!cleanText) return null;

    const memo = {
      id: createId('m'),
      time: Math.max(0, Math.round((Number(time) || 0) * 10) / 10),
      text: cleanText,
      tag: TAG_META[tag] ? tag : 'memo',
      author: String(author || '').trim(),
      createdAt: Date.now(),
    };

    track.memos.push(memo);
    track.updatedAt = Date.now();
    saveState();
    renderMemos();
    renderWaveformPins();
    renderTrackHistory();
    return memo;
  }

  function deleteMemo(memoId) {
    const track = getCurrentTrack();
    if (!track) return;
    const idx = track.memos.findIndex((m) => m.id === memoId);
    if (idx === -1) return;

    const [removed] = track.memos.splice(idx, 1);
    saveState();
    renderMemos();
    renderWaveformPins();
    renderTrackHistory();

    showToast(`${formatTime(removed.time)} のメモを削除しました`, {
      duration: 5000,
      undo: () => {
        track.memos.splice(idx, 0, removed);
        saveState();
        renderMemos();
        renderWaveformPins();
        renderTrackHistory();
        showToast('メモを元に戻しました');
      },
    });
  }

  function updateMemo(memoId, patch) {
    const track = getCurrentTrack();
    if (!track) return;
    const memo = track.memos.find((m) => m.id === memoId);
    if (!memo) return;
    if (patch.time !== undefined && Number.isFinite(patch.time)) {
      memo.time = Math.max(0, Math.round(patch.time * 10) / 10);
    }
    if (patch.text !== undefined) {
      memo.text = String(patch.text).trim();
    }
    if (patch.tag !== undefined && TAG_META[patch.tag]) {
      memo.tag = patch.tag;
    }
    saveState();
    renderMemos();
    renderWaveformPins();
  }

  function getFilteredSortedMemos() {
    const track = getCurrentTrack();
    if (!track) return [];
    let list = [...track.memos];

    if (runtime.activeFilter !== 'all') {
      list = list.filter((m) => m.tag === runtime.activeFilter);
    }

    const q = runtime.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        return (
          m.text.toLowerCase().includes(q) ||
          (m.author && m.author.toLowerCase().includes(q)) ||
          formatTime(m.time).includes(q)
        );
      });
    }

    if (runtime.sortMode === 'newest') {
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      list.sort((a, b) => a.time - b.time || (a.createdAt || 0) - (b.createdAt || 0));
    }

    return list;
  }

  function renderMemos() {
    const track = getCurrentTrack();
    const totalCount = track ? track.memos.length : 0;
    els.memoCountBadge.textContent = `${totalCount}件`;

    const list = getFilteredSortedMemos();
    if (list.length === 0) {
      if (totalCount === 0) {
        els.memoList.innerHTML = `
          <div class="memo-empty">
            <div class="memo-empty-icon">🎵</div>
            <p><strong>まだタイムスタンプメモがありません</strong></p>
            <p>曲を再生しながら上の入力欄に書くか、「今をマーク」ボタンで気になる位置をすぐ保存できます。</p>
          </div>
        `;
      } else {
        els.memoList.innerHTML = `
          <div class="memo-empty">
            <p>条件に一致するメモはありません。</p>
          </div>
        `;
      }
      return;
    }

    const html = list.map((memo) => {
      const tagInfo = TAG_META[memo.tag] || TAG_META.memo;
      const isCurrent = memo.id === runtime.activeMemoId;
      const isEditing = memo.id === runtime.editingMemoId;

      if (isEditing) {
        return `
          <article class="memo-item ${isCurrent ? 'is-current' : ''}" data-memo-id="${memo.id}" data-tag="${memo.tag}">
            <form class="memo-edit-form" data-edit-form="${memo.id}">
              <div class="memo-edit-top">
                <input type="text" class="ts-input mono" name="time" value="${formatTime(memo.time)}" aria-label="タイムスタンプ編集">
                <select name="tag" class="pill-select pill-select-sm" aria-label="タグ編集">
                  ${Object.entries(TAG_META).map(([k, v]) =>
                    `<option value="${k}" ${k === memo.tag ? 'selected' : ''}>${v.label}</option>`
                  ).join('')}
                </select>
              </div>
              <textarea name="text" required>${escapeHtml(memo.text)}</textarea>
              <div class="memo-edit-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit="${memo.id}">キャンセル</button>
                <button type="submit" class="btn btn-primary btn-sm">更新する</button>
              </div>
            </form>
          </article>
        `;
      }

      return `
        <article class="memo-item ${isCurrent ? 'is-current' : ''}" data-memo-id="${memo.id}" data-tag="${memo.tag}">
          <div class="memo-item-top">
            <div class="memo-item-left">
              <button type="button" class="ts-chip" data-jump-sec="${memo.time}" title="${formatTime(memo.time)} から再生">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>${formatTime(memo.time)}</span>
              </button>
              <span class="memo-tag-badge tag-${memo.tag}">${tagInfo.label}</span>
              ${memo.author ? `<span class="memo-author">${escapeHtml(memo.author)}</span>` : ''}
              <span class="memo-date">${formatShortDate(memo.createdAt)}</span>
            </div>
            <div class="memo-actions">
              <button type="button" class="memo-action-btn" data-copy-link="${memo.id}" title="この再生位置の共有リンクをコピー">リンク</button>
              <button type="button" class="memo-action-btn" data-edit-memo="${memo.id}" title="メモを編集">編集</button>
              <button type="button" class="memo-action-btn is-delete" data-delete-memo="${memo.id}" title="メモを削除">削除</button>
            </div>
          </div>
          <p class="memo-text">${renderMemoBodyHtml(memo.text)}</p>
        </article>
      `;
    }).join('');

    els.memoList.innerHTML = html;
  }

  // =========================================================
  // トラック管理 & UI更新
  // =========================================================
  function updateTrackHeaderUi() {
    const track = getCurrentTrack();
    if (!track) return;
    els.trackTitleText.textContent = track.title;
    els.miniTitle.textContent = track.title;
    document.title = `${track.title} — DriveStamp`;

    if (track.type === 'gdrive') {
      els.sourceBadge.textContent = 'Google Drive';
      els.driveOpenLink.href = buildDriveViewUrl(track.fileId);
      els.driveOpenLink.hidden = false;
    } else if (track.type === 'url') {
      els.sourceBadge.textContent = 'Web MP3';
      els.driveOpenLink.href = track.sourceUrl;
      els.driveOpenLink.hidden = false;
    } else {
      els.sourceBadge.textContent = '端末ファイル';
      els.driveOpenLink.hidden = true;
    }

    updateMediaSession();
  }

  function renderTrackHistory() {
    const tracks = Object.values(state.tracks).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    els.trackHistoryList.innerHTML = '';

    for (const t of tracks) {
      const chip = document.createElement('div');
      chip.className = 'history-chip' + (t.key === state.currentTrackKey ? ' is-active' : '');

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'history-chip-btn';
      selectBtn.innerHTML = `<span>${escapeHtml(t.title)}</span><span class="history-chip-count">${t.memos.length}</span>`;
      selectBtn.addEventListener('click', () => {
        loadTrack(t.key);
        setSourcePanelOpen(false);
      });
      chip.appendChild(selectBtn);

      if (t.key !== `gdrive:${DEFAULT_FILE_ID}` && t.key !== state.currentTrackKey) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'history-chip-del';
        delBtn.textContent = '✕';
        delBtn.title = '履歴から削除';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          delete state.tracks[t.key];
          saveState();
          renderTrackHistory();
        });
        chip.appendChild(delBtn);
      }

      els.trackHistoryList.appendChild(chip);
    }
  }

  function setSourcePanelOpen(open) {
    els.sourcePanel.hidden = !open;
    els.toggleSourceBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      els.driveUrlInput.focus();
    }
  }

  // =========================================================
  // URL共有（圧縮ペイロード + QRコード）
  // =========================================================
  function bytesToBase64Url(bytes) {
    let bin = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  async function encodeSharePayload(obj) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));
    const plain = 'j.' + bytesToBase64Url(jsonBytes);

    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        writer.write(jsonBytes);
        writer.close();
        const compressedBuf = await new Response(cs.readable).arrayBuffer();
        const compressed = 'z.' + bytesToBase64Url(new Uint8Array(compressedBuf));
        return compressed.length < plain.length ? compressed : plain;
      } catch (_) {
        return plain;
      }
    }
    return plain;
  }

  async function decodeSharePayload(encoded) {
    if (!encoded || encoded.length < 3) return null;
    const prefix = encoded.slice(0, 2);
    const body = encoded.slice(2);
    const bytes = base64UrlToBytes(body);

    if (prefix === 'z.' && typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const outBuf = await new Response(ds.readable).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(outBuf));
    }
    if (prefix === 'j.') {
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    return null;
  }

  async function buildShareUrl({ includeMemos = true, jumpSec = null } = {}) {
    const track = getCurrentTrack();
    const baseUrl = window.location.origin + window.location.pathname;
    if (!track || track.type === 'local') {
      return baseUrl;
    }

    const payload = {
      v: 1,
      n: track.title,
    };
    if (track.type === 'gdrive') {
      payload.f = track.fileId;
    } else {
      payload.u = track.sourceUrl;
    }
    if (jumpSec !== null && Number.isFinite(jumpSec)) {
      payload.t = Math.round(jumpSec * 10) / 10;
    }
    if (includeMemos && track.memos.length > 0) {
      payload.m = track.memos.map((m) => [
        Math.round(m.time * 10),
        (TAG_META[m.tag] || TAG_META.memo).short,
        m.text,
        m.author || '',
      ]);
    }

    // メモなし＆デフォルト音源＆時間指定のみの場合は短いURLにする
    if (!payload.m && track.type === 'gdrive') {
      const params = new URLSearchParams();
      if (track.fileId !== DEFAULT_FILE_ID) params.set('id', track.fileId);
      if (track.title !== DEFAULT_TITLE) params.set('title', track.title);
      if (payload.t !== undefined) params.set('t', String(Math.floor(payload.t)));
      const qs = params.toString();
      return qs ? `${baseUrl}?${qs}` : baseUrl;
    }

    const token = await encodeSharePayload(payload);
    return `${baseUrl}#share=${token}`;
  }

  async function refreshShareModal() {
    const track = getCurrentTrack();
    const isLocalHost = ['localhost', '127.0.0.1', ''].includes(window.location.hostname) || window.location.protocol === 'file:';
    els.localhostNotice.hidden = !isLocalHost;

    const memoCount = track ? track.memos.length : 0;
    els.shareMemoCount.textContent = String(memoCount);

    if (track && track.type === 'local') {
      els.shareUrlOutput.value = 'ローカルファイルはURL共有できません（Googleドライブの公開リンクをご利用ください）';
      els.qrCaption.textContent = 'Googleドライブの公開リンクを読み込むとQRコード共有できます';
      const ctx = els.qrCanvas.getContext('2d');
      ctx.clearRect(0, 0, els.qrCanvas.width, els.qrCanvas.height);
      return;
    }

    const includeMemos = els.shareIncludeMemos.checked;
    const url = await buildShareUrl({ includeMemos });
    els.shareUrlOutput.value = url;

    // QRコード描画
    if (window.DriveStampQR && typeof window.DriveStampQR.drawToCanvas === 'function') {
      const ok = window.DriveStampQR.drawToCanvas(els.qrCanvas, url, {
        size: 220,
        margin: 2,
      });
      if (ok) {
        els.qrCaption.textContent = includeMemos && memoCount > 0
          ? `スマホのカメラで読み取ると、音源とメモ（${memoCount}件）が開きます`
          : 'スマホのカメラで読み取ると、この音源が開きます';
      } else {
        els.qrCaption.textContent = 'メモ件数が多いためQR上限を超えました。下の「コピー」でURLを直接共有してください。';
      }
    }

    els.nativeShareBtn.hidden = typeof navigator.share !== 'function';
  }

  /** ページ起動時に URL ハッシュ / クエリパラメータから共有データを復元 */
  async function applyIncomingUrlParams() {
    let loadedTrackKey = null;
    let jumpSec = null;
    let importedCount = 0;

    // 1. #share=... 形式
    const hash = window.location.hash || '';
    const shareMatch = hash.match(/share=([^&]+)/);
    if (shareMatch && shareMatch[1]) {
      try {
        const data = await decodeSharePayload(shareMatch[1]);
        if (data && (data.f || data.u)) {
          const isDrive = Boolean(data.f);
          const key = isDrive ? `gdrive:${data.f}` : `url:${data.u}`;
          if (!state.tracks[key]) {
            state.tracks[key] = {
              key,
              type: isDrive ? 'gdrive' : 'url',
              fileId: isDrive ? data.f : null,
              sourceUrl: isDrive ? buildDriveViewUrl(data.f) : data.u,
              title: data.n || (data.f === DEFAULT_FILE_ID ? DEFAULT_TITLE : 'Google Drive MP3'),
              lastPosition: 0,
              updatedAt: Date.now(),
              memos: [],
            };
          } else if (data.n && state.tracks[key].title === 'Google Drive MP3') {
            state.tracks[key].title = data.n;
          }

          if (Array.isArray(data.m)) {
            const existing = state.tracks[key].memos;
            for (const row of data.m) {
              if (!Array.isArray(row) || row.length < 3) continue;
              const sec = (Number(row[0]) || 0) / 10;
              const tag = TAG_BY_SHORT[row[1]] || 'memo';
              const text = String(row[2] || '').trim();
              const author = String(row[3] || '').trim();
              if (!text) continue;
              const dup = existing.some(
                (m) => Math.abs(m.time - sec) < 0.15 && m.text === text
              );
              if (!dup) {
                existing.push({
                  id: createId('m'),
                  time: sec,
                  tag,
                  text,
                  author,
                  createdAt: Date.now(),
                });
                importedCount++;
              }
            }
          }

          loadedTrackKey = key;
          if (Number.isFinite(data.t)) jumpSec = data.t;
          saveState();
        }
      } catch (err) {
        console.warn('Share decode failed:', err);
      }
    }

    // 2. ?id=...&t=... 形式
    const params = new URLSearchParams(window.location.search);
    const qId = params.get('id');
    const qUrl = params.get('url');
    const qTitle = params.get('title');
    const qTime = params.get('t');

    if (!loadedTrackKey && (qId || qUrl)) {
      const driveId = qId ? extractGoogleDriveId(qId) : extractGoogleDriveId(qUrl);
      if (driveId) {
        const key = `gdrive:${driveId}`;
        if (!state.tracks[key]) {
          state.tracks[key] = {
            key,
            type: 'gdrive',
            fileId: driveId,
            sourceUrl: buildDriveViewUrl(driveId),
            title: qTitle || (driveId === DEFAULT_FILE_ID ? DEFAULT_TITLE : 'Google Drive MP3'),
            lastPosition: 0,
            updatedAt: Date.now(),
            memos: [],
          };
          saveState();
        }
        loadedTrackKey = key;
      } else if (qUrl) {
        const key = `url:${qUrl}`;
        if (!state.tracks[key]) {
          state.tracks[key] = {
            key,
            type: 'url',
            fileId: null,
            sourceUrl: qUrl,
            title: qTitle || 'Web MP3',
            lastPosition: 0,
            updatedAt: Date.now(),
            memos: [],
          };
          saveState();
        }
        loadedTrackKey = key;
      }
    }

    if (jumpSec === null && qTime !== null) {
      const parsedT = parseTimeString(qTime);
      if (parsedT !== null) jumpSec = parsedT;
    }

    if (jumpSec !== null) {
      runtime.pendingJumpSec = jumpSec;
    }
    if (importedCount > 0) {
      setTimeout(() => {
        showToast(`共有リンクからメモを ${importedCount} 件読み込みました`);
      }, 300);
    }

    return loadedTrackKey || state.currentTrackKey;
  }

  // =========================================================
  // YouTube形式テキスト コピー / 一括取込 / JSONバックアップ
  // =========================================================
  function buildYoutubeExportText() {
    const track = getCurrentTrack();
    if (!track || track.memos.length === 0) return '';
    const sorted = [...track.memos].sort((a, b) => a.time - b.time);
    const lines = [`🎵 ${track.title}`];
    for (const m of sorted) {
      const tagPrefix = m.tag !== 'memo' ? `[${(TAG_META[m.tag] || TAG_META.memo).label}] ` : '';
      const authorSuffix = m.author ? ` (${m.author})` : '';
      const body = m.text.replace(/\r?\n/g, ' / ');
      lines.push(`${formatTime(m.time)} ${tagPrefix}${body}${authorSuffix}`);
    }
    return lines.join('\n');
  }

  function importFromYoutubeText(rawText) {
    const lines = String(rawText || '').split(/\r?\n/);
    let count = 0;
    const lineRe = /^\s*[-・•*]?\s*(\d{1,2}:[0-5]\d(?::[0-5]\d)?)\s*(.*)$/;
    for (const line of lines) {
      const match = line.match(lineRe);
      if (!match) continue;
      const sec = parseTimeString(match[1]);
      if (sec === null) continue;
      let rest = (match[2] || '').trim();
      let tag = 'memo';
      if (rest.startsWith('[修正]')) {
        tag = 'fix';
        rest = rest.slice(4).trim();
      } else if (rest.startsWith('[良い]')) {
        tag = 'good';
        rest = rest.slice(4).trim();
      } else if (rest.startsWith('[重要]')) {
        tag = 'important';
        rest = rest.slice(4).trim();
      }
      if (!rest) rest = 'マーカー';
      addMemo({ time: sec, text: rest, tag, author: els.memoAuthorInput.value });
      count++;
    }
    return count;
  }

  // =========================================================
  // イベントリスナー登録
  // =========================================================
  function bindEvents() {
    // テーマ切替
    els.themeToggleBtn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      saveState();
      drawWaveform();
    });

    // 音源変更ドロワー
    els.toggleSourceBtn.addEventListener('click', () => {
      setSourcePanelOpen(els.sourcePanel.hidden);
    });
    els.closeSourceBtn.addEventListener('click', () => setSourcePanelOpen(false));

    // GoogleドライブURL読み込みフォーム
    els.driveUrlForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawUrl = els.driveUrlInput.value.trim();
      const customTitle = els.driveTitleInput.value.trim();
      if (!rawUrl) return;

      const driveId = extractGoogleDriveId(rawUrl);
      if (driveId) {
        const key = `gdrive:${driveId}`;
        if (!state.tracks[key]) {
          state.tracks[key] = {
            key,
            type: 'gdrive',
            fileId: driveId,
            sourceUrl: buildDriveViewUrl(driveId),
            title: customTitle || (driveId === DEFAULT_FILE_ID ? DEFAULT_TITLE : 'Google Drive MP3'),
            lastPosition: 0,
            updatedAt: Date.now(),
            memos: [],
          };
        } else if (customTitle) {
          state.tracks[key].title = customTitle;
        }
        els.driveUrlInput.value = '';
        els.driveTitleInput.value = '';
        setSourcePanelOpen(false);
        loadTrack(key);
        return;
      }

      if (/^https?:\/\//i.test(rawUrl)) {
        const key = `url:${rawUrl}`;
        const urlName = decodeURIComponent(rawUrl.split('/').pop().split('?')[0] || 'Web MP3');
        if (!state.tracks[key]) {
          state.tracks[key] = {
            key,
            type: 'url',
            fileId: null,
            sourceUrl: rawUrl,
            title: customTitle || urlName,
            lastPosition: 0,
            updatedAt: Date.now(),
            memos: [],
          };
        } else if (customTitle) {
          state.tracks[key].title = customTitle;
        }
        els.driveUrlInput.value = '';
        els.driveTitleInput.value = '';
        setSourcePanelOpen(false);
        loadTrack(key);
        return;
      }

      showToast('有効なGoogleドライブのリンクまたはMP3のURLを入力してください');
    });

    // 端末のローカルMP3読み込み
    els.localFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const key = `local:${file.name}:${file.size}`;
      runtime.localFileBlobMap.set(key, file);
      if (!state.tracks[key]) {
        state.tracks[key] = {
          key,
          type: 'local',
          fileId: null,
          sourceUrl: '',
          title: file.name,
          lastPosition: 0,
          updatedAt: Date.now(),
          memos: [],
        };
      }
      els.localFileInput.value = '';
      setSourcePanelOpen(false);
      loadTrack(key);
    });

    // タイトルのインライン編集
    els.trackTitleBtn.addEventListener('click', () => {
      const track = getCurrentTrack();
      if (!track) return;
      els.trackTitleEdit.value = track.title;
      els.trackTitleBtn.hidden = true;
      els.trackTitleEdit.hidden = false;
      els.trackTitleEdit.focus();
      els.trackTitleEdit.select();
    });

    const commitTitleEdit = () => {
      const track = getCurrentTrack();
      const val = els.trackTitleEdit.value.trim();
      if (track && val) {
        track.title = val;
        saveState();
        updateTrackHeaderUi();
        renderTrackHistory();
      }
      els.trackTitleEdit.hidden = true;
      els.trackTitleBtn.hidden = false;
    };

    els.trackTitleEdit.addEventListener('blur', commitTitleEdit);
    els.trackTitleEdit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTitleEdit();
      } else if (e.key === 'Escape') {
        els.trackTitleEdit.hidden = true;
        els.trackTitleBtn.hidden = false;
      }
    });

    // 再試行・ストリーミング切替
    els.retryLoadBtn.addEventListener('click', () => loadTrack(state.currentTrackKey));
    els.streamFallbackBtn.addEventListener('click', () => loadTrack(state.currentTrackKey, { forceStream: true }));

    // オーディオ要素イベント
    els.audio.addEventListener('loadedmetadata', () => {
      setAudioStatus('再生可能', 'ready');
      els.loadErrorBox.hidden = true;
      const track = getCurrentTrack();

      if (runtime.pendingJumpSec !== null) {
        const target = Math.min(els.audio.duration || runtime.pendingJumpSec, runtime.pendingJumpSec);
        els.audio.currentTime = target;
        runtime.pendingJumpSec = null;
      } else if (track && track.lastPosition > 1 && track.lastPosition < (els.audio.duration || 0) - 2) {
        els.audio.currentTime = track.lastPosition;
      }

      updateTimeDisplays();
      renderWaveformPins();
      updateAbRepeatUi();
      drawWaveform();
    });

    els.audio.addEventListener('play', updatePlayButtonUi);
    els.audio.addEventListener('pause', updatePlayButtonUi);
    els.audio.addEventListener('ended', updatePlayButtonUi);

    els.audio.addEventListener('timeupdate', () => {
      // A-Bリピート制御
      if (runtime.abStart !== null && runtime.abEnd !== null) {
        if (els.audio.currentTime >= runtime.abEnd) {
          els.audio.currentTime = runtime.abStart;
        }
      }
      updateTimeDisplays();
      drawWaveform();

      // 再生位置を3秒おきに自動記憶
      const now = Date.now();
      if (now - runtime.lastSavePosAt > 3000) {
        runtime.lastSavePosAt = now;
        const track = getCurrentTrack();
        if (track) {
          track.lastPosition = els.audio.currentTime || 0;
          saveState();
        }
      }
    });

    els.audio.addEventListener('error', () => {
      if (!els.audio.src) return;
      showLoadError(
        '音声ファイルの再生に失敗しました。Googleドライブの公開設定（「リンクを知っている全員」）や通信状況をご確認のうえ再試行してください。'
      );
    });

    // 波形シーク操作（マウス＆タッチ両対応）
    const getRatioFromEvent = (e) => {
      const rect = els.waveformContainer.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    };

    const showTooltipAt = (ratio) => {
      const dur = els.audio.duration || 0;
      if (dur <= 0) return;
      els.waveformTooltip.textContent = formatTime(ratio * dur);
      els.waveformTooltip.style.left = `${(ratio * 100).toFixed(2)}%`;
      els.waveformTooltip.hidden = false;
    };

    els.waveformContainer.addEventListener('pointerdown', (e) => {
      if (!els.audio.duration) return;
      runtime.isScrubbing = true;
      runtime.scrubPercent = getRatioFromEvent(e);
      els.waveformContainer.setPointerCapture(e.pointerId);
      showTooltipAt(runtime.scrubPercent);
      updateTimeDisplays();
      drawWaveform();
    });

    els.waveformContainer.addEventListener('pointermove', (e) => {
      const ratio = getRatioFromEvent(e);
      if (runtime.isScrubbing) {
        runtime.scrubPercent = ratio;
        showTooltipAt(ratio);
        updateTimeDisplays();
        drawWaveform();
      } else if (e.pointerType === 'mouse' && els.audio.duration > 0) {
        showTooltipAt(ratio);
      }
    });

    const endScrub = (e) => {
      if (!runtime.isScrubbing) return;
      runtime.isScrubbing = false;
      const ratio = getRatioFromEvent(e);
      if (els.audio.duration > 0) {
        els.audio.currentTime = ratio * els.audio.duration;
      }
      els.waveformTooltip.hidden = true;
      updateTimeDisplays();
      drawWaveform();
    };

    els.waveformContainer.addEventListener('pointerup', endScrub);
    els.waveformContainer.addEventListener('pointercancel', () => {
      runtime.isScrubbing = false;
      els.waveformTooltip.hidden = true;
      drawWaveform();
    });
    els.waveformContainer.addEventListener('pointerleave', () => {
      if (!runtime.isScrubbing) els.waveformTooltip.hidden = true;
    });

    els.waveformContainer.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(5);
      }
    });

    // トランスポート操作
    els.playPauseBtn.addEventListener('click', togglePlayPause);
    els.miniPlayBtn.addEventListener('click', togglePlayPause);
    els.seekBackBtn.addEventListener('click', () => seekBy(-5));
    els.miniBackBtn.addEventListener('click', () => seekBy(-5));
    els.seekFwdBtn.addEventListener('click', () => seekBy(5));

    // クイックマーク（「今をマーク」）
    const handleQuickMark = () => {
      const cur = els.audio.currentTime || 0;
      const memo = addMemo({
        time: cur,
        text: 'ピン留めマーカー',
        tag: runtime.selectedTag,
        author: els.memoAuthorInput.value,
      });
      if (memo) {
        showToast(`${formatTime(memo.time)} にマークを保存しました`);
      }
    };
    els.quickMarkBtn.addEventListener('click', handleQuickMark);
    els.miniMarkBtn.addEventListener('click', handleQuickMark);

    // 速度・ループ・A-Bリピート・音量
    els.speedSelect.addEventListener('change', () => {
      els.audio.playbackRate = parseFloat(els.speedSelect.value) || 1;
    });

    els.loopBtn.addEventListener('click', () => {
      els.audio.loop = !els.audio.loop;
      els.loopBtn.classList.toggle('is-active', els.audio.loop);
      els.loopBtn.setAttribute('aria-pressed', String(els.audio.loop));
    });

    els.abRepeatBtn.addEventListener('click', () => {
      const cur = els.audio.currentTime || 0;
      if (runtime.abStart === null) {
        runtime.abStart = cur;
        showToast(`A点を ${formatTime(cur)} に設定（もう一度押すとB点を設定）`);
      } else if (runtime.abEnd === null) {
        if (Math.abs(cur - runtime.abStart) < 0.5) {
          showToast('A点と異なる位置でB点を押してください');
          return;
        }
        if (cur < runtime.abStart) {
          runtime.abEnd = runtime.abStart;
          runtime.abStart = cur;
        } else {
          runtime.abEnd = cur;
        }
        els.audio.currentTime = runtime.abStart;
        showToast(`A-Bリピート開始 (${formatTime(runtime.abStart)} 〜 ${formatTime(runtime.abEnd)})`);
      } else {
        clearAbRepeat();
        showToast('A-Bリピートを解除しました');
      }
      updateAbRepeatUi();
    });

    els.volumeSlider.addEventListener('input', () => {
      const v = parseFloat(els.volumeSlider.value);
      els.audio.volume = v;
      els.audio.muted = v === 0;
      els.volumeGroup.classList.toggle('is-muted', els.audio.muted);
    });

    els.muteBtn.addEventListener('click', () => {
      els.audio.muted = !els.audio.muted;
      els.volumeGroup.classList.toggle('is-muted', els.audio.muted);
    });

    // メモ投稿フォームのタイムスタンプ操作
    els.tsSyncBtn.addEventListener('click', () => {
      if (runtime.isTimeLocked) {
        unlockTimeSync();
      } else {
        lockTimeSync(els.audio.currentTime || 0);
      }
    });

    els.tsMinusBtn.addEventListener('click', () => {
      const base = getComposerTimestamp();
      lockTimeSync(Math.max(0, base - 1));
    });

    els.tsPlusBtn.addEventListener('click', () => {
      const base = getComposerTimestamp();
      const maxDur = els.audio.duration || Infinity;
      lockTimeSync(Math.min(maxDur, base + 1));
    });

    els.memoTimeInput.addEventListener('focus', () => {
      if (!runtime.isTimeLocked) lockTimeSync(els.audio.currentTime || 0);
    });

    els.memoTimeInput.addEventListener('change', () => {
      const parsed = parseTimeString(els.memoTimeInput.value);
      if (parsed !== null) {
        lockTimeSync(parsed);
      } else {
        els.memoTimeInput.value = formatTime(runtime.lockedTime);
      }
    });

    // メモ本文にフォーカス＆入力開始した瞬間のタイムスタンプを自動固定！
    els.memoTextInput.addEventListener('focus', () => {
      if (!runtime.isTimeLocked && !els.memoTextInput.value.trim()) {
        lockTimeSync(els.audio.currentTime || 0);
      }
    });

    els.memoTextInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        els.memoForm.requestSubmit();
      }
    });

    els.memoAuthorInput.addEventListener('change', () => {
      state.authorName = els.memoAuthorInput.value.trim();
      saveState();
    });

    // タグ選択
    els.tagOptions.forEach((btn) => {
      btn.addEventListener('click', () => {
        runtime.selectedTag = btn.dataset.tag;
        els.tagOptions.forEach((b) => b.classList.toggle('is-selected', b === btn));
      });
    });

    // メモ保存
    els.memoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = els.memoTextInput.value.trim();
      if (!text) return;
      const time = getComposerTimestamp();
      const author = els.memoAuthorInput.value.trim();
      state.authorName = author;

      const memo = addMemo({
        time,
        text,
        tag: runtime.selectedTag,
        author,
      });

      if (memo) {
        els.memoTextInput.value = '';
        unlockTimeSync();
        showToast(`${formatTime(memo.time)} にメモを保存しました`);
      }
    });

    // フィルタ・検索・並び替え
    els.filterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        runtime.activeFilter = chip.dataset.filter;
        els.filterChips.forEach((c) => c.classList.toggle('is-active', c === chip));
        renderMemos();
      });
    });

    els.memoSearchInput.addEventListener('input', () => {
      runtime.searchQuery = els.memoSearchInput.value;
      renderMemos();
    });

    els.memoSortSelect.addEventListener('change', () => {
      runtime.sortMode = els.memoSortSelect.value;
      renderMemos();
    });

    // メモ一覧のイベント委譲（タイムスタンプジャンプ / 編集 / 削除 / リンクコピー）
    els.memoList.addEventListener('click', async (e) => {
      const jumpBtn = e.target.closest('[data-jump-sec]');
      if (jumpBtn) {
        const sec = parseFloat(jumpBtn.dataset.jumpSec);
        jumpToTime(sec, true);
        return;
      }

      const editBtn = e.target.closest('[data-edit-memo]');
      if (editBtn) {
        runtime.editingMemoId = editBtn.dataset.editMemo;
        renderMemos();
        const ta = els.memoList.querySelector('.memo-edit-form textarea');
        if (ta) ta.focus();
        return;
      }

      const cancelBtn = e.target.closest('[data-cancel-edit]');
      if (cancelBtn) {
        runtime.editingMemoId = null;
        renderMemos();
        return;
      }

      const delBtn = e.target.closest('[data-delete-memo]');
      if (delBtn) {
        deleteMemo(delBtn.dataset.deleteMemo);
        return;
      }

      const copyLinkBtn = e.target.closest('[data-copy-link]');
      if (copyLinkBtn) {
        const track = getCurrentTrack();
        const memo = track && track.memos.find((m) => m.id === copyLinkBtn.dataset.copyLink);
        if (!memo) return;
        const url = await buildShareUrl({ includeMemos: true, jumpSec: memo.time });
        const ok = await copyToClipboard(url);
        showToast(ok ? `${formatTime(memo.time)} から開く共有URLをコピーしました` : 'コピーに失敗しました');
      }
    });

    els.memoList.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-edit-form]');
      if (!form) return;
      e.preventDefault();
      const memoId = form.dataset.editForm;
      const fd = new FormData(form);
      const parsedTime = parseTimeString(fd.get('time'));
      const text = String(fd.get('text') || '').trim();
      const tag = String(fd.get('tag') || 'memo');
      if (!text) return;

      runtime.editingMemoId = null;
      updateMemo(memoId, {
        time: parsedTime !== null ? parsedTime : undefined,
        text,
        tag,
      });
      showToast('メモを更新しました');
    });

    // YouTube形式テキストコピー
    els.copyYoutubeTextBtn.addEventListener('click', async () => {
      const text = buildYoutubeExportText();
      if (!text) {
        showToast('コピーするメモがありません');
        return;
      }
      const ok = await copyToClipboard(text);
      showToast(ok ? 'YouTube形式で全メモをコピーしました' : 'コピーに失敗しました');
    });

    // スマホ共有モーダル
    els.openShareBtn.addEventListener('click', async () => {
      els.shareModal.hidden = false;
      await refreshShareModal();
    });

    els.shareIncludeMemos.addEventListener('change', refreshShareModal);

    els.copyShareUrlBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(els.shareUrlOutput.value);
      showToast(ok ? '共有URLをコピーしました' : 'コピーに失敗しました');
    });

    els.nativeShareBtn.addEventListener('click', async () => {
      const track = getCurrentTrack();
      try {
        await navigator.share({
          title: track ? `${track.title} — DriveStamp` : 'DriveStamp',
          text: `${track ? track.title : 'MP3'} のタイムスタンプメモを共有`,
          url: els.shareUrlOutput.value,
        });
      } catch (_) {
        // キャンセル時は何もしない
      }
    });

    // 一括取込 / バックアップモーダル
    els.openIoBtn.addEventListener('click', () => {
      els.ioModal.hidden = false;
      els.bulkImportTextarea.focus();
    });

    els.bulkImportBtn.addEventListener('click', () => {
      const added = importFromYoutubeText(els.bulkImportTextarea.value);
      if (added > 0) {
        els.bulkImportTextarea.value = '';
        els.ioModal.hidden = true;
        showToast(`${added} 件のタイムスタンプメモを取り込みました`);
      } else {
        showToast('「0:15 メモ」のようなタイムスタンプ付き行が見つかりませんでした');
      }
    });

    els.exportJsonBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drivestamp-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('バックアップJSONを保存しました');
    });

    els.importJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || !parsed.tracks) throw new Error('invalid');
        let mergedTracks = 0;
        for (const [k, incoming] of Object.entries(parsed.tracks)) {
          if (!incoming || !Array.isArray(incoming.memos)) continue;
          if (!state.tracks[k]) {
            state.tracks[k] = incoming;
            mergedTracks++;
          } else {
            for (const m of incoming.memos) {
              const dup = state.tracks[k].memos.some(
                (ex) => Math.abs(ex.time - m.time) < 0.15 && ex.text === m.text
              );
              if (!dup) state.tracks[k].memos.push(m);
            }
          }
        }
        saveState();
        renderMemos();
        renderWaveformPins();
        renderTrackHistory();
        els.ioModal.hidden = true;
        showToast(`バックアップを読み込みました（新規音源 ${mergedTracks} 件）`);
      } catch (_) {
        showToast('JSONファイルの形式が正しくありません');
      } finally {
        els.importJsonInput.value = '';
      }
    });

    // モーダル閉じる処理
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = $(btn.dataset.close);
        if (target) target.hidden = true;
      });
    });

    [els.shareModal, els.ioModal].forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.hidden = true;
      });
    });

    // トースト「元に戻す」
    els.toastUndoBtn.addEventListener('click', () => {
      if (typeof runtime.undoCallback === 'function') {
        const cb = runtime.undoCallback;
        runtime.undoCallback = null;
        els.toast.hidden = true;
        cb();
      }
    });

    // PCキーボードショートカット
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);

      if (e.key === 'Escape') {
        els.shareModal.hidden = true;
        els.ioModal.hidden = true;
        return;
      }
      if (isTyping) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(5);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        lockTimeSync(els.audio.currentTime || 0);
        els.memoTextInput.focus();
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        handleQuickMark();
      }
    });

    // ウィンドウリサイズ時に波形再描画
    window.addEventListener('resize', () => {
      drawWaveform();
    });

    // スマホでプレイヤーが画面外へスクロールしたらミニプレイヤー表示
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          els.miniPlayer.hidden = entry.isIntersecting;
        },
        { threshold: 0.1 }
      );
      observer.observe(els.playerCard);
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme === 'light' ? 'light' : 'dark');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', state.theme === 'light' ? '#f4f6fb' : '#0d1017');
    }
  }

  // =========================================================
  // 初期化
  // =========================================================
  async function init() {
    applyTheme();
    els.memoAuthorInput.value = state.authorName || '';
    bindEvents();

    const targetKey = await applyIncomingUrlParams();
    await loadTrack(targetKey);
  }

  init();
})();
