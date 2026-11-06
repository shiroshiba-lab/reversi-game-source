import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distRoot = resolve(root, 'frontend/dist');
const referencePath = resolve(root, 'manifests/reference-product-artifacts.json');
const reference = JSON.parse(await readFile(referencePath, 'utf8'));
const toPosix = (path) => path.split(sep).join('/');
const sha256 = (path) => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolveHash(hash.digest('hex')));
});

async function collect(directory = distRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`symlink in product build: ${absolute}`);
    if (entry.isDirectory()) files.push(...await collect(absolute));
    else if (entry.isFile()) files.push({
      absolute,
      path: `frontend/dist/${toPosix(relative(distRoot, absolute))}`,
      bytes: metadata.size,
      mode: (metadata.mode & 0o7777).toString(8).padStart(4, '0'),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

const actualFiles = await collect();
const expected = new Map(reference.files.map((entry) => [entry.path, entry]));
if (actualFiles.length !== expected.size) throw new Error(`product file count mismatch: ${actualFiles.length} != ${expected.size}`);

for (const file of actualFiles) {
  const expectedFile = expected.get(file.path);
  if (!expectedFile) throw new Error(`unexpected product file: ${file.path}`);
  if (file.bytes !== expectedFile.bytes || file.mode !== expectedFile.mode) throw new Error(`product metadata mismatch: ${file.path}`);
  const actualHash = await sha256(file.absolute);
  if (actualHash !== expectedFile.sha256) throw new Error(`product SHA-256 mismatch: ${file.path} (${actualHash})`);
}

for (const path of expected.keys()) {
  if (!actualFiles.some((file) => file.path === path)) throw new Error(`missing product file: ${path}`);
}

console.log(JSON.stringify({
  sourceCommit: reference.sourceCommit,
  files: actualFiles.length,
  allReferenceHashesMatch: true,
  artifacts: Object.fromEntries(actualFiles.map((file) => [file.path, expected.get(file.path).sha256])),
}, null, 2));
