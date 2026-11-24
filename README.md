# DriveStamp — Googleドライブ MP3 タイムスタンプメモプレイヤー

Googleドライブの公開リンクから MP3 を直接読み込んで再生し、**YouTube のコメント欄のようにタイムスタンプ付きでメモを保存・ジャンプできる** Web アプリです。  
ビルド不要の静的ファイル（HTML / CSS / JS）のみで構成されているため、**GitHub Pages** や **Netlify Drop** へ置くだけですぐにスマホ（iPhone / Android）から利用できます。

---

## 主な機能

- **Googleドライブ公開MP3の直接再生**
  - デフォルトで `音楽決定稿.mp3`（指定された公開リンク）を読み込みます。
  - 上部の「音源を変更」から、別の Googleドライブ公開リンク・直接MP3 URL・端末内MP3ファイルへ切り替え可能です。
  - CORS経由で取得するため、iPhone Safari でも安定して再生＆遅延ゼロのシークができます（大容量ファイルは自動でストリーミング再生へ切替）。
- **実波形シークバー＆マーカーピン**
  - MP3の音声波形を自動描画し、保存したタイムスタンプメモの位置に色付きピンを表示します。
  - 再生速度変更（`0.5x`〜`2.0x`）、±5秒シーク、全曲ループ、**A-B区間リピート**に対応。
- **YouTube風タイムスタンプメモ**
  - メモ入力欄を開いた瞬間の再生位置を自動固定（`-1s` / `+1s` 微調整や手動入力も可能）。
  - 「今をマーク」ボタンで、再生を止めずにワンタップでブックマーク可能。
  - **本文中に書いた `0:45` や `1:23:45` も自動でクリック可能なタイムスタンプリンク**になります。
  - タグ分類（`メモ` / `修正` / `良い` / `重要`）、検索、時間順／新しい順の並び替えに対応。
- **PC ⇔ スマホ間の共有（QRコード＆URL埋め込み）**
  - 右上の「スマホ共有」から、**音源リンク＋全タイムスタンプメモを圧縮した共有URLとQRコード**を生成できます。
  - PCでメモを書いてQRコードをスマホカメラで読み取るだけで、そのままスマホで続きを聴けます。
  - YouTube形式のテキスト一覧コピー／一括取り込み、JSONバックアップにも対応。

---

## スマホで再生できるように公開する方法（2通り）

静的サイトなのでサーバー構築は不要です。お好みの方法を選んでください。

### 方法1：GitHub Pages で公開する（おすすめ・無料・URL固定）

1. GitHub で新しい **Public リポジトリ**を作成します（例：`drivestamp`）。
2. このフォルダ（`c:\AIProject\AImovie`）の中身をアップロードします。
   - **ブラウザだけで簡単に行う場合**：作成したリポジトリ画面の `uploading an existing file` をクリックし、`index.html`, `style.css`, `app.js`, `qrcode.js`, `manifest.json`, `icon.svg`, `.nojekyll`, `README.md` をドラッグ＆ドロップして `Commit changes` を押します。
   - **Gitコマンドで行う場合**：
     ```powershell
     git add .
     git commit -m "Initial commit: DriveStamp MP3 player"
     git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
     git push -u origin main
     ```
3. リポジトリの **Settings → Pages** を開きます。
4. **Build and deployment → Source** を `Deploy from a branch`、**Branch** を `main` / `/ (root)` にして **Save** を押します。
5. 1分ほど待つと `https://<あなたのユーザー名>.github.io/<リポジトリ名>/` が発行されます。
6. その URL をスマホで開けば、そのまま再生＆メモ保存できます（iPhone の「ホーム画面に追加」にも対応しています）。

### 方法2：Netlify Drop で公開する（最短10秒・Git操作不要）

1. [https://app.netlify.com/drop](https://app.netlify.com/drop) をブラウザで開きます。
2. `c:\AIProject\AImovie` フォルダごとドラッグ＆ドロップします。
3. 数秒で `https://xxxx.netlify.app` のような HTTPS URL が自動発行され、すぐスマホで開けます。

---

## ローカル（このPC）ですぐ試す場合

```powershell
cd c:\AIProject\AImovie
python -m http.server 8080
```

ブラウザで `http://localhost:8080/` を開いてください。

---

## 新しいGoogleドライブのMP3を追加する方法

Googleドライブ側のセキュリティ仕様（`Sec-Fetch-Site: cross-site` に対する403制限）により、外部サイトからGoogleドライブの共有リンクへ直接アクセスするとブラウザでブロックされます。  
そのため DriveStamp では、以下の **3つの確実な読み込みルート** に対応しています。

### 方法A：GitHub Actionsで1クリック取り込み（一番簡単・無料）
1. リポジトリの **Actions →「GoogleドライブからMP3を取り込む」→ Run workflow** を開きます。
2. Googleドライブの公開リンク（「リンクを知っている全員」に設定済み）を貼り付けて実行します。
3. 約30秒で `audio/` にMP3が取り込まれ、アプリ上の「音源を変更」リストに自動で追加されます（iPhone Safari でも安定再生＆高速シーク）。

### 方法B：Google Apps Script（GAS）連携（URLを貼るだけで即再生したい場合）
1. [gas/Code.gs](./gas/Code.gs) の中身を [script.google.com](https://script.google.com/) に貼り付け、ウェブアプリ（アクセスできるユーザー：全員）としてデプロイします。
2. 発行された URL をアプリの「音源を変更」→「Googleドライブ公開リンクをアプリ上で直接読み込む設定」に1回保存すると、以降は任意のGoogleドライブ公開リンクをそのまま貼り付けて再生できます。

### 方法C：直接MP3 URL / 端末ファイル
- GitHub上のMP3 URL（`github.com/.../blob/...mp3` は自動で Raw URL に変換）や Dropbox 共有リンク、端末内のMP3ファイルもそのまま再生できます。
- 未取込のGoogleドライブリンクを貼った場合も、フォールバックとして「Google公式プレイヤー（埋め込み）」で再生できます。
