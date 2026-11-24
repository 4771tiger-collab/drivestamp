/**
 * DriveStamp 用 Google Apps Script 連携スクリプト（任意）
 *
 * 【導入手順（無料・約1分）】
 * 1. https://script.google.com/ で「新しいプロジェクト」を作成
 * 2. このファイルの中身を貼り付けて保存
 * 3. 右上の「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 * 4. 発行されたウェブアプリURL（https://script.google.com/macros/s/.../exec）を
 *    DriveStamp の「音源を変更」→「Googleドライブ直接読込設定」に貼り付けて保存
 */
function doGet(e) {
  try {
    var fileId = (e && e.parameter && e.parameter.id) ? String(e.parameter.id).trim() : '';
    if (!fileId || !/^[a-zA-Z0-9_-]{10,80}$/.test(fileId)) {
      return jsonResponse({ error: '有効なファイルIDを指定してください。' });
    }

    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var bytes = blob.getBytes();

    // 25MB超はメモリ上限対策として警告
    if (bytes.length > 25 * 1024 * 1024) {
      return jsonResponse({ error: 'ファイルサイズが25MBを超えています。GitHub Actions取込をご利用ください。' });
    }

    var payload = {
      id: fileId,
      name: file.getName(),
      mimeType: blob.getContentType() || 'audio/mpeg',
      size: bytes.length,
      base64: Utilities.base64Encode(bytes),
    };
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({
      error: 'Googleドライブから取得できませんでした: ' + (err && err.message ? err.message : String(err)),
    });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
