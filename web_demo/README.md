# LingShu Offline FP32 WebDemo

## Judge quick start

Clone the submitted revision, then follow the four-step row for your computer:

| Windows x86-64 | macOS on Apple Silicon |
|---|---|
| 1. Clone or fully extract the repository.<br>2. Double-click `web_demo/start-demo.bat`.<br>3. Wait for the printed `READY` URL and model-ready page.<br>4. Select or drop an image. | 1. Clone or fully extract the repository.<br>2. Double-click `web_demo/start-demo.command`.<br>3. Wait for the printed `READY` URL and model-ready page.<br>4. Select or drop an image. |

The portable slice bundles its CPython runtime, production browser files, and exact
FP32 model. Judges do not need to install Python, Node.js, npm packages, or an
inference server. Normal launch and inference are offline after the repository is
obtained. Windows is packaged only for x86-64 and macOS only for Apple Silicon;
Intel macOS has no bundled runtime in this slice.

## What the portable launcher does

The launcher verifies the committed distribution and runtime archive. On the first
launch it extracts the runtime and creates the cache at
`web_demo/.runtime-cache/`; subsequent launches verify and reuse the cache. It then
serves the included application only on `127.0.0.1`, tries ports 8765–8784 in
order, and uses an operating-system ephemeral port if all twenty are occupied.
Wait for the exact `READY http://127.0.0.1:.../` line before using the page.

The browser loads `baseline2_njr_fp32.onnx` from the local checkout and performs
inference in the page. WebGPU is attempted first and WASM is the automatic
compatibility path for the same FP32 file. A score at or above the frozen threshold
`0.55657113` is labeled `AIGC`; a lower score is labeled `Real`.

## Privacy, options, and shutdown

The loopback-only server provides static files and the model. The selected image is
decoded and analyzed in the browser; the application does not upload its bytes to
the server or an external service, deliberately persist them, or log or hash them.
Browser and operating-system memory management remain outside the application's
control.

Keep the launcher window open during use. Press `Ctrl+C` in that window, or close
the launcher window, to stop the server. Closing only the browser tab does not stop
it.

The same options work after either launcher filename:

| Option | Effect |
|---|---|
| `--check` | Verify the model, assets, and bundled runtime without opening a browser or binding a port. |
| `--no-browser` | Start locally but do not open a browser; copy the printed `READY` URL yourself. |

## macOS Gatekeeper

The bundled interpreter is not signed with a Developer ID. If Gatekeeper blocks
it, open **System Settings → Privacy & Security → Open Anyway**, approve the
interpreter, and retry `web_demo/start-demo.command`.

## Input limits

- One still JPEG, PNG, or WebP image at a time, validated from its bytes.
- Maximum file size: 25 MiB.
- Maximum geometry: 16,384 pixels on either side and 33,554,432 total pixels.
- Animated, malformed, truncated, TIFF, and BMP inputs are rejected before
  inference.

Use **Reset** to release the current preview and analyze another image. The model
session remains loaded for the next inference.

## Package measurements

At Task 4 implementation commit
`3036c0cad46934aa83ac4fe0574b99e6cd99a1fa`, the tracked Git blob size is
`166,912,403 bytes` (`159.180072 MiB`); this is not checkout size, repository
history size, or clone transfer size. The two bundled runtime archives total
exactly `36,103,844 bytes` (`34.431309 MiB`).

## Troubleshooting and verification boundary

- If a browser tab does not open, keep the launcher running and copy its printed
  `READY` URL. `--no-browser` makes this workflow explicit.
- If distribution verification fails, obtain and fully extract the submitted
  revision again rather than substituting files; the checkout is incomplete,
  stale, or modified if a recorded path, byte count, or hash does not match.
- Initial model verification and the 88,123,029-byte local model load can take
  longer on a slower disk or CPU. Wait for the model-ready page before selecting
  an image.
- WASM is an intended path using the exact same FP32 model when WebGPU is
  unavailable.
