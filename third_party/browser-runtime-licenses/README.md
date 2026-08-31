# Browser Runtime License Bundle

This directory vendors the license and notice files shipped with the exact
production dependency closure used to build the committed offline WebDemo. The
machine-readable [`inventory.json`](inventory.json) is derived from
`web_demo/package-lock.json`; it records every production package name, version,
source, notice path, and SHA-256.

| Package | Version | Source path | Vendored files |
| --- | --- | --- | --- |
| ONNX Runtime | 1.29.0 | [`microsoft/onnxruntime` tag `v1.29.0`](https://github.com/microsoft/onnxruntime/tree/v1.29.0), matching `onnxruntime-web@1.29.0` | `onnxruntime/LICENSE`, `onnxruntime/ThirdPartyNotices.txt` |
| React | 19.2.8 | `web_demo/node_modules/react/` | `react/LICENSE` |
| react-dom | 19.2.8 | `web_demo/node_modules/react-dom/` | `react-dom/LICENSE` |
| scheduler | 0.27.0 | `web_demo/node_modules/scheduler/` | `scheduler/LICENSE` |
| @jsquash/jpeg | 1.6.0 | `web_demo/node_modules/@jsquash/jpeg/` | `jsquash-jpeg/LICENSE`, `jsquash-jpeg/codec/LICENSE.codec.md` |
| @jsquash/png | 3.1.1 | `web_demo/node_modules/@jsquash/png/` | `jsquash-png/LICENSE`, `jsquash-png/codec/LICENSE.codec.md` |
| @jsquash/webp | 1.5.0 | `web_demo/node_modules/@jsquash/webp/` | `jsquash-webp/LICENSE`, `jsquash-webp/codec/LICENSE.codec.md` |
| @jsquash/resize | 2.1.1 | `web_demo/node_modules/@jsquash/resize/` | `jsquash-resize/LICENSE`, `jsquash-resize/lib/hqx/LICENSE.codec.md`, `jsquash-resize/lib/magic-kernel/LICENSE.codec.md`, `jsquash-resize/lib/resize/LICENSE.codec.md` |

The inventory also covers `onnxruntime-web`, `onnxruntime-common`,
`wasm-feature-detect`, `flatbuffers`, `guid-typescript`, `long`, `platform`,
`protobufjs`, every resolved `@protobufjs/*` package, `@types/node`, and
`undici-types`. The published `guid-typescript@1.0.9` package contains no
standalone license file, so its byte-exact `package.json` is retained as the
package's ISC license metadata evidence. No package is inferred from a
development-only dependency.

The bundled Windows and macOS Python runtime archives retain their internal license trees.
In particular, the Windows archive retains `LICENSE.txt`, and
the macOS archive retains the Python license and pip's vendored license tree.

This inventory records the bundled source notices; it is not a legal certification.
