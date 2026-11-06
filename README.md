# リバーシ盤 v2.0.0 対応ソース

このリポジトリは、リバーシ盤 v2.0.0 で配布するReact／TypeScript版frontendと、
改変して組み込んだEgaroucid for Web v7.8.4の対応ソースです。private開発Commit
`0121472213611b34684a7c1bb287a5cb17fb9d58` を基準に、Release 1-04の公開準備修正を含む履歴なしsnapshotとして生成しています。
内容はmanifestのpath／size／mode／SHA-256 inventoryで固定します。リバーシ盤の本番切替は別工程であり、
このsource release自体は本番アプリのデプロイではありません。

本リポジトリはリバーシ盤プロジェクトが管理する対応ソース公開先であり、Egaroucid公式
リポジトリではありません。Egaroucidの原作者はTakuto Yamana氏、公式Web版は
<https://www.egaroucid.nyanyan.dev/ja/web/>、公式ソースは
<https://github.com/Nyanyan/Egaroucid>です。

## ライセンスと無保証

アプリ統合ソースはGNU GPL version 3 or laterの条件で公開します。Egaroucidの既存
copyright、GPL-3.0-or-later表示、GPL本文、無保証表示を保持しています。React、Emscripten、
emsdk等は各ライセンスに従います。詳細は `LICENSE`、
`third_party/THIRD_PARTY_NOTICES.md`、`frontend/public/egaroucid/NOTICE.txt` を参照してください。

## 主な改変

- 再現可能な乱数seed、探索診断、Book切替引数をWeb interfaceへ追加
- 通常探索時の診断標準出力を抑制
- Emscripten 4.0.22で初期64 MiB／最大128 MiB、memory growth有効としてbuild
- 専用Web Workerへ統合し、初期化／探索timeout、中止、古い応答・非合法手拒否、安全停止を追加
- React UIからEgaroucid Level 0〜15とオリジナルCPUを別engineとして選択可能にした

## ソース構成

- `third_party/egaroucid/source/patched-v7.8.4/`: 製品artifactの完全な改変済みpreferred source
- `experiments/egaroucid-wasm/patches/v7.8.4-prototype.patch`: upstreamとの差分
- `frontend/`: React／TypeScript、専用Worker、配布JS／WASM、license／NOTICE
- `shared/`: UI非依存の盤面・ルール・互換codec
- `scripts/rebuild-release1-egaroucid.mjs`: 固定toolchainによるJS／WASM再構築
- `manifests/reference-product-artifacts.json`: 最終製品artifactのSHA-256
- `manifests/source-files.json`: path／size／mode／SHA-256 source inventory

Public Git treeでは通常Gitの単一file制限を超える固定upstream archiveと、重複する未改変treeを
履歴から除外します。これらを含む完全snapshotは https://github.com/shiroshiba-lab/reversi-game-source/releases/tag/v2.0.0 の
`reversi-board-v2.0.0-corresponding-source.tar.gz` から取得できます。同Releaseにはarchiveの
SHA-256とmanifestも添付します。Git treeには改変済み完全ソース、patch、Book、評価値、build手順が
含まれるため、archiveとは独立して製品artifactを再構築できます。

## 必要環境

- Node.js 24.21.0
- npm 11.19.0
- Docker互換runtime
- manifestでdigest固定したEmscripten 4.0.22 image

## 検査・再構築

```bash
node scripts/verify-release1-source-snapshot.mjs .
npm ci
node scripts/rebuild-release1-egaroucid.mjs
npm run verify:egaroucid
npm run check:v2
npm run build:v2
node scripts/verify-release1-product-build.mjs
```

Egaroucid再構築はcontainer内networkを無効化し、生成JS／WASMが製品fileとbyte一致しなければ
失敗します。frontend buildは `manifests/reference-product-artifacts.json` と照合します。

## release運用

対応ソースは製品versionごとに同名Git tagとGitHub Releaseを作り、source archive、SHA-256、
source／artifact manifestを保持します。修正時は既存tag／assetを差し替えず、新versionで公開します。
公開先を移転する場合は旧Releaseに移転先を明記し、製品UIとNOTICEを更新した新releaseを作成します。
private開発リポジトリの履歴・秘密情報・本番設定はこの公開物に含みません。