- If an image is rejected, choose a non-animated JPEG, PNG, or WebP within the
  byte and geometry limits; renaming an extension does not change its format.

A current Microsoft Edge was used for the formal Windows browser acceptance run.
Other browsers use the same application and WASM compatibility path, but no claim
is made here that CI smoke alone validates their headed behavior.

The `WebDemo portable launchers` CI smoke runs unit tests and `--check` on Windows
and Apple Silicon macOS. It is not a substitute for Finder double-click behavior
or real browser inference; the formal browser acceptance evidence remains under
[`results/web_demo_acceptance/`](../results/web_demo_acceptance/).

## Developer setup and audit gates

Judges do not need this section. The complete recorded audit requires Git, Windows,
an installed Microsoft Edge, npm, and Node.js `^20.19.0`, `^22.12.0`, or `>=24.0.0`
(the intersection supported by the pinned Vite and Vitest versions), plus the
pinned Python experiment environment. Use any working Python 3.12 command; the
example below uses `python`, while another installation may expose `py -3.12`
instead:

```powershell
# From the repository root
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-web-experiment.txt

Set-Location web_demo
npm.cmd ci
Set-Location ..

.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Set-Location web_demo
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:browser-acceptance
npm.cmd run test:preprocess-parity
npm.cmd run verify:dist
```

`verify:dist` rebuilds the production site and fails if the committed `dist/`
differs from source. Browser acceptance and preprocessing parity write disposable
raw outputs under the ignored `web_demo/.generated-tests/` directory. To refresh
formal evidence, first test a clean committed tree, run browser acceptance and
preprocessing parity in that order, then run:

```powershell
npm.cmd run record:acceptance-evidence
```

The recorder validates provenance before updating the fixed evidence file. See
[`results/web_demo_acceptance/README.md`](../results/web_demo_acceptance/README.md)
for the evidence workflow and
[`latest.json`](../results/web_demo_acceptance/latest.json) for the current formal
record. This is deployment parity evidence, not a new accuracy evaluation.

## Frozen model provenance

| Artifact | Distribution | Bytes | SHA-256 |
|---|---|---:|---|
| PyTorch source checkpoint `baseline2_njr_best.pt` | GitHub Release `v1.0.0`; used by the Python CLI/export path | 87,312,599 | `9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba` |
| Browser model `baseline2_njr_fp32.onnx` | `web_demo/models/`, committed as an ordinary Git blob | 88,123,029 | `e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69` |

The ONNX file is an FP32 opset-18 export of the frozen release checkpoint, not a
separately trained model. Its contract is `input` float32 `[1,3,384,384]` to
`logits` float32 `[1,1]`, followed by sigmoid and the frozen threshold. The model
is ordinary Git content rather than Git LFS, so a complete submitted clone or ZIP
contains real model bytes without an LFS client.

## Browser runtime dependency licenses

The pinned versions are recorded in [`package-lock.json`](package-lock.json).
Package-level license declarations for the main runtime components are:

| Dependency | Version | License |
|---|---:|---|
| React / React DOM | 19.2.8 | MIT |
| Scheduler (via React DOM) | 0.27.0 | MIT |
| ONNX Runtime Web | 1.29.0 | MIT |
| `@jsquash/jpeg` | 1.6.0 | Apache-2.0 (bundled codec notices also apply) |
| `@jsquash/png` | 3.1.1 | Apache-2.0 (bundled codec notices also apply) |
| `@jsquash/resize` | 2.1.1 | Apache-2.0 (bundled codec notices also apply) |
| `@jsquash/webp` | 1.5.0 | Apache-2.0 (bundled codec notices also apply) |

Model and upstream-code attribution is recorded in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Developers redistributing a
rebuilt bundle should also preserve the license files and codec notices provided
by the pinned packages. That notice currently marks model/dataset review and the
complete runtime-license bundle as public-release gates; local technical acceptance
does not imply that those gates have been cleared.
