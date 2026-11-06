import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const [snapshotArgument, outputArgument] = process.argv.slice(2);
if (!snapshotArgument || !outputArgument) {
  throw new Error('usage: create-release1-publication-package.mjs <snapshot-root> <output-root>');
}

const snapshotRoot = resolve(snapshotArgument);
const outputRoot = resolve(outputArgument);
const allowedOutputParent = `${resolve(repositoryRoot, '.release1-local')}${sep}`;
if (!`${outputRoot}${sep}`.startsWith(allowedOutputParent)) {
  throw new Error('output must be a unique child of .release1-local');
}
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
  child.once('exit', (code) => code === 0 ? resolveRun(stdout.trim()) : reject(new Error(`${command} exited with ${code}: ${stderr}`)));
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

const identityName = await capture('git', ['config', '--file', identityPath, '--get', 'user.name']);
const identityEmail = await capture('git', ['config', '--file', identityPath, '--get', 'user.email']);
if (identityName !== 'Shiroshiba Lab') throw new Error('public identity name must be Shiroshiba Lab');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identityEmail)) throw new Error('public identity email is missing or invalid');

const publicTree = resolve(snapshotRoot, 'public-git-tree');
const archiveManifestPath = resolve(snapshotRoot, 'archive-manifest.json');
const archiveManifest = JSON.parse(await readFile(archiveManifestPath, 'utf8'));
const archivePath = resolve(snapshotRoot, archiveManifest.archive);
const repositoryPath = resolve(outputRoot, 'repository');
await mkdir(outputRoot, { recursive: true });
await cp(publicTree, repositoryPath, { recursive: true, errorOnExist: true, preserveTimestamps: true });

