# KH言語

KH言語は、英語の命令と日本語の変数名・関数名を使って、ホームページやWindows用プログラムを作れるスクリプト言語です。

[公式サイト](https://uni-tadayasu.github.io/kh-language/)でブラウザー版IDEを試し、Windows用IDEやMac・Linux向けCLIをダウンロードできます。

## GitHub Pagesの設定

ZIPを展開し、index.html、.nojekyll、assets/、downloads/ など、展開した中身をリポジトリの直下に置きます。

GitHubの **Settings → Pages** で **Deploy from a branch** を選び、ブランチを **main**、フォルダーを **/(root)** にして保存します。

## 新バージョンの配布

1. 新しい配布ZIPを `downloads/` に追加します。
2. `release.json` のバージョン、公開日、更新内容、ZIPの相対パス、バイト数、SHA-256を更新します。
3. `index.html` のバージョン、既定のダウンロード先、公開日と説明も更新し、`main` にコミットします。

所有者用リリース管理画面は従来の公式サイトで動きます。GitHub Pagesの配布情報はこのリポジトリのファイルを更新すると反映されます。

## 検索エンジン向け

サイトマップは [sitemap.xml](https://uni-tadayasu.github.io/kh-language/sitemap.xml) です。Search Consoleでは公式サイトURLをURLプレフィックスで登録し、所有権を確認した後にサイトマップを送信できます。
