import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const allowlistPath = resolve(repositoryRoot, 'third_party/egaroucid/release1-source-allowlist.json');
const allowlist = JSON.parse(await readFile(allowlistPath, 'utf8'));
const upstreamArchive = resolve(process.env.RELEASE1_EGAROUCID_ARCHIVE ?? '/tmp/egaroucid-v7.8.4.tar.gz');
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const releaseVersion = 'v2.0.0';
const publicRepository = 'https://github.com/shiroshiba-lab/reversi-game-source';
const releaseUrl = `${publicRepository}/releases/tag/${releaseVersion}`;

const capture = (command, args, options = {}) => new Promise((resolveRun, reject) => {
  let stdout = '';
  let stderr = '';
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun(stdout.trim()) : reject(new Error(`${command} exited with ${code}: ${stderr}`)));
});
const run = (command, args, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
});
const runWithInput = (command, args, input, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'], ...options });
  child.stdin.end(input);
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
});
const toPosix = (path) => path.split(sep).join('/');
const sha256 = (path) => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolveHash(hash.digest('hex')));
});

const sourceCommit = await capture('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
const allowlistedWorktreeStatus = await capture(
  'git',
  ['status', '--porcelain=v1', '--untracked-files=all', '--', ...allowlist.repositoryEntries],
  { cwd: repositoryRoot },
);
const sourceBasis = {
  privateBaseCommit: sourceCommit,
  includesAllowlistedWorktreeChanges: allowlistedWorktreeStatus.length > 0,
  allowlistedWorktreeStatusSha256: createHash('sha256').update(allowlistedWorktreeStatus).digest('hex'),
  note: 'The manifests are the authoritative byte inventory. Worktree status is recorded only as a non-sensitive provenance fingerprint.',
};
const defaultName = `release1-04-${sourceCommit.slice(0, 12)}-${timestamp}`;
const requestedRoot = process.argv[2] ?? resolve(repositoryRoot, '.release1-local', defaultName);
const outputRoot = resolve(repositoryRoot, requestedRoot);
const allowedOutputParent = `${resolve(repositoryRoot, '.release1-local')}${sep}`;
if (!`${outputRoot}${sep}`.startsWith(allowedOutputParent)) {
  throw new Error('output must be a unique child of .release1-local');
}
try {
  await stat(outputRoot);
  throw new Error(`refusing to overwrite existing snapshot output: ${outputRoot}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (await sha256(upstreamArchive) !== allowlist.upstream.archiveSha256) {
  throw new Error('Egaroucid source archive SHA-256 mismatch');
}

const sourceRoot = resolve(outputRoot, 'source');
await mkdir(sourceRoot, { recursive: true });

for (const entry of allowlist.repositoryEntries) {
  const source = resolve(repositoryRoot, entry);
  const destination = resolve(sourceRoot, entry);
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error(`allowlisted repository symlink is forbidden: ${entry}`);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: metadata.isDirectory(), errorOnExist: true, preserveTimestamps: true });
}

await writeFile(resolve(sourceRoot, '.gitignore'), [
  'node_modules/',
  'frontend/dist/',
  'shared/dist/',
  '.release-build/',
  'playwright-report/',
  'test-results-v2/',
  '',
].join('\n'));
await copyFile(resolve(sourceRoot, 'frontend/public/egaroucid/GPL-3.0.txt'), resolve(sourceRoot, 'LICENSE'));

const readme = `# リバーシ盤 ${releaseVersion} 対応ソース

このリポジトリは、リバーシ盤 ${releaseVersion} で配布するReact／TypeScript版frontendと、
改変して組み込んだEgaroucid for Web v7.8.4の対応ソースです。private開発Commit
\`${sourceCommit}\` を基準に、Release 1-04の公開準備修正を含む履歴なしsnapshotとして生成しています。
内容はmanifestのpath／size／mode／SHA-256 inventoryで固定します。リバーシ盤の本番切替は別工程であり、
このsource release自体は本番アプリのデプロイではありません。

本リポジトリはリバーシ盤プロジェクトが管理する対応ソース公開先であり、Egaroucid公式
リポジトリではありません。Egaroucidの原作者はTakuto Yamana氏、公式Web版は
<https://www.egaroucid.nyanyan.dev/ja/web/>、公式ソースは
<https://github.com/Nyanyan/Egaroucid>です。

## ライセンスと無保証

アプリ統合ソースはGNU GPL version 3 or laterの条件で公開します。Egaroucidの既存
copyright、GPL-3.0-or-later表示、GPL本文、無保証表示を保持しています。React、Emscripten、
emsdk等は各ライセンスに従います。詳細は \`LICENSE\`、
\`third_party/THIRD_PARTY_NOTICES.md\`、\`frontend/public/egaroucid/NOTICE.txt\` を参照してください。

## 主な改変

- 再現可能な乱数seed、探索診断、Book切替引数をWeb interfaceへ追加
- 通常探索時の診断標準出力を抑制
- Emscripten 4.0.22で初期64 MiB／最大128 MiB、memory growth有効としてbuild
- 専用Web Workerへ統合し、初期化／探索timeout、中止、古い応答・非合法手拒否、安全停止を追加
- React UIからEgaroucid Level 0〜15とオリジナルCPUを別engineとして選択可能にした

## ソース構成

- \`third_party/egaroucid/source/patched-v7.8.4/\`: 製品artifactの完全な改変済みpreferred source
- \`experiments/egaroucid-wasm/patches/v7.8.4-prototype.patch\`: upstreamとの差分
- \`frontend/\`: React／TypeScript、専用Worker、配布JS／WASM、license／NOTICE
- \`shared/\`: UI非依存の盤面・ルール・互換codec
- \`scripts/rebuild-release1-egaroucid.mjs\`: 固定toolchainによるJS／WASM再構築
- \`manifests/reference-product-artifacts.json\`: 最終製品artifactのSHA-256
- \`manifests/source-files.json\`: path／size／mode／SHA-256 source inventory

Public Git treeでは通常Gitの単一file制限を超える固定upstream archiveと、重複する未改変treeを
履歴から除外します。これらを含む完全snapshotは ${releaseUrl} の
\`reversi-board-v2.0.0-corresponding-source.tar.gz\` から取得できます。同Releaseにはarchiveの
SHA-256とmanifestも添付します。Git treeには改変済み完全ソース、patch、Book、評価値、build手順が
含まれるため、archiveとは独立して製品artifactを再構築できます。

## 必要環境

- Node.js 24.21.0
- npm 11.19.0
- Docker互換runtime
- manifestでdigest固定したEmscripten 4.0.22 image

## 検査・再構築

\`\`\`bash
node scripts/verify-release1-source-snapshot.mjs .
npm ci
node scripts/rebuild-release1-egaroucid.mjs
npm run verify:egaroucid
npm run check:v2
npm run build:v2
node scripts/verify-release1-product-build.mjs
\`\`\`

Egaroucid再構築はcontainer内networkを無効化し、生成JS／WASMが製品fileとbyte一致しなければ
失敗します。frontend buildは \`manifests/reference-product-artifacts.json\` と照合します。

## release運用

対応ソースは製品versionごとに同名Git tagとGitHub Releaseを作り、source archive、SHA-256、
source／artifact manifestを保持します。修正時は既存tag／assetを差し替えず、新versionで公開します。
公開先を移転する場合は旧Releaseに移転先を明記し、製品UIとNOTICEを更新した新releaseを作成します。
private開発リポジトリの履歴・秘密情報・本番設定はこの公開物に含みません。
`;
await writeFile(resolve(sourceRoot, 'README.md'), readme);

const exclusions = {
  schemaVersion: 1,
  sourceCommit,
  sourceBasis,
  allowlist: 'third_party/egaroucid/release1-source-allowlist.json',
  excluded: allowlist.excluded,
  retainedPublicUpstreamMetadata: {
    reason: 'The fixed public upstream archive contains Inkscape export paths in three SVG files. They identify the upstream author workspace, not this project, and are retained to keep the upstream tree byte-exact.',
    valuePrefix: 'C:\\Users\\yaman\\Desktop\\',
    files: [
      'img/app_img_resources/app_design.svg',
      'img/eyecatch/eyecatch.svg',
      'img/icon/icon.svg'
    ]
  },
  policy: 'Only repositoryEntries plus documented generatedEntries are copied. No denylist-only export is used.',
};
await mkdir(resolve(sourceRoot, 'manifests'), { recursive: true });
await writeFile(resolve(sourceRoot, 'manifests/exclusions.json'), `${JSON.stringify(exclusions, null, 2)}\n`);

const archiveDestination = resolve(sourceRoot, 'third_party/egaroucid/source/archives/Egaroucid-v7.8.4.tar.gz');
await mkdir(dirname(archiveDestination), { recursive: true });
await copyFile(upstreamArchive, archiveDestination);

const upstreamRoot = resolve(sourceRoot, 'third_party/egaroucid/source/upstream-v7.8.4');
const patchedRoot = resolve(sourceRoot, 'third_party/egaroucid/source/patched-v7.8.4');
await mkdir(upstreamRoot, { recursive: true });
await run('tar', ['-xzf', archiveDestination, '--strip-components=1', '-C', upstreamRoot]);
await mkdir(patchedRoot, { recursive: true });
await run('cp', ['-al', `${upstreamRoot}/.`, patchedRoot]);
await runWithInput(
  'patch',
  ['-p1', '--forward', '--batch'],
  await readFile(resolve(sourceRoot, 'experiments/egaroucid-wasm/patches/v7.8.4-prototype.patch')),
  { cwd: patchedRoot },
);

async function collectFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const path = toPosix(relative(root, absolute));
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`symlink is forbidden: ${path}`);
    if (entry.isDirectory()) files.push(...await collectFiles(root, absolute));
    else if (entry.isFile()) files.push({ absolute, path, metadata });
    else throw new Error(`unsupported filesystem entry: ${path}`);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

async function inventory(root, excludedPaths = new Set()) {
  const result = [];
  for (const file of await collectFiles(root)) {
    if (excludedPaths.has(file.path)) continue;
    result.push({
      path: file.path,
      bytes: file.metadata.size,
      sha256: await sha256(file.absolute),
      mode: (file.metadata.mode & 0o7777).toString(8).padStart(4, '0'),
    });
  }
  return result;
}

const referenceDist = resolve(repositoryRoot, 'frontend/dist');
const referenceFiles = await inventory(referenceDist);
if (referenceFiles.length === 0) throw new Error('frontend/dist is empty; run npm run build:v2 before assembling the snapshot');
const referenceManifest = {
  schemaVersion: 1,
  sourceCommit,
  sourceBasis,
  purpose: 'Reference product build created from the private source tree before snapshot assembly',
  files: referenceFiles.map((entry) => ({ ...entry, path: `frontend/dist/${entry.path}` })),
};
await writeFile(resolve(sourceRoot, 'manifests/reference-product-artifacts.json'), `${JSON.stringify(referenceManifest, null, 2)}\n`);

const sourceManifestPath = resolve(sourceRoot, 'manifests/source-files.json');
const files = await inventory(sourceRoot, new Set(['manifests/source-files.json']));
const sourceManifest = {
  schemaVersion: 1,
  distribution: 'full-release-asset',
  purpose: 'Reversi Board v2.0.0 complete corresponding-source Release Asset inventory; this manifest intentionally excludes itself',
  sourceCommit,
  sourceBasis,
  releaseVersion,
  publicRepository,
  upstreamCommit: allowlist.upstream.commit,
  allowlistSha256: await sha256(resolve(sourceRoot, 'third_party/egaroucid/release1-source-allowlist.json')),
  fileCount: files.length,
  totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  files,
};
await writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);

await run(process.execPath, [resolve(sourceRoot, 'scripts/verify-release1-source-snapshot.mjs'), sourceRoot]);

const archiveName = 'reversi-board-v2.0.0-corresponding-source.tar.gz';
const outputArchive = resolve(outputRoot, archiveName);
await run('tar', [
  '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
  '--pax-option=delete=atime,delete=ctime', '--use-compress-program=gzip -n',
  '-cf', outputArchive, '-C', sourceRoot, '.',
]);
const archiveMetadata = await stat(outputArchive);
const archiveManifest = {
  schemaVersion: 1,
  sourceCommit,
  sourceBasis,
  releaseVersion,
  publicRepository,
  upstreamCommit: allowlist.upstream.commit,
  archive: archiveName,
  bytes: archiveMetadata.size,
  sha256: await sha256(outputArchive),
  sourceManifestSha256: await sha256(sourceManifestPath),
  sourceFileCount: files.length,
  sourceTotalBytes: sourceManifest.totalBytes,
  upstreamArchiveSha256: allowlist.upstream.archiveSha256,
};
const archiveManifestPath = resolve(outputRoot, 'archive-manifest.json');
await writeFile(archiveManifestPath, `${JSON.stringify(archiveManifest, null, 2)}\n`);
const checksumPath = resolve(outputRoot, 'reversi-board-v2.0.0-corresponding-source.sha256');
await writeFile(checksumPath, `${archiveManifest.sha256}  ${archiveName}\n`);
const publishedSourceManifestPath = resolve(outputRoot, 'reversi-board-v2.0.0-source-files.json');
await copyFile(sourceManifestPath, publishedSourceManifestPath);

const publicTreeRoot = resolve(outputRoot, 'public-git-tree');
await run(process.execPath, [
  resolve(repositoryRoot, 'scripts/create-release1-public-source-tree.mjs'),
  sourceRoot,
  publicTreeRoot,
  archiveManifestPath,
]);

console.log(JSON.stringify({
  outputRoot,
  sourceRoot,
  publicTreeRoot,
  outputArchive,
  archiveManifestPath,
  checksumPath,
  publishedSourceManifestPath,
  archiveManifest,
}, null, 2));
