import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import {
  PREVIOUS_PRODUCT_VERSION,
  PREVIOUS_PUBLIC_COMMIT,
  PREVIOUS_PUBLIC_TAG_OBJECT,
  PRODUCT_VERSION,
  PUBLIC_REPOSITORY,
  correspondingSourceChecksumName,
  correspondingSourceManifestName,
  publicBundleName,
} from './release-version.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const [snapshotArgument, outputArgument, publicBaseArgument] = process.argv.slice(2);
if (!snapshotArgument || !outputArgument || !publicBaseArgument) {
  throw new Error('usage: create-release1-publication-package.mjs <snapshot-root> <output-root> <public-base-repository>');
}

const snapshotRoot = resolve(snapshotArgument);
const outputRoot = resolve(outputArgument);
const publicBaseRepository = resolve(publicBaseArgument);
const allowedOutputParent = `${resolve(repositoryRoot, '.release1-local')}${sep}`;
if (!`${outputRoot}${sep}`.startsWith(allowedOutputParent)) throw new Error('output must be a unique child of .release1-local');
try {
  await stat(outputRoot);
  throw new Error(`refusing to overwrite publication package: ${outputRoot}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const identityPath = resolve(repositoryRoot, '.release1-local/public-git-identity.conf');
const capture = (command, args, options = {}) => new Promise((resolveRun, reject) => {
  let stdout = '';
  let stderr = '';
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0
    ? resolveRun(stdout.trim())
    : reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`)));
});
const run = (command, args, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
});
const sha256 = (path) => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolveHash(hash.digest('hex')));
});
const toPosix = (path) => path.split(sep).join('/');

const identityMode = (await stat(identityPath)).mode & 0o777;
if (identityMode !== 0o600) throw new Error('public identity config must have mode 0600');
const identityName = await capture('git', ['config', '--file', identityPath, '--get', 'user.name']);
const identityEmail = await capture('git', ['config', '--file', identityPath, '--get', 'user.email']);
if (identityName !== 'Shiroshiba Lab') throw new Error('public identity name must be Shiroshiba Lab');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identityEmail)) throw new Error('public identity email is missing or invalid');

if (await capture('git', ['status', '--porcelain=v1'], { cwd: publicBaseRepository })) {
  throw new Error('public base repository worktree must be clean');
}
const publicBaseBranch = await capture('git', ['branch', '--show-current'], { cwd: publicBaseRepository });
const publicBaseCommit = await capture('git', ['rev-parse', 'HEAD'], { cwd: publicBaseRepository });
const previousTagObject = await capture('git', ['rev-parse', `refs/tags/${PREVIOUS_PRODUCT_VERSION}`], { cwd: publicBaseRepository });
const previousTagCommit = await capture('git', ['rev-parse', `refs/tags/${PREVIOUS_PRODUCT_VERSION}^{}`], { cwd: publicBaseRepository });
const baseCommitCount = await capture('git', ['rev-list', '--count', 'HEAD'], { cwd: publicBaseRepository });
if (publicBaseBranch !== 'main' || publicBaseCommit !== PREVIOUS_PUBLIC_COMMIT || baseCommitCount !== '1') {
  throw new Error('public base must be the approved one-commit v2.0.0 main');
}
if (previousTagObject !== PREVIOUS_PUBLIC_TAG_OBJECT || previousTagCommit !== PREVIOUS_PUBLIC_COMMIT) {
  throw new Error('approved v2.0.0 annotated tag changed');
}

const publicTree = resolve(snapshotRoot, 'public-git-tree');
const archiveManifestPath = resolve(snapshotRoot, 'archive-manifest.json');
const archiveManifest = JSON.parse(await readFile(archiveManifestPath, 'utf8'));
if (archiveManifest.releaseVersion !== PRODUCT_VERSION) throw new Error('snapshot release version mismatch');
const archivePath = resolve(snapshotRoot, archiveManifest.archive);
const repositoryPath = resolve(outputRoot, 'repository');
await mkdir(outputRoot, { recursive: true });
await run('git', ['clone', '--quiet', '--no-hardlinks', '--branch', 'main', '--single-branch', publicBaseRepository, repositoryPath]);
await run('git', ['remote', 'set-url', 'origin', `${PUBLIC_REPOSITORY}.git`], { cwd: repositoryPath });
await run('git', ['config', '--local', 'user.name', identityName], { cwd: repositoryPath });
await run('git', ['config', '--local', 'user.email', identityEmail], { cwd: repositoryPath });
await run('git', ['config', '--local', 'user.useConfigOnly', 'true'], { cwd: repositoryPath });
await run('git', ['rm', '-r', '--quiet', '--ignore-unmatch', '.'], { cwd: repositoryPath });
await cp(publicTree, repositoryPath, { recursive: true, errorOnExist: false, preserveTimestamps: true });
await run('git', ['add', '--force', '--all'], { cwd: repositoryPath });

