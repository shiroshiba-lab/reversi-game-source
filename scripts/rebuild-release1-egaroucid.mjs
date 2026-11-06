import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'third_party/egaroucid/source/patched-v7.8.4');
const outputRoot = resolve(root, process.argv[2] ?? '.release-build/egaroucid');
const productRoot = resolve(root, 'frontend/public/egaroucid');
const productManifest = JSON.parse(await readFile(resolve(productRoot, 'artifact-manifest.json'), 'utf8'));
const image = 'emscripten/emsdk@sha256:a08b927777707813e64af195db105f935bd554f5825606b2048031151a9635f5';
const initialMemoryBytes = 64 * 1024 * 1024;
const maximumMemoryBytes = 128 * 1024 * 1024;

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const run = (command, args, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
});
const capture = (command, args) => new Promise((resolveRun, reject) => {
  let stdout = '';
  let stderr = '';
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun(stdout.trim()) : reject(new Error(`${command} exited with ${code}: ${stderr}`)));
});

try {
  await stat(outputRoot);
  throw new Error(`refusing to overwrite existing output: ${outputRoot}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(outputRoot, { recursive: true });

const exported = "EXPORTED_FUNCTIONS=['_init_ai','_ai_js','_set_seed','_get_last_depth','_get_last_book_hit','_get_last_is_end_search','_get_last_score','_get_last_nodes_low','_get_last_nodes_high','_stop','_resume','_malloc','_free']";
const exportedRuntime = "EXPORTED_RUNTIME_METHODS=['HEAP32','HEAPU8']";
const compileArgs = [
  'Egaroucid_for_Web.cpp', '-o', '/out/ai.js', '-s', 'WASM=1', '-s', exported,
  '-s', exportedRuntime, '-O3', '-s', `TOTAL_MEMORY=${initialMemoryBytes}`,
  '-s', `MAXIMUM_MEMORY=${maximumMemoryBytes}`, '-s', 'ALLOW_MEMORY_GROWTH=1',
];
const dockerBase = ['run', '--rm', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`];
const toolchainVersion = await capture('docker', [
  ...dockerBase, image, 'em++', '--version',
]);
await run('docker', [
  ...dockerBase,
  '-v', `${sourceRoot}:/src:ro`,
  '-v', `${outputRoot}:/out`,
  '-w', '/src/src',
  image,
  'em++', ...compileArgs,
]);

function readU32(bytes, cursor) {
  let value = 0;
  let shift = 0;
  while (true) {
    const byte = bytes[cursor.offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
    if (shift > 35) throw new Error('invalid unsigned LEB128');
  }
}

async function inspectMemory(path) {
  const bytes = await readFile(path);
  if (bytes.subarray(0, 4).toString('hex') !== '0061736d') throw new Error('rebuilt ai.wasm is not WebAssembly');
  const cursor = { offset: 8 };
  while (cursor.offset < bytes.length) {
    const sectionId = bytes[cursor.offset++];
    const sectionSize = readU32(bytes, cursor);
    const sectionEnd = cursor.offset + sectionSize;
    if (sectionId === 5) {
      if (readU32(bytes, cursor) !== 1) throw new Error('expected one WebAssembly memory declaration');
      const flags = readU32(bytes, cursor);
      const initialPages = readU32(bytes, cursor);
      const maximumPages = (flags & 1) === 1 ? readU32(bytes, cursor) : null;
      return { flags, initialPages, maximumPages, initialBytes: initialPages * 65536, maximumBytes: maximumPages * 65536 };
    }
    cursor.offset = sectionEnd;
  }
  throw new Error('WebAssembly memory declaration not found');
}

const files = {};
for (const name of ['ai.js', 'ai.wasm']) {
  const path = resolve(outputRoot, name);
  const metadata = await stat(path);
  const actualHash = await sha256(path);
  const expected = productManifest.files[name];
  if (actualHash !== expected.sha256 || metadata.size !== expected.bytes) {
    throw new Error(`${name} does not match the product artifact: ${actualHash} (${metadata.size} bytes)`);
  }
  files[name] = { bytes: metadata.size, sha256: actualHash, matchesProduct: true };
}
const memory = await inspectMemory(resolve(outputRoot, 'ai.wasm'));
if (memory.initialPages !== 1024 || memory.maximumPages !== 2048) throw new Error(`unexpected memory declaration: ${JSON.stringify(memory)}`);

const result = {
  schemaVersion: 1,
  source: { tag: 'v7.8.4', commit: '3b1c6ad380209162c2ad07aefe5c1fc6fd8072cb' },
  toolchain: { emscripten: '4.0.22', image, versionOutput: toolchainVersion },
  command: ['em++', ...compileArgs],
  settings: { initialMemoryBytes, maximumMemoryBytes, allowMemoryGrowth: true },
  memory,
  files,
};
await writeFile(resolve(outputRoot, 'rebuild-manifest.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
