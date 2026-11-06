# Third-party notices for the Release 1 frontend source snapshot

This notice covers the third-party runtime components included in, or used to
produce, the Release 1 frontend artifacts. The source snapshot also retains
license files shipped by the upstream projects.

## Egaroucid for Web v7.8.4

- Project: <https://github.com/Nyanyan/Egaroucid>
- Fixed commit: `3b1c6ad380209162c2ad07aefe5c1fc6fd8072cb`
- License: GNU General Public License version 3 or later, as stated by the
  upstream README and source headers
- Copyright: Takuto Yamana and Egaroucid contributors

The complete unmodified upstream source, the applied patch, the patched source,
the GPL text, the build recipe, and the product integration notice are included
in the source snapshot. See `frontend/public/egaroucid/NOTICE.txt` for the
modification summary.

## React 19.3.1, React DOM 19.3.1, and Scheduler 0.28.0

- Project: <https://github.com/facebook/react>
- License: MIT
- Copyright: Meta Platforms, Inc. and affiliates

All three packages ship the same MIT license text. A retained copy is at
`third_party/licenses/React-MIT.txt` (SHA-256
`da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93`).
Exact package versions are fixed by `package-lock.json`.

## Emscripten 4.0.22 and emsdk

The exact license texts used for the fixed build image are retained at:

- `frontend/public/egaroucid/Emscripten-LICENSE.txt`
- `frontend/public/egaroucid/emsdk-LICENSE.txt`

The toolchain commit and container image digest are recorded in
`frontend/public/egaroucid/artifact-manifest.json`.
