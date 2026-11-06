import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const archive = resolve(process.env.TASK11_EGAROUCID_ARCHIVE ?? '/tmp/egaroucid-v7.8.4.tar.gz');
const workRoot = resolve(root, '.work/memory-capped');
const extractRoot = resolve(workRoot, 'source');
const sourceRoot = resolve(extractRoot, 'Egaroucid-7.8.4');
const patchPath = resolve(root, 'patches/v7.8.4-prototype.patch');
const originalRoot = resolve(root, '.artifacts');
const previous64Root = resolve(root, '.work/memory-comparison/64m');
const expectedArchiveHash = '85c88f57c0b8cec38c22ca02a408cd475f6dabe7e10be1ddc297ac3bead49376';
const expectedOriginalHashes = {
  'ai.js': 'c81d598a9bed35081e3d2b4a7678dff01dcf1a7df6ace6ca3f2bb49d3787d3d6',
  'ai.wasm': '3acc62e93b84bd55aeb50dd6a6af90a653b7be8e18a31bd4e78a54ba5511141f',
};
const expectedPrevious64Hashes = {
  'ai.js': 'c81d598a9bed35081e3d2b4a7678dff01dcf1a7df6ace6ca3f2bb49d3787d3d6',
  'ai.wasm': '44be014b09a191324edac0a1c922d4d869b44f03929fbc8d6aae420dbf638e81',
};
const toolchainImage = 'emscripten/emsdk@sha256:a08b927777707813e64af195db105f935bd554f5825606b2048031151a9635f5';
const initialMemoryBytes = 64 * 1024 * 1024;
const maximumMemoryBytes = 128 * 1024 * 1024;
const outputs = ['64m-max128m', 'rebuild-64m-max128m'];

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const fileEvidence = async (path) => ({
  bytes: (await readFile(path)).byteLength,
  sha256: await sha256(path),
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

async function inspectMemoryDeclaration(path) {
  const bytes = await readFile(path);
  if (bytes.subarray(0, 4).toString('hex') !== '0061736d') throw new Error('not a WebAssembly binary');
  const cursor = { offset: 8 };
  while (cursor.offset < bytes.length) {
    const sectionId = bytes[cursor.offset++];
    const sectionSize = readU32(bytes, cursor);
    const sectionEnd = cursor.offset + sectionSize;
    if (sectionId === 5) {
      const count = readU32(bytes, cursor);
      if (count !== 1) throw new Error(`expected one memory declaration, found ${count}`);
      const flags = readU32(bytes, cursor);
      const initialPages = readU32(bytes, cursor);
      const maximumPages = (flags & 1) === 1 ? readU32(bytes, cursor) : null;
      return { flags, initialPages, maximumPages, initialBytes: initialPages * 65536, maximumBytes: maximumPages === null ? null : maximumPages * 65536 };
    }
    cursor.offset = sectionEnd;
  }
  throw new Error('WebAssembly memory section not found');
}

async function verifyHashes(rootPath, expected, label) {
  for (const [file, hash] of Object.entries(expected)) {
    const actual = await sha256(resolve(rootPath, file));
    if (actual !== hash) throw new Error(`${label} ${file} SHA-256 mismatch: ${actual}`);
  }
}

await verifyHashes(originalRoot, expectedOriginalHashes, 'original');
await verifyHashes(previous64Root, expectedPrevious64Hashes, 'previous 64 MiB');
if (await sha256(archive) !== expectedArchiveHash) throw new Error('Egaroucid source archive SHA-256 mismatch');

await rm(workRoot, { recursive: true, force: true });
await mkdir(extractRoot, { recursive: true });
await run('tar', ['-xzf', archive, '-C', extractRoot]);
await runWithInput('patch', ['-p1', '--forward', '--batch'], await readFile(patchPath), { cwd: sourceRoot });

const protectedSourceFiles = ['src/web/book_const.hpp', 'src/web/evaluate_const.hpp'];
const protectedSourceHashes = Object.fromEntries(await Promise.all(protectedSourceFiles.map(async (file) => [file, await sha256(resolve(sourceRoot, file))])));
const exported = "EXPORTED_FUNCTIONS=['_init_ai','_ai_js','_set_seed','_get_last_depth','_get_last_book_hit','_get_last_is_end_search','_get_last_score','_get_last_nodes_low','_get_last_nodes_high','_stop','_resume','_malloc','_free']";
const exportedRuntime = "EXPORTED_RUNTIME_METHODS=['HEAP32','HEAPU8']";
const compileArgs = [
  'Egaroucid_for_Web.cpp', '-o', '/out/ai.js', '-s', 'WASM=1', '-s', exported,
  '-s', exportedRuntime, '-O3', '-s', `TOTAL_MEMORY=${initialMemoryBytes}`,
  '-s', `MAXIMUM_MEMORY=${maximumMemoryBytes}`, '-s', 'ALLOW_MEMORY_GROWTH=1',
];
const builds = {};
for (const name of outputs) {
  const output = resolve(workRoot, name);
  await mkdir(output, { recursive: true });
  await run('docker', [
    'run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`,
    '-v', `${sourceRoot}:/src:ro`, '-v', `${output}:/out`, '-w', '/src/src',
    toolchainImage, 'em++', ...compileArgs,
  ]);
  await run('docker', [
    'run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`,
    '-v', `${output}:/out`, toolchainImage,
    '/emsdk/upstream/bin/wasm-dis', '/out/ai.wasm', '-o', '/out/ai.wat',
  ]);
  builds[name] = {
    output,
    command: ['em++', ...compileArgs],
    files: {
      'ai.js': await fileEvidence(resolve(output, 'ai.js')),
      'ai.wasm': await fileEvidence(resolve(output, 'ai.wasm')),
    },
    memory: await inspectMemoryDeclaration(resolve(output, 'ai.wasm')),
  };
}

const canonical = builds['64m-max128m'];
const repeated = builds['rebuild-64m-max128m'];
const repeatedBuildsByteIdentical = ['ai.js', 'ai.wasm'].every((file) => canonical.files[file].sha256 === repeated.files[file].sha256);
if (!repeatedBuildsByteIdentical) throw new Error('repeated builds are not byte-identical');
if (canonical.memory.initialPages !== 1024 || canonical.memory.maximumPages !== 2048) {
  throw new Error(`unexpected memory declaration: ${JSON.stringify(canonical.memory)}`);
}

const oldMemory = await inspectMemoryDeclaration(resolve(previous64Root, 'ai.wasm'));
await run('docker', [
  'run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`,
  '-v', `${previous64Root}:/old:ro`, '-v', `${workRoot}:/out`, toolchainImage,
  '/emsdk/upstream/bin/wasm-dis', '/old/ai.wasm', '-o', '/out/previous-64m.wat',
]);
const oldWat = (await readFile(resolve(workRoot, 'previous-64m.wat'), 'utf8')).split('\n');
const newWat = (await readFile(resolve(workRoot, '64m-max128m/ai.wat'), 'utf8')).split('\n');
const watDifferences = [];
for (let index = 0; index < Math.max(oldWat.length, newWat.length); index += 1) {
  if (oldWat[index] !== newWat[index]) watDifferences.push({ line: index + 1, previous: oldWat[index] ?? null, capped: newWat[index] ?? null });
}
if (watDifferences.length !== 1 || !watDifferences[0].previous?.includes('(memory') || !watDifferences[0].capped?.includes('(memory')) {
  throw new Error(`WAT differs outside the single memory declaration: ${JSON.stringify(watDifferences.slice(0, 10))}`);
}

await verifyHashes(originalRoot, expectedOriginalHashes, 'preserved original');
await verifyHashes(previous64Root, expectedPrevious64Hashes, 'preserved previous 64 MiB');
for (const [file, expected] of Object.entries(protectedSourceHashes)) {
  if (await sha256(resolve(sourceRoot, file)) !== expected) throw new Error(`${file} changed during build`);
}

const manifest = {
  schemaVersion: 1,
  purpose: 'Task 11 isolated 64 MiB initial / 128 MiB maximum variant; no engine, Book, or evaluation changes',
  source: { tag: 'v7.8.4', commit: '3b1c6ad380209162c2ad07aefe5c1fc6fd8072cb', archiveSha256: expectedArchiveHash },
  prototypePatchSha256: await sha256(patchPath),
  toolchain: { emscripten: '4.0.22', image: toolchainImage },
  settings: { initialMemoryBytes, maximumMemoryBytes, allowMemoryGrowth: true, initialSettingCompatibility: 'TOTAL_MEMORY is retained from the verified 64 MiB recipe; MAXIMUM_MEMORY is the only newly added memory setting' },
  protectedArtifacts: { original: expectedOriginalHashes, previous64MiB: expectedPrevious64Hashes },
  protectedSourceHashes,
  builds,
  repeatedBuildsByteIdentical,
  previous64MiBComparison: {
    memory: oldMemory,
    watDifferenceCount: watDifferences.length,
    watDifferences,
    wasmByteIdentical: expectedPrevious64Hashes['ai.wasm'] === canonical.files['ai.wasm'].sha256,
    jsByteIdentical: expectedPrevious64Hashes['ai.js'] === canonical.files['ai.js'].sha256,
  },
};
await writeFile(resolve(workRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