const publicSourceManifest = JSON.parse(await readFile(resolve(publicTree, 'manifests/source-files.json'), 'utf8'));
const stagedFileCount = Number(await capture('git', ['ls-files', '--cached', '--format=%(objectname)'], { cwd: repositoryPath })
  .then((value) => value.split('\n').filter(Boolean).length));
if (stagedFileCount !== publicSourceManifest.fileCount + 1) {
  throw new Error(`staged Git tree file count mismatch: expected ${publicSourceManifest.fileCount + 1}, got ${stagedFileCount}`);
}

const identityEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: identityName,
  GIT_AUTHOR_EMAIL: identityEmail,
  GIT_COMMITTER_NAME: identityName,
  GIT_COMMITTER_EMAIL: identityEmail,
};
await run('git', ['commit', '--quiet', '--message', `リバーシ盤 ${PRODUCT_VERSION} 対応ソース`], { cwd: repositoryPath, env: identityEnvironment });
await run('git', ['tag', '--annotate', PRODUCT_VERSION, '--message', `リバーシ盤 ${PRODUCT_VERSION} 対応ソース`], { cwd: repositoryPath, env: identityEnvironment });

const commit = await capture('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath });
const tag = await capture('git', ['rev-parse', `refs/tags/${PRODUCT_VERSION}`], { cwd: repositoryPath });
const peeledTag = await capture('git', ['rev-parse', `refs/tags/${PRODUCT_VERSION}^{}`], { cwd: repositoryPath });
const parent = await capture('git', ['show', '-s', '--format=%P', 'HEAD'], { cwd: repositoryPath });
const authorName = await capture('git', ['show', '-s', '--format=%an', 'HEAD'], { cwd: repositoryPath });
const authorEmail = await capture('git', ['show', '-s', '--format=%ae', 'HEAD'], { cwd: repositoryPath });
const committerName = await capture('git', ['show', '-s', '--format=%cn', 'HEAD'], { cwd: repositoryPath });
const committerEmail = await capture('git', ['show', '-s', '--format=%ce', 'HEAD'], { cwd: repositoryPath });
const taggerName = await capture('git', ['for-each-ref', '--format=%(taggername)', `refs/tags/${PRODUCT_VERSION}`], { cwd: repositoryPath });
const taggerEmail = (await capture('git', ['for-each-ref', '--format=%(taggeremail)', `refs/tags/${PRODUCT_VERSION}`], { cwd: repositoryPath }))
  .replace(/^</, '').replace(/>$/, '');
if (parent !== PREVIOUS_PUBLIC_COMMIT || peeledTag !== commit) throw new Error('incremental public history or tag target mismatch');
if (![authorName, committerName, taggerName].every((value) => value === identityName)) throw new Error('public Git name mismatch');
if (![authorEmail, committerEmail, taggerEmail].every((value) => value === identityEmail)) throw new Error('public Git email mismatch');
await run(process.execPath, [resolve(repositoryPath, 'scripts/verify-public-release-history.mjs'), repositoryPath], { cwd: repositoryPath });

const bundlePath = resolve(outputRoot, publicBundleName);
await run('git', ['bundle', 'create', bundlePath, 'refs/heads/main', `refs/tags/${PREVIOUS_PRODUCT_VERSION}`, `refs/tags/${PRODUCT_VERSION}`], { cwd: repositoryPath });
await run('git', ['bundle', 'verify', bundlePath], { cwd: repositoryPath });

const deliverables = [
  { source: archivePath, name: basename(archivePath), releaseAsset: true },
  { source: archiveManifestPath, name: 'archive-manifest.json', releaseAsset: true },
  { source: resolve(snapshotRoot, correspondingSourceChecksumName), name: correspondingSourceChecksumName, releaseAsset: false },
  { source: resolve(snapshotRoot, correspondingSourceManifestName), name: correspondingSourceManifestName, releaseAsset: true },
  { source: resolve(publicTree, 'manifests/source-files.json'), name: 'public-git-source-files.json', releaseAsset: true },
  { source: resolve(publicTree, 'manifests/reference-product-artifacts.json'), name: 'reference-product-artifacts.json', releaseAsset: true },
];
for (const deliverable of deliverables) await copyFile(deliverable.source, resolve(outputRoot, deliverable.name));

const publicationManifest = {
  schemaVersion: 1,
  purpose: `${PRODUCT_VERSION} privacy-safe incremental public Git candidate and corresponding-source package`,
  releaseVersion: PRODUCT_VERSION,
  publicRepository: PUBLIC_REPOSITORY,
  publicBaseCommit: PREVIOUS_PUBLIC_COMMIT,
  publicCommit: commit,
  annotatedTagObject: tag,
  previousAnnotatedTagObject: previousTagObject,
  sourceBasis: archiveManifest.sourceBasis,
  identity: {
    name: identityName,
    configMode: '0600',
    emailConfigured: true,
    authorMatchesConfiguredIdentity: true,
    committerMatchesConfiguredIdentity: true,
    taggerMatchesConfiguredIdentity: true,
    emailValueIntentionallyOmitted: true,
  },
  history: {
    commitCount: 2,
    rootCount: 1,
    rootCommit: PREVIOUS_PUBLIC_COMMIT,
    parentCommit: parent,
    previousTagPreserved: true,
    privateHistoryIncluded: false,
    trackedFileCount: stagedFileCount,
    manifestInventoryFileCount: publicSourceManifest.fileCount,
  },
  remoteProfileAssociation: 'pending verification by a human after publication',
};
const publicationManifestPath = resolve(outputRoot, 'publication-manifest.json');
await writeFile(publicationManifestPath, `${JSON.stringify(publicationManifest, null, 2)}\n`);

const releasePayloads = [
  ...deliverables.filter((item) => item.releaseAsset).map((item) => resolve(outputRoot, item.name)),
  publicationManifestPath,
];
const releaseChecksumLines = [];
for (const path of releasePayloads) releaseChecksumLines.push(`${await sha256(path)}  ${basename(path)}`);
const releaseChecksumsPath = resolve(outputRoot, 'RELEASE-SHA256SUMS');
await writeFile(releaseChecksumsPath, `${releaseChecksumLines.join('\n')}\n`);

const instructions = `# ${PRODUCT_VERSION} 公開候補（人間向け）

このpackageは、既存Public main ${PREVIOUS_PUBLIC_COMMIT}を親とする検証済みCommit
${commit}とannotated tag ${PRODUCT_VERSION}（tag object ${tag}）を含みます。
${PREVIOUS_PRODUCT_VERSION} tag object ${previousTagObject}は変更していません。identityのメールアドレスは
manifest・手順書へ記載していません。

## 1. 公開前の停止条件

- Public mainが${PREVIOUS_PUBLIC_COMMIT}以外なら停止する。
- remoteに${PRODUCT_VERSION} tagまたは同名Releaseが既に存在したら停止する。
- SHA256SUMS、Bundle検証、Commit／tag identity、公開tree検査のいずれかが失敗したら停止する。
- Force Push、既存${PREVIOUS_PRODUCT_VERSION} tag変更、repository削除・再作成は行わない。

## 2. ローカル確認

\`\`\`bash
cd ${outputRoot}
sha256sum --check SHA256SUMS
git bundle verify ${publicBundleName}
git -C repository status --short --branch
node repository/scripts/verify-public-release-history.mjs repository
git -C repository remote -v
git -C repository ls-remote origin refs/heads/main refs/tags/${PRODUCT_VERSION}
\`\`\`

期待値はremote main=${PREVIOUS_PUBLIC_COMMIT}、remote ${PRODUCT_VERSION} tagなしです。

## 3. 人間による通常Push

\`\`\`bash
cd ${repositoryPath}
git push --dry-run origin main
git push origin main
git push --dry-run origin refs/tags/${PRODUCT_VERSION}
git push origin refs/tags/${PRODUCT_VERSION}
\`\`\`

main Push後にCommit ${commit}とActions成功を確認してからtagをPushします。拒否、予期しない差分、
Actions失敗があれば次へ進まず停止します。

## 4. GitHub Release

GitHubのReleases画面でtag ${PRODUCT_VERSION}を選び、draft Releaseを作成します。次の7 assetsだけを添付します。

- ${basename(archivePath)}
- archive-manifest.json
- publication-manifest.json
- ${correspondingSourceManifestName}
- public-git-source-files.json
- reference-product-artifacts.json
- RELEASE-SHA256SUMS

Release titleは「リバーシ盤 ${PRODUCT_VERSION} 対応ソース」とし、draft／asset checksumを確認後に公開します。
既存${PREVIOUS_PRODUCT_VERSION} Release／assetsは変更しません。

CodexはPush、tag Push、Release作成・公開を実施していません。
`;
await writeFile(resolve(outputRoot, 'HUMAN-PUBLICATION-STEPS.md'), instructions);

const localChecksumFiles = [bundlePath, ...deliverables.map((item) => resolve(outputRoot, item.name)), publicationManifestPath, releaseChecksumsPath];
const checksumLines = [];
for (const path of localChecksumFiles) checksumLines.push(`${await sha256(path)}  ${toPosix(relative(outputRoot, path))}`);
await writeFile(resolve(outputRoot, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);

console.log(JSON.stringify({
  outputRoot,
  repositoryPath,
  bundlePath,
  publicBaseCommit: PREVIOUS_PUBLIC_COMMIT,
  publicCommit: commit,
  annotatedTagObject: tag,
  previousAnnotatedTagObject: previousTagObject,
  commitCount: 2,
  rootCount: 1,
  identityName,
  identityConfigMode: '0600',
  identityEmailConfigured: true,
  identityEmailOmitted: true,
  bundleSha256: await sha256(bundlePath),
  archiveSha256: await sha256(archivePath),
  releaseAssetCount: 7,
}, null, 2));
