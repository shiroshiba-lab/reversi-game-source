import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const snapshotRoot = resolve(process.argv[2] ?? process.cwd());
const manifestPath = resolve(snapshotRoot, 'manifests/source-files.json');
const manifestRelativePath = 'manifests/source-files.json';

const toPosix = (path) => path.split(sep).join('/');
const sha256 = (path) => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolveHash(hash.digest('hex')));
});

async function collectFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const path = toPosix(relative(root, absolute));
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`symlink is forbidden: ${path}`);
    if (entry.isDirectory()) {
      if (entry.name === '.git') throw new Error(`private Git history is forbidden: ${path}`);
      files.push(...await collectFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push({ absolute, path, metadata });
    } else {
      throw new Error(`unsupported filesystem entry: ${path}`);
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function isText(bytes, path) {
  if (/\.(?:gz|wasm|png|jpe?g|gif|ico|icns|ttf|otf|woff2?|zstdcmp|bin|zip|7z)$/i.test(path)) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  return !sample.includes(0);
}

const sensitiveContentPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['OpenAI token', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['secret environment assignment', /\b(?:AWS_SECRET_ACCESS_KEY|DATABASE_URL|BROWSER_ID_HMAC_SECRET)\s*=\s*[^\s<]+/],
  ['local Linux user path', /\/home\/(?!web_user(?:\/|\b))[^\s"'`]+/],
  ['local macOS user path', /\/Users\/[^\s"'`]+/],
  ['private repository identifier', new RegExp(['nori', 'hakamata/reversi-game'].join('-'), 'i')],
  ['other-service identifier', new RegExp(['mugen', 'shiritori'].join('-'), 'i')],
];

const suspiciousNamePatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519|credentials?)(?:\.|$)/i,
  /(?:private[-_.]?key|secret[-_.]?key)/i,
  /\.(?:pem|p12|pfx|key)$/i,
];

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('invalid source manifest schema');
if (!['full-release-asset', 'public-git-tree'].includes(manifest.distribution)) throw new Error('invalid source distribution');

const allFiles = await collectFiles(snapshotRoot);
const inventoryFiles = allFiles.filter(({ path }) => path !== manifestRelativePath);
const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
const actualPaths = new Set(inventoryFiles.map(({ path }) => path));

for (const path of expected.keys()) {
  if (!actualPaths.has(path)) throw new Error(`manifest file is missing: ${path}`);
}
for (const { path } of inventoryFiles) {
  if (!expected.has(path)) throw new Error(`unmanifested file found: ${path}`);
}

for (const file of inventoryFiles) {
  const entry = expected.get(file.path);
  const mode = (file.metadata.mode & 0o7777).toString(8).padStart(4, '0');
  if (entry.bytes !== file.metadata.size) throw new Error(`size mismatch: ${file.path}`);
  if (entry.mode !== mode) throw new Error(`mode mismatch: ${file.path}`);
  if (entry.sha256 !== await sha256(file.absolute)) throw new Error(`SHA-256 mismatch: ${file.path}`);
  if ((file.metadata.mode & 0o0022) !== 0) throw new Error(`group/world-writable file is forbidden: ${file.path}`);
}

const scanFindings = [];
let allowedUpstreamMetadataFindings = 0;
for (const file of allFiles) {
  for (const pattern of suspiciousNamePatterns) {
    if (pattern.test(file.path)) scanFindings.push(`${file.path}: suspicious filename`);
  }
  const bytes = await readFile(file.absolute);
  if (!isText(bytes, file.path)) continue;
  const text = bytes.toString('utf8');
  for (const match of text.matchAll(/[A-Za-z]:\\Users\\[^\s"'`<]+/g)) {
    const knownPublicUpstreamSvg = /^third_party\/egaroucid\/source\/(?:upstream|patched)-v7\.8\.4\/img\/(?:app_img_resources\/app_design|eyecatch\/eyecatch|icon\/icon)\.svg$/.test(file.path);
    if (knownPublicUpstreamSvg && match[0].startsWith('C:\\Users\\yaman\\Desktop\\')) {
      allowedUpstreamMetadataFindings += 1;
    } else {
      scanFindings.push(`${file.path}: local Windows user path`);
    }
  }
  for (const [label, pattern] of sensitiveContentPatterns) {
    if (pattern.test(text)) scanFindings.push(`${file.path}: ${label}`);
  }
}
if (scanFindings.length > 0) throw new Error(`snapshot content scan failed:\n${scanFindings.join('\n')}`);

const archivePath = 'third_party/egaroucid/source/archives/Egaroucid-v7.8.4.tar.gz';
const archive = expected.get(archivePath);
if (manifest.distribution === 'full-release-asset') {
  if (!archive || archive.sha256 !== '85c88f57c0b8cec38c22ca02a408cd475f6dabe7e10be1ddc297ac3bead49376') {
    throw new Error('fixed Egaroucid source archive is missing or has an unexpected hash');
  }
} else {
  if (archive || allFiles.some(({ path }) => path.startsWith('third_party/egaroucid/source/upstream-v7.8.4/'))) {
    throw new Error('public Git tree must omit the large upstream archive and duplicate unmodified tree');
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.releaseAsset?.sha256 ?? '')) throw new Error('public Git tree release asset SHA-256 is missing');
  if (!expected.has('third_party/egaroucid/source/patched-v7.8.4/src/Egaroucid_for_Web.cpp')) {
    throw new Error('public Git tree is missing the complete patched Egaroucid source');
  }
}

console.log(JSON.stringify({
  snapshot: basename(snapshotRoot),
  distribution: manifest.distribution,
  files: inventoryFiles.length,
  bytes: inventoryFiles.reduce((total, file) => total + file.metadata.size, 0),
  symlinks: 0,
  gitDirectories: 0,
  contentScanFindings: 0,
  allowedPublicUpstreamMetadataFindings: allowedUpstreamMetadataFindings,
  manifestSha256: await sha256(manifestPath),
}, null, 2));
