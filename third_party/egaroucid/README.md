# Egaroucid corresponding-source preparation

This directory records the source-to-artifact boundary for the Egaroucid for Web v7.8.4 product integration. The product JS/WASM pair and license notices are committed under `frontend/public/egaroucid/`, so a clean checkout can build and run the private development product without downloading from an external site at runtime.

## Fixed inputs

- Upstream: <https://github.com/Nyanyan/Egaroucid>
- Tag: `v7.8.4`
- Commit: `3b1c6ad380209162c2ad07aefe5c1fc6fd8072cb`
- Source archive SHA-256: `85c88f57c0b8cec38c22ca02a408cd475f6dabe7e10be1ddc297ac3bead49376`
- Patch: `experiments/egaroucid-wasm/patches/v7.8.4-prototype.patch`
- Patch SHA-256: `449eb0be046adbc895c863df2382118de24f0324bc2d62793c2a4a0580cc6715`
- Emscripten: 4.0.22, pinned image digest in the artifact manifest
- Build recipe: `experiments/egaroucid-wasm/scripts/build-memory-capped-variant.mjs`
- Product artifact manifest: `frontend/public/egaroucid/artifact-manifest.json`

The fixed `src/web/book_const.hpp` SHA-256 is `f91f15e0b8b5ec2ac60f3732a5f00af47442ade32193c98c9bd0d69f90327ed3`. The fixed `src/web/evaluate_const.hpp` SHA-256 is `1afbd2d422317869451103651d8bab657a537926a07f811325009963396bb84c`.

## Release 1-01 local clean snapshot

The private Git history intentionally does not track the full upstream source. Release 1-01 instead assembles a history-free candidate in the Git-ignored `.release1-local/` area with `scripts/create-release1-source-snapshot.mjs`. The export uses `release1-source-allowlist.json`; it does not copy the private repository and then try to remove unwanted files.

The local candidate contains:

1. The exact upstream archive and a fully expanded, unmodified v7.8.4 source tree.
2. The applied patch and a fully expanded patched source tree, including the fixed Book and evaluation headers.
3. The historical build recipe referenced by the product manifest and the standalone Release 1 rebuild recipe.
4. The React／TypeScript frontend, classic Egaroucid Worker, Shared rules, test fixtures, workspace configuration, lockfile, and required build scripts.
5. GPLv3, Egaroucid／Emscripten／emsdk notices, and the React／React DOM／Scheduler MIT notice and license.
6. A path／size／SHA-256／mode source inventory, explicit exclusions, reference product hashes, and a deterministic archive manifest.

The snapshot verifier rejects unmanifested files, symlinks, `.git` directories, group/world-writable files, common secret forms, local user paths, and known private／other-service identifiers. In a fresh archive extraction, run:

```bash
node scripts/verify-release1-source-snapshot.mjs .
node scripts/rebuild-release1-egaroucid.mjs
npm ci
npm run verify:egaroucid
npm run check:v2
npm run build:v2
node scripts/verify-release1-product-build.mjs
```

The fixed Emscripten container runs without network access. The rebuild must reproduce the product JS/WASM hashes and the 64 MiB initial／128 MiB maximum memory declaration. The frontend build is compared with `manifests/reference-product-artifacts.json`.

## Release 1-04 public source

The approved public corresponding-source repository is <https://github.com/shiroshiba-lab/reversi-game-source>, with product/source tag `v2.0.0`. The product license screen and NOTICE link to the matching GitHub Release page. The public Git tree and complete Release Asset contain:

1. The complete fixed v7.8.4 source, including Book and evaluation headers.
2. The applied patch, exact build script, lockfile/build inputs, Worker adapter and protocol, and the distributed React/TypeScript source.
3. GPLv3 text, retained GPL-3.0-or-later/copyright/no-warranty notices, modification date and description, and Emscripten/emsdk third-party notices.
4. A release manifest matching the distributed JS/WASM hashes and a stable source URL linked from the binary distribution.
5. Any separately identified preferred form or third-party condition discovered before release.

The public Git tree omits the fixed 257 MiB upstream archive and duplicate byte-exact unmodified tree from ordinary Git history. It retains the complete patched source, Book/evaluation data, patch, application integration source, recipes, notices, and its own inventory. The matching GitHub Release Asset contains the full clean snapshot, including the upstream archive and unmodified tree, with SHA-256 and a separate inventory.

Publication, anonymous download, tag/Release immutability, fresh archive rebuild, and final artifact hashes are Release 1-04 completion gates. Publishing the source does not deploy or authorize the production Reversi Board application.
