# oz-coden tools

[tools.oz-coden.com](https://tools.oz-coden.com/) の公開専用リポジトリです。独立したツールと共通UIを集め、機能検査を通過した静的ファイルをGitHub Pagesへ公開します。公開サイトにAPIサーバーやNode.jsの実行環境は不要です。

## ツール

| パス | ソース |
| --- | --- |
| `/webpage-ide/` | [simple-web-ide-for-webpage](https://github.com/oz-coden/simple-web-ide-for-webpage) |
| `/dummy-text-generator/` | [dummy-text-generator-web](https://github.com/oz-coden/dummy-text-generator-web) |
| `/json-visualizer/` | [json-visualizer-web](https://github.com/oz-coden/json-visualizer-web) |
| `/nexus-search/` | [nexus-search-web](https://github.com/oz-coden/nexus-search-web) |
| `/random-re-visualizer/` | [random-re-visualizer-web](https://github.com/oz-coden/random-re-visualizer-web) |
| `/text-analyzer/` | [text-analyzer-web](https://github.com/oz-coden/text-analyzer-web) |

ツール本体はそれぞれのリポジトリで変更します。配色・ヘッダー・フォームなどの共通部品は [oz-coden.com-ui-web](https://github.com/oz-coden/oz-coden.com-ui-web) で変更します。

## 公開の仕組み

1. `catalog.json` の各 `ref` をコミットSHAに解決します。
2. そのSHAのソースから、公開用のHTML・CSS・JSなどを `_site/<slug>/` へコピーします。
3. 全ツールの `vendor/ui/` を、同一の共通UIコミットの配布物へそろえます。
4. ブラウザで機能とモバイル表示を検査し、成功した成果物をPagesへ公開します。

`build-info.json` に公開元のコミットを、各 `shared-ui.json` にUIのコミットとハッシュを記録します。`ref` にコミットSHAを指定すれば固定版の公開もできます。

このリポジトリの `main` へのpushと、Actionsの **Run workflow** で公開処理が動きます。各ソースの更新は毎時17分の定期実行でも検出し、変更がある場合だけ検査・公開します。GitHubの定期実行には遅延があり、無活動期間が長い公開リポジトリでは停止する場合があります。すぐ反映したい場合はRun workflowを実行してください。

別リポジトリへの書き込みトークンや追加のSecretは使いません。ソースは公開リポジトリから取得します。

## GitHub Pages設定

Settings → Pagesで、公開元を **GitHub Actions**、カスタムドメインを `tools.oz-coden.com` に設定します。DNSは `tools.oz-coden.com` のCNAMEを `oz-coden.github.io` へ向けます。同じドメインを別のPagesリポジトリに重複設定しないでください。

## ローカルでの検査

Node.js 22以降、Git、`tar` が必要です。

```sh
npm ci
node scripts/build.mjs
npx playwright install chromium
npm test
python -m http.server 8000 --directory _site
```

最後のコマンドにはPython 3が必要です。`http://localhost:8000/` を開いて確認できます。公開済みの配布ファイルを閲覧するだけなら、これらの開発用依存関係は不要です。

すでに各リポジトリを取得してある場合は、リポジトリ名をサブディレクトリ名としてそろえ、`node scripts/build.mjs --source-root ../sources` で手元のソースを組み立てられます。