await run('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repositoryPath });
await run('git', ['config', '--local', 'user.name', identityName], { cwd: repositoryPath });
await run('git', ['config', '--local', 'user.email', identityEmail], { cwd: repositoryPath });
await run('git', ['config', '--local', 'user.useConfigOnly', 'true'], { cwd: repositoryPath });
// The corresponding source intentionally contains upstream paths that match the
// generated root .gitignore. Force-add the already verified public tree so the
// commit and its manifest cannot diverge.
await run('git', ['add', '--force', '--all'], { cwd: repositoryPath });
const publicSourceManifest = JSON.parse(await readFile(resolve(publicTree, 'manifests/source-files.json'), 'utf8'));
const stagedFileCount = Number(await capture('git', ['ls-files', '--cached', '--format=%(objectname)'], { cwd: repositoryPath }).then((value) => value.split('\n').filter(Boolean).length));
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
await run('git', ['commit', '--quiet', '--message', 'リバーシ盤 v2.0.0 対応ソース'], { cwd: repositoryPath, env: identityEnvironment });
await run('git', ['tag', '--annotate', 'v2.0.0', '--message', 'リバーシ盤 v2.0.0 対応ソース'], { cwd: repositoryPath, env: identityEnvironment });

const commit = await capture('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath });
const tag = await capture('git', ['rev-parse', 'refs/tags/v2.0.0'], { cwd: repositoryPath });
const peeledTag = await capture('git', ['rev-parse', 'refs/tags/v2.0.0^{}'], { cwd: repositoryPath });
const commitCount = await capture('git', ['rev-list', '--count', 'HEAD'], { cwd: repositoryPath });
const parentLine = await capture('git', ['rev-list', '--parents', '--max-count=1', 'HEAD'], { cwd: repositoryPath });
const authorName = await capture('git', ['show', '-s', '--format=%an', 'HEAD'], { cwd: repositoryPath });
const authorEmail = await capture('git', ['show', '-s', '--format=%ae', 'HEAD'], { cwd: repositoryPath });
const committerName = await capture('git', ['show', '-s', '--format=%cn', 'HEAD'], { cwd: repositoryPath });
const committerEmail = await capture('git', ['show', '-s', '--format=%ce', 'HEAD'], { cwd: repositoryPath });
const taggerName = await capture('git', ['for-each-ref', '--format=%(taggername)', 'refs/tags/v2.0.0'], { cwd: repositoryPath });
const taggerEmailWrapped = await capture('git', ['for-each-ref', '--format=%(taggeremail)', 'refs/tags/v2.0.0'], { cwd: repositoryPath });
const taggerEmail = taggerEmailWrapped.replace(/^</, '').replace(/>$/, '');
if (commitCount !== '1' || parentLine.split(' ').length !== 1) throw new Error('public repository must contain exactly one independent root commit');
if (peeledTag !== commit) throw new Error('v2.0.0 tag does not point to the public root commit');
if (![authorName, committerName, taggerName].every((value) => value === identityName)) throw new Error('public Git name mismatch');
if (![authorEmail, committerEmail, taggerEmail].every((value) => value === identityEmail)) throw new Error('public Git email mismatch');

const bundleName = 'reversi-game-source-v2.0.0-privacy.bundle';
const bundlePath = resolve(outputRoot, bundleName);
await run('git', ['bundle', 'create', bundlePath, 'refs/heads/main', 'refs/tags/v2.0.0'], { cwd: repositoryPath });
await run('git', ['bundle', 'verify', bundlePath], { cwd: repositoryPath });

const deliverables = [
  { source: archivePath, name: basename(archivePath) },
  { source: archiveManifestPath, name: 'archive-manifest.json' },
  { source: resolve(snapshotRoot, 'reversi-board-v2.0.0-corresponding-source.sha256'), name: 'reversi-board-v2.0.0-corresponding-source.sha256' },
  { source: resolve(snapshotRoot, 'reversi-board-v2.0.0-source-files.json'), name: 'reversi-board-v2.0.0-source-files.json' },
  { source: resolve(publicTree, 'manifests/source-files.json'), name: 'public-git-source-files.json' },
  { source: resolve(publicTree, 'manifests/reference-product-artifacts.json'), name: 'reference-product-artifacts.json' },
];
for (const deliverable of deliverables) await copyFile(deliverable.source, resolve(outputRoot, deliverable.name));

const publicationManifest = {
  schemaVersion: 1,
  purpose: 'Release 1-04 privacy-safe public Git candidate and corresponding-source package',
  releaseVersion: 'v2.0.0',
  publicRepository: archiveManifest.publicRepository,
  publicCommit: commit,
  annotatedTagObject: tag,
  sourceBasis: archiveManifest.sourceBasis,
  identity: {
    name: identityName,
    emailConfigured: true,
    authorMatchesConfiguredIdentity: true,
    committerMatchesConfiguredIdentity: true,
    taggerMatchesConfiguredIdentity: true,
    emailValueIntentionallyOmitted: true,
  },
  history: {
    commitCount: Number(commitCount),
    independentRoot: true,
    privateHistoryIncluded: false,
    trackedFileCount: stagedFileCount,
    manifestInventoryFileCount: publicSourceManifest.fileCount,
  },
  remoteProfileAssociation: 'pending verification by a human after publication',
};
const publicationManifestPath = resolve(outputRoot, 'publication-manifest.json');
await writeFile(publicationManifestPath, `${JSON.stringify(publicationManifest, null, 2)}\n`);

const checksumFiles = [bundlePath, ...deliverables.map((item) => resolve(outputRoot, item.name)), publicationManifestPath];
const checksumLines = [];
for (const path of checksumFiles) checksumLines.push(`${await sha256(path)}  ${toPosix(relative(outputRoot, path))}`);
await writeFile(resolve(outputRoot, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);

const instructions = `# Release 1-04 公開候補（人間向け）

このpackageは独立root Commit 1件とannotated tag \`v2.0.0\`を含みます。
identityのメールアドレスはmanifest・手順書へ記載していません。

1. \`SHA256SUMS\`とBundleを検証する。
2. 既存Publicリポジトリを削除し、同名の空リポジトリを再作成する。
3. \`repository/\`またはBundleから\`main\`と\`v2.0.0\`を通常Pushする。
4. GitHub上でCommit／tagの表示名、プロフィール関連付け、Actions成功を確認する。
5. 完全対応ソースarchiveとmanifestは、公開承認後に同versionのReleaseへ添付する。

CodexはPush、削除・再作成、Release公開を実施していません。
`;
await writeFile(resolve(outputRoot, 'HUMAN-PUBLICATION-STEPS.md'), instructions);

console.log(JSON.stringify({
  outputRoot,
  repositoryPath,
  bundlePath,
  publicCommit: commit,
  annotatedTagObject: tag,
  commitCount: Number(commitCount),
  independentRoot: true,
  identityName,
  identityEmailConfigured: true,
  identityEmailOmitted: true,
  bundleSha256: await sha256(bundlePath),
  archiveSha256: await sha256(resolve(outputRoot, archiveManifest.archive)),
}, null, 2));
