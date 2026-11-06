import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const assetRoot = resolve(root, 'frontend/public/egaroucid');
const manifest = JSON.parse(await readFile(resolve(assetRoot, 'artifact-manifest.json'), 'utf8'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(resolve(assetRoot, name));
  const actualHash = sha256(bytes);
  if (actualHash !== expected.sha256) throw new Error(`${name} SHA-256 mismatch: ${actualHash}`);
  if (expected.bytes !== undefined && bytes.byteLength !== expected.bytes) throw new Error(`${name} size mismatch: ${bytes.byteLength}`);
}

for (const [pathKey, hashKey] of [['patch', 'patchSha256'], ['recipe', 'recipeSha256']]) {
  const path = resolve(assetRoot, manifest.build[pathKey]);
  const actualHash = sha256(await readFile(path));
  if (actualHash !== manifest.build[hashKey]) throw new Error(`${pathKey} SHA-256 mismatch: ${actualHash}`);
}

const classicWorker = await readFile(resolve(assetRoot, 'egaroucid.worker.js'), 'utf8');
if (!classicWorker.includes('importScripts(config.aiJsUrl)')) throw new Error('Egaroucid classic Worker must load ai.js with importScripts()');
if (/^\s*(?:import|export)\s/m.test(classicWorker)) throw new Error('Egaroucid classic Worker must not contain ES module syntax');

function readU32(bytes, cursor) {
  let value = 0;
  let shift = 0;
  while (true) {
    const byte = bytes[cursor.offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
    if (shift > 35) throw new Error('Invalid unsigned LEB128');
  }
}

const wasm = await readFile(resolve(assetRoot, 'ai.wasm'));
if (wasm.subarray(0, 4).toString('hex') !== '0061736d') throw new Error('ai.wasm is not WebAssembly');
const cursor = { offset: 8 };
let memory = null;
while (cursor.offset < wasm.length) {
  const sectionId = wasm[cursor.offset++];
  const sectionSize = readU32(wasm, cursor);
  const sectionEnd = cursor.offset + sectionSize;
  if (sectionId === 5) {
    if (readU32(wasm, cursor) !== 1) throw new Error('Expected one WebAssembly memory declaration');
    const flags = readU32(wasm, cursor);
    const initialPages = readU32(wasm, cursor);
    const maximumPages = (flags & 1) === 1 ? readU32(wasm, cursor) : null;
    memory = { initialPages, maximumPages };
    break;
  }
  cursor.offset = sectionEnd;
}
if (!memory || memory.initialPages !== 1024 || memory.maximumPages !== 2048) throw new Error(`Unexpected ai.wasm memory declaration: ${JSON.stringify(memory)}`);

console.log(`Egaroucid assets verified: ${manifest.variant}, classic Worker, assets/patch/recipe hashes and memory 1024/2048 pages`);
