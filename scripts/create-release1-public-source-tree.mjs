import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const [sourceArgument, outputArgument, archiveManifestArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument || !archiveManifestArgument) {
  throw new Error('usage: create-release1-public-source-tree.mjs <full-source-root> <public-tree-root> <archive-manifest>');
}

const sourceRoot = resolve(sourceArgument);
const outputRoot = resolve(outputArgument);
const archiveManifest = JSON.parse(await readFile(resolve(archiveManifestArgument), 'utf8'));
const excludedPrefixes = [
  'third_party/egaroucid/source/archives/',
  'third_party/egaroucid/source/upstream-v7.8.4/',
];
const excludedFiles = new Set(['manifests/source-files.json']);
const toPosix = (path) => path.split(sep).join('/');
const sha256 = (path) => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolveHash(hash.digest('hex')));
});

try {
  await stat(outputRoot);
  throw new Error(`refusing to overwrite public source tree: ${outputRoot}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

async function collect(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const path = toPosix(relative(root, absolute));
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`symlink is forbidden: ${path}`);
    if (entry.isDirectory()) result.push(...await collect(root, absolute));
    else if (entry.isFile()) result.push({ absolute, path, metadata });
    else throw new Error(`unsupported filesystem entry: ${path}`);
  }
  return result.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

for (const file of await collect(sourceRoot)) {
  if (excludedFiles.has(file.path) || excludedPrefixes.some((prefix) => file.path.startsWith(prefix))) continue;
  const destination = resolve(outputRoot, file.path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(file.absolute, destination);
  await chmod(destination, file.metadata.mode & 0o777);
}

const manifestPath = resolve(outputRoot, 'manifests/source-files.json');
const files = await collect(outputRoot);
const sourceManifest = {
  schemaVersion: 1,
  distribution: 'public-git-tree',
  purpose: 'Reversi Board v2.0.0 public corresponding-source Git tree inventory; this manifest intentionally excludes itself',
  sourceCommit: archiveManifest.sourceCommit,
  sourceBasis: archiveManifest.sourceBasis,
  releaseVersion: archiveManifest.releaseVersion,
  publicRepository: archiveManifest.publicRepository,
  upstreamCommit: archiveManifest.upstreamCommit,
  allowlistSha256: await sha256(resolve(outputRoot, 'third_party/egaroucid/release1-source-allowlist.json')),
  releaseAsset: {
    archive: archiveManifest.archive,
    bytes: archiveManifest.bytes,
    sha256: archiveManifest.sha256,
    sourceManifestSha256: archiveManifest.sourceManifestSha256,
    note: 'The Release Asset contains the fixed upstream archive and byte-exact unmodified upstream tree omitted from normal Git history.',
  },
  gitTreeExclusions: [
    'third_party/egaroucid/source/archives/Egaroucid-v7.8.4.tar.gz',
    'third_party/egaroucid/source/upstream-v7.8.4/',
  ],
  fileCount: files.length,
  totalBytes: files.reduce((total, file) => total + file.metadata.size, 0),
  files: await Promise.all(files.map(async (file) => ({
    path: file.path,
    bytes: file.metadata.size,
    sha256: await sha256(file.absolute),
    mode: (file.metadata.mode & 0o7777).toString(8).padStart(4, '0'),
  }))),
};
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);

await new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [resolve(outputRoot, 'scripts/verify-release1-source-snapshot.mjs'), outputRoot], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`public source verification exited with ${code}`)));
});

console.log(JSON.stringify({
  outputRoot,
  files: sourceManifest.fileCount,
  bytes: sourceManifest.totalBytes,
  manifestSha256: await sha256(manifestPath),
  releaseAsset: sourceManifest.releaseAsset,
}, null, 2));
