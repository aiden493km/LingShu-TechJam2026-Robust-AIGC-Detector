# LingShu Offline FP32 WebDemo

## Judge quick start

> Submission handoff: use the submitted Git revision that contains this
> `web_demo/` directory and its model. Before this feature branch is merged and
> published, do not assume that an older default-branch checkout already contains
> the WebDemo.

1. Clone the submitted repository revision, or download that revision with
   GitHub's **Download ZIP** and extract it completely.
2. Double-click `web_demo/start-demo.bat`.
3. Keep the launcher window open and wait for the local browser tab. The page is
   ready when it reports that the verified FP32 model is loaded.
4. Choose or drop one JPEG, PNG, or WebP still image and read the AIGC confidence,
   Real/AIGC decision, and execution provider.

The formally validated Windows judge path requires Python 3.11 or newer and a
current Microsoft Edge installation. The production site, FP32 ONNX model, and
browser runtime are already included. After the repository has been obtained,
normal launch and inference require no Node.js, npm install, pip install, Git LFS,
model download, API key, Internet connection, or inference server.

## What happens at launch

The launcher first verifies the committed model and every production asset. It
then starts a Python-standard-library server bound only to `127.0.0.1`, selects an
available loopback port beginning at 8765, and opens that local URL in the default
browser.

The browser loads the 88,123,029-byte (84.04 MiB) FP32 model from the local checkout
into browser memory. This is a local disk-to-browser transfer, not an Internet
download. First-load time therefore varies with the judge's disk, CPU, browser,
and security software; the recorded timings are not a promise for another
computer.

The page attempts WebGPU first. If WebGPU is unavailable or session creation fails,
it automatically uses WASM with the **same FP32 ONNX file**. The provider shown in
the result is the provider that actually ran; there is no FP16, INT8, remote-API,
or mock-result fallback.

## Input limits and result meaning

- One still image at a time: JPEG, PNG, or WebP, validated from its bytes.
- Maximum file size: 25 MiB.
- Maximum geometry: 16,384 pixels on either side and 33,554,432 total pixels.
- Animated, malformed, truncated, TIFF, and BMP inputs are rejected before
  inference.
- The displayed confidence is the estimated probability that the image is
  AI-generated. A probability greater than or equal to the frozen threshold
  `0.55657113` is labeled `AIGC`; a lower probability is labeled `Real`.

Use **Reset** to release the current preview and analyze another image. The model
session remains loaded for the next inference.

## Privacy and shutdown

The selected image is decoded and analyzed by the browser application. The
application code does not upload its bytes to the local Python process, send them
to an external origin, log or hash them, or deliberately persist them. The Python
process only serves the committed static site, manifest, runtime files, and model
over loopback. The formally exercised runtime made no request to a CDN, analytics
service, model host, API, or other remote origin. Browser and operating-system
memory management remain outside the application's control.

Keep the launcher window open while using the page. Press `Ctrl+C` in that window,
or close the launcher window, to stop the local server; the local page will then
become unreachable. Closing only the browser tab does not stop the launcher.

## Validation and manual launch commands

Run these commands from the repository root in Windows PowerShell:

```powershell
# Verify all committed runtime artifacts without opening a browser or a port.
.\web_demo\start-demo.bat --check

# Start normally with an explicit Python command.
python .\web_demo\tools\serve_demo.py

# Start without opening the default browser; use the printed READY URL.
python .\web_demo\tools\serve_demo.py --no-browser

# Require one specific loopback port. This fails clearly if the port is occupied.
python .\web_demo\tools\serve_demo.py --port 8766
```

The examples use `python`. If the launcher instead finds `py -3` or the repository
`.venv\Scripts\python.exe`, use that successful interpreter prefix for the three
manual `serve_demo.py` commands.

Without `--port`, the server tries `127.0.0.1:8765` through
`127.0.0.1:8784`, then asks the operating system for another available loopback
port. On macOS or Linux, run `./web_demo/start-demo.sh` from a terminal.

## Browser status

- **Microsoft Edge:** the formal Windows 11 automation used headless Edge
  `151.0.4129.107`; its harness passed `--enable-unsafe-webgpu` to exercise WebGPU
  and also exercised WASM. This validates both application paths under the recorded
  harness, not every headed Edge installation or graphics-driver configuration.
- **Google Chrome:** an intended Windows project target, but a separate complete
  formal Chrome acceptance run has not yet been recorded. The committed formal
  evidence is Edge-only.
- **Firefox and Safari:** best-effort compatibility through WASM; they are not
  release-blocking targets for the Windows one-click workflow.

For judging, use a current Microsoft Edge release when possible.

## Troubleshooting

### The launcher says Python is missing or too old

Install or repair Python 3.11 or newer, then open a new terminal and check:

```powershell
py -3 --version
python --version
```

At least one command must resolve to Python 3.11+. The launcher tests a repository
`.venv` first, then `py -3`, then `python`; it accepts an interpreter only after a
real version probe succeeds.

### Windows reports that `python312.dll` is missing

That dialog indicates an incomplete Python 3.12 installation or a stale virtual
environment, not a missing WebDemo model. Do not download an individual DLL from
an unofficial DLL site and do not copy `python.exe` by itself. Repair or reinstall
Python from the official Python distribution. If this is a developer checkout
with an old repository `.venv`, rename that local environment out of the way or
recreate it from the repaired interpreter, then retry the BAT launcher.

### `Distribution verification failed`

Read every path/hash error printed in the launcher. The checkout or extracted ZIP
is incomplete, stale, or modified if the model, WASM/MJS runtime, production build,
or integrity manifest does not match. Obtain and fully extract the submitted
revision again; do not substitute a model from an untrusted source.

### The browser tab does not open

Keep the launcher window open and copy the printed `READY http://127.0.0.1:.../`
address into Edge. Alternatively, start with `--no-browser` and open that exact
address manually. Do not replace `127.0.0.1` with a LAN address.

### Model loading appears slow

Wait for the 84.04 MiB local FP32 load to finish. Initial verification and browser
session creation are machine-specific. A subsequent image normally reuses the
loaded session; do not close the launcher between images.

### The page reports WASM instead of WebGPU

This is the intended compatibility path and still uses the exact FP32 model. Update
Edge and the graphics driver if WebGPU is desired. If both WebGPU and WASM fail,
copy the page's diagnostic details and run the `--check` command above.

### An image is rejected

Choose one non-animated JPEG, PNG, or WebP within the byte and geometry limits.
Changing only a filename extension does not change the encoded format.

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

The dated browser experiment report retains FP16 and INT8 measurements as
historical research. The team's formal local-demo decision is FP32 only: FP16 was
not selected for the CPU/WASM path, and the tested dynamic INT8 variants showed
unacceptable drift and threshold flips. Shipping one model also keeps WebGPU and
WASM on one auditable identity.

## Direct browser dependency licenses

The pinned versions are recorded in [`package-lock.json`](package-lock.json).
Package-level license declarations for the direct runtime dependencies are:

| Dependency | Version | License |
|---|---:|---|
| React / React DOM | 19.2.8 | MIT |
| Scheduler | 0.27.0 | MIT |
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
