# Offline FP32 WebDemo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained local WebDemo that a judge can run from a fresh clone by double-clicking `web_demo/start-demo.bat`, with the frozen FP32 ONNX detector executing entirely in the browser.

**Architecture:** A committed React/TypeScript/Vite production build loads exactly one verified FP32 ONNX model and performs deterministic browser-side decode, EXIF orientation, Catmull–Rom bicubic resize, normalization, and inference. A Python-standard-library loopback server verifies all shipped artifacts, streams the model and static assets with isolation/security headers, and opens the browser; WebGPU is attempted first and the same FP32 runtime falls back to WASM.

**Tech Stack:** Python 3.11+ standard library, React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Vitest 4.1.11, ONNX Runtime Web 1.29.0, jSquash codecs/resizer, Playwright Core 1.62.1, Microsoft Edge/Google Chrome.

---

## Scope and execution contract

This plan implements the approved runtime-foundation specification, including a complete functional inference screen. It does not implement the later results exhibition, technical-route story, team profiles, or the final high-polish visual world. After Task 9 proves model and preprocessing parity, that separate visual slice must enter the Impeccable `init -> new-work -> craft-floor -> inspect -> finish-review` flow before its UI code is written.

Work in the user-requested checkout on branch `feat/web-demo`; do not create a second worktree. Use TDD for behavior: write each named test, observe the expected failure, then add only the implementation required for green. Commit after every task with the listed Conventional Commit message. Do not push unless the user asks.

## File map

```text
web_demo/
├── index.html                         # Vite document and functional screen mount
├── package.json                       # pinned build/test dependencies and commands
├── package-lock.json                  # reproducible developer dependency graph
├── tsconfig.json                      # strict browser TypeScript settings
├── vite.config.ts                     # static build and Vitest configuration
├── src/
│   ├── main.tsx                       # React entry
│   ├── App.tsx                        # functional judge-facing inference screen
│   ├── app.css                        # restrained functional layout only
│   ├── detector/
│   │   ├── machine.ts                 # explicit detector state transitions
│   │   └── use-detector.ts            # orchestration and object-URL lifecycle
│   └── runtime/
│       ├── contract.ts                # model-manifest types and validation
│       ├── upload.ts                  # byte-level format/size/animation validation
│       ├── exif.ts                    # JPEG EXIF orientation parsing and pixel transform
│       ├── preprocess.ts              # decode, orient, bicubic resize, CHW normalization
│       ├── math.ts                    # sigmoid and threshold decision
│       ├── model-session.ts            # model fetch, progress, WebGPU/WASM selection
│       ├── infer.ts                   # tensor execution and typed result
│       └── capabilities.ts            # auditable browser/runtime diagnostics
├── tests/
│   ├── unit/*.test.ts                 # Vitest behavior tests
│   ├── browser/preprocess-harness.*   # real-browser tensor parity harness
│   └── fixtures/                      # committed EXIF/non-square/gray/RGBA/near-threshold inputs
├── models/
│   ├── baseline2_njr_fp32.onnx        # one deployed model, ordinary Git blob
│   └── manifest.json                  # immutable provenance and tensor contract
├── dist/                               # committed judge runtime
├── tools/
│   ├── serve_demo.py                  # loopback-only verified static server
│   ├── copy_ort_runtime.mjs           # emit one ORT WASM asset directly into dist
│   ├── write_dist_integrity.mjs       # deterministic static-file integrity manifest
│   ├── verify_distribution.py         # model/build/repository invariants
│   ├── generate_parity_references.py  # Pillow/ONNX developer references
│   ├── run_preprocess_parity.mjs      # Edge tensor comparison
│   └── run_browser_acceptance.mjs     # built-app WebGPU/WASM/offline acceptance
├── start-demo.bat                     # Windows one-click entry
├── start-demo.sh                      # macOS/Linux terminal entry
└── README.md                           # judge and developer workflows

tests/
├── test_web_demo_server.py            # Python server unit/integration tests
├── test_web_demo_launcher.py          # launcher fallback/path behavior
└── test_web_demo_distribution.py      # committed artifact invariants
```

### Task 1: Scaffold the audited frontend workspace

**Files:**
- Create: `web_demo/package.json`
- Create: `web_demo/package-lock.json`
- Create: `web_demo/tsconfig.json`
- Create: `web_demo/vite.config.ts`
- Create: `web_demo/index.html`
- Create: `web_demo/src/main.tsx`
- Create: `web_demo/src/App.tsx`
- Create: `web_demo/src/app.css`
- Create: `web_demo/tests/unit/scaffold.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create the package manifest and strict compiler/build configuration**

Use this dependency contract; `npm install --save-exact` must produce the lock file rather than hand-authoring it:

```json
{
  "name": "lingshu-offline-web-demo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "vite build && node tools/write_dist_integrity.mjs",
    "verify:dist": "npm run build && git diff --exit-code -- dist"
  },
  "dependencies": {
    "@jsquash/jpeg": "1.6.0",
    "@jsquash/png": "3.1.1",
    "@jsquash/resize": "2.1.1",
    "@jsquash/webp": "1.5.0",
    "onnxruntime-web": "1.29.0",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "@vitejs/plugin-react": "6.1.1",
    "@webgpu/types": "0.1.72",
    "playwright-core": "1.62.1",
    "typescript": "7.0.2",
    "vite": "8.2.2",
    "vitest": "4.1.11"
  }
}
```

`tsconfig.json` must enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `DOM`, `DOM.Iterable`, `ES2023`, React JSX, and `@webgpu/types`. `vite.config.ts` must set `base: "/"`, build to `dist`, disable inline assets, and use the Node Vitest environment for pure unit tests.

- [ ] **Step 2: Install the pinned developer graph and create the lock file**

Run: `Set-Location web_demo; npm.cmd install --save-exact`

Expected: exit 0, `package-lock.json` exists, and `npm.cmd ls --depth=0` reports the exact versions above without `UNMET DEPENDENCY`.

- [ ] **Step 3: Write and observe a failing scaffold test**

```ts
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/App';

describe('frontend scaffold', () => {
  it('uses the frozen product name', () => {
    expect(APP_NAME).toBe('LingShu Robust AIGC Detector');
  });
});
```

Run: `npm.cmd test -- --run tests/unit/scaffold.test.ts`

Expected: FAIL because `src/App.tsx` or `APP_NAME` does not exist.

- [ ] **Step 4: Add the smallest semantic React shell**

```tsx
export const APP_NAME = 'LingShu Robust AIGC Detector';

export function App() {
  return <main><h1>{APP_NAME}</h1><p>Loading the verified FP32 detector…</p></main>;
}
```

Mount it from `main.tsx` with `createRoot`, import `app.css`, and give `index.html` a UTF-8 charset, responsive viewport, description, and `<div id="root"></div>`. The CSS may set legible system-font defaults only; do not establish the later visual world.

- [ ] **Step 5: Run the scaffold gates**

Run: `npm.cmd test -- --run tests/unit/scaffold.test.ts; npm.cmd run typecheck`

Expected: one passing test and TypeScript exit 0.

- [ ] **Step 6: Keep generated developer state out of Git and commit**

Add `web_demo/.generated-tests/`, `.impeccable/review/`, and `.impeccable/live/` to `.gitignore`; keep `web_demo/dist/` trackable.

```powershell
git add .gitignore web_demo/package.json web_demo/package-lock.json web_demo/tsconfig.json web_demo/vite.config.ts web_demo/index.html web_demo/src web_demo/tests/unit/scaffold.test.ts
git commit -m "build(web): scaffold offline demo workspace"
```

### Task 2: Freeze and validate the single-model contract

**Files:**
- Create: `web_demo/src/runtime/contract.ts`
- Create: `web_demo/tests/unit/contract.test.ts`
- Create: `web_demo/models/manifest.json`
- Create: `web_demo/tools/verify_distribution.py`
- Create: `tests/test_web_demo_distribution.py`

- [ ] **Step 1: Write failing TypeScript tests for exact manifest semantics**

The tests must verify: schema version 1; one filename `baseline2_njr_fp32.onnx`; byte size `88123029`; lowercase SHA-256 `e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69`; FP32/opset 18; input `input`, float32, `[1,3,384,384]`; output `logits`, float32, `[1,1]`; threshold `0.55657113`; and preprocessing order `exif_transpose`, `rgb`, `bicubic_384`, `to_tensor`, `imagenet_normalize`. Include one mutation test per field group and require an actionable `ModelContractError`.

```ts
const parsed = parseModelManifest(validManifest);
expect(parsed.model.precision).toBe('FP32');
expect(parsed.model.input.shape).toEqual([1, 3, 384, 384]);
expect(() => parseModelManifest({...validManifest, model: {...validManifest.model, precision: 'FP16'}}))
  .toThrow(/FP32/);
```

Run: `npm.cmd test -- --run tests/unit/contract.test.ts`

Expected: FAIL because `parseModelManifest` is missing.

- [ ] **Step 2: Implement a closed, typed validator**

Export `MODEL_FILE`, `MODEL_BYTES`, `MODEL_SHA256`, `FROZEN_THRESHOLD`, `ModelManifest`, `ModelContractError`, and `parseModelManifest(value: unknown): ModelManifest`. The parser must reject missing, extra precision variants, non-finite numbers, wrong tensor names/shapes/dtypes, a threshold outside `[0,1]`, and any preprocessing order mismatch. It must return a newly constructed object rather than casting the untrusted JSON.

- [ ] **Step 3: Add the immutable manifest**

```json
{
  "schema_version": 1,
  "model": {
    "file": "baseline2_njr_fp32.onnx",
    "bytes": 88123029,
    "sha256": "e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69",
    "format": "ONNX",
    "precision": "FP32",
    "opset": 18,
    "input": {"name": "input", "dtype": "float32", "shape": [1, 3, 384, 384]},
    "output": {"name": "logits", "dtype": "float32", "shape": [1, 1]}
  },
  "source": {
    "release_name": "v1.0.0 — Final B2-NJR Checkpoint",
    "tag": "v1.0.0",
    "checkpoint": {
      "file": "baseline2_njr_best.pt",
      "bytes": 87312599,
      "sha256": "9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba"
    },
    "exporter": {"script": "web_model_experiment.py", "commit": "c9ceb2e"}
  },
  "threshold": {"aigc": 0.55657113, "decision_rule": "probability >= threshold => AIGC"},
  "preprocessing": {
    "order": ["exif_transpose", "rgb", "bicubic_384", "to_tensor", "imagenet_normalize"],
    "resize": {"width": 384, "height": 384, "filter": "Catmull-Rom bicubic", "fit": "stretch"},
    "channel_order": "CHW RGB",
    "scale": "uint8 / 255",
    "mean": [0.485, 0.456, 0.406],
    "std": [0.229, 0.224, 0.225]
  }
}
```

- [ ] **Step 4: Write a failing Python distribution test**

`tests/test_web_demo_distribution.py` must create temporary fake model/build trees and assert that `verify_distribution(root)` reports wrong byte count, wrong SHA-256, extra `.onnx` files, an LFS pointer prefix, missing `dist/integrity.json`, and mismatched dist entries. It must accept one exact model and a self-consistent integrity file.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_distribution -v`

Expected: FAIL because `web_demo.tools.verify_distribution` is missing.

- [ ] **Step 5: Implement streaming distribution verification**

`verify_distribution.py` must use 1 MiB chunks, `hashlib.sha256`, resolved-path containment, and JSON validation. Return a list of all errors so the launcher can show every incomplete artifact in one run; CLI exit is 0 for none and 1 otherwise. It must never read the 84 MiB model into one Python byte string.

- [ ] **Step 6: Run both contract suites and commit**

Run: `npm.cmd test -- --run tests/unit/contract.test.ts; .\.venv\Scripts\python.exe -m unittest tests.test_web_demo_distribution -v`

Expected: all named tests pass.

```powershell
git add web_demo/src/runtime/contract.ts web_demo/tests/unit/contract.test.ts web_demo/models/manifest.json web_demo/tools/verify_distribution.py tests/test_web_demo_distribution.py
git commit -m "feat(web): freeze FP32 model contract"
```

### Task 3: Build the verified loopback-only static server

**Files:**
- Create: `web_demo/tools/serve_demo.py`
- Create: `tests/test_web_demo_server.py`

- [ ] **Step 1: Write failing server tests before the handler exists**

Cover these concrete behaviors with temporary directories and real HTTP requests:

```python
def test_routes_only_dist_and_models(self): ...
def test_rejects_encoded_parent_traversal(self): ...
def test_streams_onnx_with_octet_stream_mime(self): ...
def test_sends_isolation_csp_and_nosniff_headers(self): ...
def test_returns_404_for_non_root_extensionless_routes(self): ...
def test_returns_404_for_missing_js_wasm_or_model(self): ...
def test_exclusive_server_rejects_second_bind_on_windows(self): ...
def test_port_selection_falls_forward_from_8765(self): ...
```

For the conflict test, hold the first server socket open throughout the second bind. This specifically guards against Windows `SO_REUSEADDR` behavior.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server -v`

Expected: FAIL because `serve_demo` exports do not exist.

- [ ] **Step 2: Implement safe route resolution and headers**

Export `resolve_request_target`, `DemoRequestHandler`, `ExclusiveThreadingHTTPServer`, `bind_server`, `validate_runtime`, and `main`. Allow exactly `/models/manifest.json` and `/models/baseline2_njr_fp32.onnx` from `web_demo/models/`; map `/` to `web_demo/dist/index.html`; map other explicit filenames only inside `web_demo/dist/`. Do not provide a directory listing or arbitrary SPA fallback. Decode URL paths once, reject NUL, backslash, absolute paths and `..`, then prove `candidate.relative_to(root)` succeeds.

Send these headers on every response:

```python
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
        "style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; "
        "worker-src 'self' blob:; font-src 'self'; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'"
    ),
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
```

MIME overrides must include `.html`, `.css`, `.js`, `.mjs`, `.json`, `.wasm`, `.onnx`, and common local image formats. Copy through `shutil.copyfileobj` in bounded chunks.

- [ ] **Step 3: Make port selection exclusive and race-free**

Set `allow_reuse_address = False`. On Windows, set `socket.SO_EXCLUSIVEADDRUSE` before binding. Attempt each candidate by constructing the real server for ports 8765 through 8784; if all are unavailable, bind port 0 and use the assigned loopback port. Never probe with one socket and bind later with another.

- [ ] **Step 4: Add startup validation and CLI behavior**

`validate_runtime` must call the Task 2 verifier before any browser opens. CLI options are `--no-browser`, `--check`, and `--port`; `--check` validates and exits without listening. Normal mode prints the selected `http://127.0.0.1:<port>/`, opens it only after the server is listening, remains foreground-attached, handles Ctrl+C, closes the socket, and binds only `127.0.0.1`.

- [ ] **Step 5: Run the server suite and commit**

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server -v`

Expected: all server tests pass, including the live port-conflict test.

```powershell
git add web_demo/tools/serve_demo.py tests/test_web_demo_server.py
git commit -m "feat(web): add verified loopback demo server"
```

### Task 4: Add Windows and POSIX one-command launchers

**Files:**
- Create: `web_demo/start-demo.bat`
- Create: `web_demo/start-demo.sh`
- Create: `tests/test_web_demo_launcher.py`

- [ ] **Step 1: Write failing launcher integration tests**

The test must copy the launcher and server package into a temporary directory containing spaces and Chinese characters, supply tiny self-consistent fake model/dist artifacts, and invoke `cmd.exe /d /c start-demo.bat --check`. Add fake `py.cmd` and `python.cmd` executables on a temporary `PATH` to prove all three branches: a successful `py -3`, a present-but-failing `py -3` followed by successful `python`, and neither runtime available with an explanatory nonzero result. Test the shell script's `--check` path when `sh` is available.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher -v`

Expected: FAIL because launchers are absent.

- [ ] **Step 2: Implement the BAT fallback by execution result, not command presence**

The BAT file must `pushd "%~dp0"`, set UTF-8 code page, and test each candidate by actually executing `-c "import sys; raise SystemExit(sys.version_info < (3,11))"`. Probe a repository `.venv\Scripts\python.exe` first, then `py -3`, then `python`; after a probe succeeds, run `tools\serve_demo.py %*` once and return that server exit code without trying another interpreter. It must not use `where py` as proof that the launcher owns a runtime. Missing Python prints the Python 3.11+ requirement, manual command, and `pause`; `--check` must not pause in automated tests.

- [ ] **Step 3: Implement the POSIX launcher**

Resolve its own directory without relying on the caller's working directory, prefer `python3`, fall back to `python`, forward all arguments, and print the same requirement on failure. Use LF line endings and executable mode.

- [ ] **Step 4: Run launcher tests and commit**

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher -v`

Expected: all launcher tests pass in the real workspace and the Unicode temporary path.

```powershell
git add web_demo/start-demo.bat web_demo/start-demo.sh tests/test_web_demo_launcher.py
git update-index --chmod=+x web_demo/start-demo.sh
git commit -m "feat(web): add portable one-click launchers"
```

### Task 5: Implement byte-safe image validation and Pillow-aligned preprocessing

**Files:**
- Create: `web_demo/src/runtime/upload.ts`
- Create: `web_demo/src/runtime/exif.ts`
- Create: `web_demo/src/runtime/preprocess.ts`
- Create: `web_demo/tests/unit/upload.test.ts`
- Create: `web_demo/tests/unit/exif.test.ts`
- Create: `web_demo/tests/unit/preprocess.test.ts`
- Create: `web_demo/tests/fixtures/exif-orientation-6.jpg`
- Create: `web_demo/tests/fixtures/non-square.png`
- Create: `web_demo/tests/fixtures/grayscale.png`
- Create: `web_demo/tests/fixtures/rgba-hidden-rgb.png`
- Create: `web_demo/tests/fixtures/near-threshold-synthetic.png`

- [ ] **Step 1: Write failing upload tests**

Test the 25 MiB boundary, empty files, JPEG/PNG/WebP magic bytes regardless of filename, a spoofed extension, PNG `acTL`, WebP `ANIM`/`ANMF`, and unsupported BMP/TIFF/GIF signatures. The public API is:

```ts
export type SupportedImageFormat = 'jpeg' | 'png' | 'webp';
export async function validateImageFile(file: File): Promise<SupportedImageFormat>;
```

Run: `npm.cmd test -- --run tests/unit/upload.test.ts`

Expected: FAIL because validation is missing.

- [ ] **Step 2: Implement format validation before decode**

Reject size 0 or greater than `25 * 1024 * 1024`; read bytes without constructing HTML; identify by signature; scan PNG chunks for `acTL` and WebP chunks for `ANIM`/`ANMF`; return the detected format. Error text must name the accepted formats or size limit and must not echo bytes as markup.

- [ ] **Step 3: Write failing EXIF and pixel-orientation tests**

Use synthetic `ImageData` grids to verify orientations 1 through 8, including width/height swaps. Parse a minimal little-endian and big-endian JPEG APP1/TIFF orientation tag. Malformed lengths and values outside 1–8 must return orientation 1 without out-of-bounds reads.

Run: `npm.cmd test -- --run tests/unit/exif.test.ts`

Expected: FAIL because `readJpegOrientation` and `applyExifOrientation` are missing.

- [ ] **Step 4: Implement bounded EXIF parsing and all orientation maps**

Export `readJpegOrientation(buffer: ArrayBuffer): number` and `applyExifOrientation(image: ImageData, orientation: number): ImageData`. Iterate JPEG segments with `DataView`, accept only the EXIF TIFF orientation tag `0x0112`, honor byte order, and bounds-check every offset. Pixel mapping must preserve raw RGBA values, including RGB hidden under alpha 0.

- [ ] **Step 5: Write failing tensorization tests**

For a 2×1 RGBA input `[255,0,0,0, 0,255,0,128]`, prove alpha is ignored, output is planar CHW, values use `channel/255`, and ImageNet normalization is exact within `1e-6`. Verify that 384×384 input bypasses resize and that resize options are exactly:

```ts
{
  width: 384,
  height: 384,
  method: 'catrom',
  fitMethod: 'stretch',
  premultiply: false,
  linearRGB: false
}
```

Run: `npm.cmd test -- --run tests/unit/preprocess.test.ts`

Expected: FAIL because preprocessing is missing.

- [ ] **Step 6: Implement deterministic browser preprocessing**

Decode with the matching jSquash JPEG, PNG, or WebP decoder into raw `ImageData`; for JPEG apply the parsed EXIF orientation; skip resize only at exactly 384×384; otherwise call jSquash resize with the options above. Export:

```ts
export interface PreprocessedImage {
  tensor: Float32Array;
  originalWidth: number;
  originalHeight: number;
  orientedWidth: number;
  orientedHeight: number;
}

export function imageDataToNormalizedChw(image: ImageData): Float32Array;
export async function preprocessImage(file: File): Promise<PreprocessedImage>;
```

Always close or release decoder-owned resources in `finally`; do not create a remote URL or persist image bytes in this module.

- [ ] **Step 7: Generate and inspect committed fixture inputs**

Use a deterministic Pillow script during this step to create the first four named files: asymmetric colored quadrants with EXIF orientation 6, a 321×179 RGB pattern, a 384×384 grayscale ramp, and a 257×301 RGBA pattern containing distinct RGB under alpha 0/128/255. Generate `near-threshold-synthetic.png` by deterministically blending committed `demo_images/r2.png` and `demo_images/f1.png` over a fixed 0–1 grid, evaluating the deployed FP32 ONNX, and selecting the closest result to `0.55657113`; require its distance from the threshold to be at most `0.05` or stop the task. Label this fixture as synthetic parity data. Commit image inputs, not generated tensor references.

- [ ] **Step 8: Run all preprocessing unit tests and commit**

Run: `npm.cmd test -- --run tests/unit/upload.test.ts tests/unit/exif.test.ts tests/unit/preprocess.test.ts; npm.cmd run typecheck`

Expected: all preprocessing tests pass and TypeScript is clean.

```powershell
git add web_demo/src/runtime/upload.ts web_demo/src/runtime/exif.ts web_demo/src/runtime/preprocess.ts web_demo/tests/unit web_demo/tests/fixtures
git commit -m "feat(web): match browser image preprocessing contract"
```

### Task 6: Load and run one FP32 model with WebGPU-to-WASM fallback

**Files:**
- Create: `web_demo/src/runtime/math.ts`
- Create: `web_demo/src/runtime/model-session.ts`
- Create: `web_demo/src/runtime/infer.ts`
- Create: `web_demo/src/runtime/capabilities.ts`
- Create: `web_demo/tests/unit/math.test.ts`
- Create: `web_demo/tests/unit/model-session.test.ts`
- Create: `web_demo/tests/unit/infer.test.ts`

- [ ] **Step 1: Write failing probability/decision tests**

Test stable sigmoid for logits `-1000`, `0`, and `1000`; exact behavior immediately below, at, and above `0.55657113`; and rejection of NaN/infinite logits.

```ts
expect(classifyProbability(0.55657113)).toBe('AIGC');
expect(classifyProbability(0.55657112)).toBe('Real');
```

Run: `npm.cmd test -- --run tests/unit/math.test.ts`

Expected: FAIL because math functions are missing.

- [ ] **Step 2: Implement stable sigmoid and frozen decision**

Export `sigmoid(logit: number)`, `classifyProbability(probability: number)`, and the `DetectionLabel` union. Use the two-branch numerically stable sigmoid and the contract constant; reject non-finite inputs.

- [ ] **Step 3: Write failing provider-selection tests around an injected session creator**

Prove: WebGPU success uses `webgpu`; missing adapter goes directly to `wasm`; WebGPU creation failure records its message and retries `wasm`; diagnostic preference `wasm` skips WebGPU; both failures throw a typed error containing both provider diagnostics; only one model byte fetch occurs; and both attempts receive the same FP32 byte buffer and manifest.

```ts
const loaded = await chooseProvider({
  hasWebGpuAdapter: async () => true,
  create: async (provider) => provider === 'webgpu' ? Promise.reject(new Error('gpu failed')) : fakeSession,
});
expect(loaded.provider).toBe('wasm');
expect(loaded.fallbackReason).toMatch(/gpu failed/);
```

Run: `npm.cmd test -- --run tests/unit/model-session.test.ts`

Expected: FAIL because selection/session functions are missing.

- [ ] **Step 4: Implement the shared ORT WebGPU build and streamed model fetch**

Statically import `onnxruntime-web/webgpu`, configure `ort.env.wasm.wasmPaths.wasm` to the same-origin `/assets/ort-wasm-simd-threaded.asyncify.wasm`, set `proxy=false`, and set threads to `min(4, hardwareConcurrency)` only when `crossOriginIsolated`, otherwise 1. Fetch and parse `/models/manifest.json`; stream `/models/baseline2_njr_fp32.onnx` with progress callbacks and verify the response byte count before session creation. Normal mode attempts execution providers `['webgpu']` then `['wasm']` with the same module/model. The documented local diagnostic query `?provider=wasm` validates to a closed `auto | wasm` preference and starts directly on WASM; all other query values are ignored. Validate `session.inputNames` and `outputNames` against the manifest.

- [ ] **Step 5: Write failing inference tests**

With a minimal fake session, verify the feed name, float32 shape `[1,3,384,384]`, output name, sigmoid probability, label, provider, elapsed milliseconds, and rejection of tensors whose length is not `3*384*384`. A failed run must not return a stale result.

Run: `npm.cmd test -- --run tests/unit/infer.test.ts`

Expected: FAIL because `runDetection` is missing.

- [ ] **Step 6: Implement typed inference and capabilities**

Export `runDetection(session, provider, tensor, manifest): Promise<DetectionResult>`. `capabilities.ts` returns browser user agent, `crossOriginIsolated`, WebGPU API/adapter availability, WASM availability, hardware concurrency, and actual provider; it must not fingerprint beyond values needed for diagnostics and must not transmit them.

- [ ] **Step 7: Run runtime tests and commit**

Run: `npm.cmd test -- --run tests/unit/math.test.ts tests/unit/model-session.test.ts tests/unit/infer.test.ts; npm.cmd run typecheck`

Expected: all runtime tests pass.

```powershell
git add web_demo/src/runtime web_demo/tests/unit
git commit -m "feat(web): run FP32 detector with hardware fallback"
```

### Task 7: Connect the functional detector state and privacy-safe screen

**Files:**
- Create: `web_demo/src/detector/machine.ts`
- Create: `web_demo/src/detector/use-detector.ts`
- Create: `web_demo/tests/unit/machine.test.ts`
- Modify: `web_demo/src/App.tsx`
- Modify: `web_demo/src/app.css`

- [ ] **Step 1: Write failing state-machine tests**

Model these phases: `booting`, `ready`, `validating`, `preprocessing`, `inferring`, `success`, and `error`. Tests must prove that selecting a new file clears any previous score before validation, preprocessing/inference errors never retain a stale result, reset revokes only the preview and keeps the loaded session, and a WebGPU fallback note remains non-blocking.

Run: `npm.cmd test -- --run tests/unit/machine.test.ts`

Expected: FAIL because the reducer is missing.

- [ ] **Step 2: Implement the closed reducer and orchestration hook**

Use a discriminated union for states/events so impossible state combinations do not compile. `useDetector` loads one cached model session on mount, accepts exactly one file, validates then preprocesses then infers, creates one preview object URL only after validation, revokes the previous URL before replacement/reset and on unmount, and uses an operation token so late async completions cannot overwrite a reset or newer file.

- [ ] **Step 3: Replace the scaffold with the complete functional screen**

The semantic screen must include:

- product/title and explicit “Local FP32 · no upload” identity;
- one keyboard-accessible file input plus drag/drop target accepting JPEG, PNG and WebP;
- 25 MiB limit and one-image explanation before selection;
- preview with filename and original/oriented dimensions;
- determinate model byte progress and named preprocessing/inference phases;
- continuous AIGC confidence rendered as text and a native progress element;
- Real/AIGC label, frozen threshold, actual provider, elapsed time, FP32 model/tag identity;
- a visible WASM fallback note when present;
- reset/retry controls and actionable error diagnostics;
- privacy copy stating image bytes stay in browser memory and are neither uploaded nor saved.

Filenames must be React text nodes only. No `dangerouslySetInnerHTML`, remote font, CDN, analytics, remote image, or fabricated benchmark claim is allowed. The CSS must support 320 px through desktop widths, visible focus, `prefers-reduced-motion`, minimum 44 px controls, sufficient contrast, and no content hidden behind animation. Keep styling restrained because the Impeccable visual world is a later approved slice.

- [ ] **Step 4: Run functional tests and a production compile**

Run: `npm.cmd test; npm.cmd run typecheck; npm.cmd run build`

Expected: all Vitest tests pass, TypeScript exits 0, and Vite emits `dist/index.html` plus local assets.

- [ ] **Step 5: Commit the functional screen**

```powershell
git add web_demo/src web_demo/tests/unit web_demo/dist
git commit -m "feat(web): add privacy-safe detector workflow"
```

### Task 8: Package the ordinary-Git model and reproducible static build

**Files:**
- Create: `web_demo/models/baseline2_njr_fp32.onnx`
- Create: `web_demo/tools/copy_ort_runtime.mjs`
- Create: `web_demo/tools/write_dist_integrity.mjs`
- Modify: `web_demo/package.json`
- Modify: `.gitignore`
- Create: `.gitattributes`
- Modify: `web_demo/dist/**`

- [ ] **Step 1: Write a failing integrity-generation test**

Add a Vitest or Node test that creates a temporary `dist`, writes two files in reverse order, runs the exported `buildIntegrityManifest`, and expects stable lexicographic paths, byte sizes, lowercase SHA-256, no self-entry for `integrity.json`, and no path outside `dist`.

Run: `npm.cmd test -- --run tests/unit/dist-integrity.test.ts`

Expected: FAIL because the integrity writer is missing.

- [ ] **Step 2: Implement deterministic dist integrity metadata**

`copy_ort_runtime.mjs` must resolve `onnxruntime-web` through Node's package resolver, stream-copy only `ort-wasm-simd-threaded.asyncify.wasm` into `dist/assets/`, and reject a source byte size other than `25749873`. `write_dist_integrity.mjs` must then recursively enumerate regular files, reject symlinks, hash by stream, normalize paths to `/`, sort them, and write `dist/integrity.json` with schema version 1 plus `{path, bytes, sha256}` entries. Running the build twice without source changes must produce byte-identical JSON. Update `build` to run Vite, then the ORT copy, then integrity generation.

- [ ] **Step 3: Copy the one approved model and one ORT runtime binary**

Copy `web_models/baseline2_njr_fp32.onnx` to `web_demo/models/baseline2_njr_fp32.onnx`. Do not commit a second source copy of the ORT binary: the build script emits it directly from pinned `node_modules` into committed `dist/assets/`. Verify the ONNX source and destination hashes before staging; the destination must be exactly 88,123,029 bytes and the manifest hash above.

- [ ] **Step 4: Make only the approved ONNX trackable and mark it binary**

Keep broad `*.onnx` and `web_models/` ignores. Add only:

```gitignore
!web_demo/models/baseline2_njr_fp32.onnx
```

Create `.gitattributes`:

```gitattributes
web_demo/models/baseline2_njr_fp32.onnx binary -diff -merge
```

Do not add any `filter=lfs` rule. Confirm `git check-attr -a -- web_demo/models/baseline2_njr_fp32.onnx` contains no LFS filter.

- [ ] **Step 5: Build, verify, and stage the generated runtime once**

Run: `npm.cmd run build; .\.venv\Scripts\python.exe web_demo\tools\verify_distribution.py`

Expected: build exit 0; verifier reports exactly one ONNX, the expected hash/bytes, all dist entries intact, and no LFS pointer.

- [ ] **Step 6: Commit the large model only after all identity checks pass**

```powershell
git add .gitignore .gitattributes web_demo/package.json web_demo/tools/copy_ort_runtime.mjs web_demo/tools/write_dist_integrity.mjs web_demo/tests/unit/dist-integrity.test.ts web_demo/dist web_demo/models/baseline2_njr_fp32.onnx
git commit -m "build(web): package verified FP32 browser runtime"
```

The 84 MiB ONNX must not be amended or recommitted for cosmetic reasons.

### Task 9: Prove tensor, score, fallback, and offline fresh-clone behavior

**Files:**
- Create: `web_demo/tools/generate_parity_references.py`
- Create: `web_demo/tests/browser/preprocess-harness.html`
- Create: `web_demo/tests/browser/preprocess-harness.ts`
- Create: `web_demo/tools/run_preprocess_parity.mjs`
- Create: `web_demo/tools/run_browser_acceptance.mjs`
- Modify: `web_demo/package.json`
- Create: `results/web_demo_acceptance/README.md`
- Create: `results/web_demo_acceptance/latest.json`

- [ ] **Step 1: Write failing Python tests for deterministic reference generation**

The generator must reuse `inference.py` semantics, write float32 little-endian CHW files plus JSON metadata, run the deployed FP32 ONNX for reference logits/probabilities, and include all ten root `demo_images` plus the four committed edge fixtures. Tests assert stable input order, shape, byte count, SHA-256, and probability fields without requiring the PyTorch checkpoint.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_parity -v`

Expected: FAIL until generator and its test are present.

- [ ] **Step 2: Implement a real-browser tensor parity harness**

Start Vite programmatically on `127.0.0.1`, open the harness in installed Microsoft Edge, upload each actual image with Playwright, call the production `preprocessImage`, fetch its generated Python tensor reference, and compare all `442368` floats inside the page. Return per-image maximum and mean absolute tensor error, oriented dimensions, and failures; do not serialize full tensors through Playwright.

Acceptance gates:

```text
all 15 images processed
mean absolute normalized-tensor error <= 0.02 for every image
maximum absolute normalized-tensor error <= 0.50 for every image
EXIF oriented dimensions match Python
RGBA hidden RGB fixture does not composite against a canvas background
```

Run: `npm.cmd run test:preprocess-parity`

Expected: exit 0 with a 15/15 summary. If Catmull–Rom still misses these bounded tensor gates, stop and debug the decode/resize implementation rather than loosening the limits.

- [ ] **Step 3: Implement built-app browser acceptance for both providers**

Launch `serve_demo.py --no-browser`, wait for its printed ready URL, and test the committed `dist` rather than Vite dev output. Route every request and fail on any origin other than the selected `127.0.0.1` server. In normal mode require WebGPU when an adapter is available; in diagnostic `?provider=wasm` mode require WASM. Upload all ten demo images plus the five edge/parity fixtures, compare demo scores against `results/demo_predictions_cpu.json` and fixture scores against the generated Pillow/FP32 ONNX references, require maximum absolute probability error `<=0.01` and zero frozen-threshold flips for each provider, and assert `window.crossOriginIsolated === true`.

Also verify: invalid/oversized file error, reset clears result and preview, corrupt disposable model prevents startup, occupied 8765 selects another loopback port, missing WASM fails clearly, and terminating the launcher makes the URL unreachable.

- [ ] **Step 4: Run acceptance from a Unicode fresh-copy path**

Copy tracked files into a disposable directory named `LingShu 评委 本地复现`, excluding `.git`, `node_modules`, `.venv`, and ignored experiment models. Do not run `npm install` there. Run the copied `start-demo.bat --check`, then start it and execute the browser acceptance against the committed build/model. Delete only this validated disposable directory after recording results.

- [ ] **Step 5: Record reproducible acceptance evidence and commit**

`latest.json` records date, commit, OS/browser/runtime versions, model hash, both providers, per-image probabilities/errors, tensor bounds, request origins, port-fallback result, and pass/fail. `README.md` explains that timing is machine-specific and distinguishes parity from a new accuracy evaluation.

Run the full fresh gates:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Set-Location web_demo
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:preprocess-parity
npm.cmd run test:browser-acceptance
npm.cmd run verify:dist
```

Expected: every command exits 0; 15/15 tensor parity; 10/10 WebGPU and 10/10 WASM score parity with zero flips; the synthetic near-threshold fixture keeps the same decision; no remote request.

```powershell
git add web_demo/tools web_demo/tests/browser web_demo/package.json web_demo/package-lock.json tests/test_web_demo_parity.py results/web_demo_acceptance
git commit -m "test(web): verify offline browser inference parity"
```

### Task 10: Align judge/developer documentation and close the runtime slice

**Files:**
- Create: `web_demo/README.md`
- Modify: `README.md`
- Modify: `results/web_model_experiment/README.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `docs/superpowers/specs/2026-08-30-offline-fp32-webdemo-design.md`

- [ ] **Step 1: Write the judge-first WebDemo instructions**

Lead with exactly: clone/download, double-click `web_demo/start-demo.bat`, wait for the local browser tab, choose JPEG/PNG/WebP. State Python 3.11+ as the only launcher prerequisite, no npm/model download/network/inference server, 84 MiB first local model load, WebGPU then same-model WASM fallback, loopback-only privacy, Ctrl+C/window-close shutdown, manual `python web_demo/tools/serve_demo.py`, supported browsers, and actionable troubleshooting.

- [ ] **Step 2: Add developer audit/rebuild commands**

Document `npm ci`, unit/type/build/parity/acceptance commands, committed-dist drift verification, model/checkpoint provenance and both hashes, ordinary Git rather than LFS, runtime dependency licenses, and why FP16/INT8 are absent.

- [ ] **Step 3: Remove documentation contradictions**

The root README must distinguish the release-hosted PyTorch `.pt` checkpoint from the ordinary-Git browser FP32 ONNX. The browser experiment report must retain its historical FP16 recommendation as experiment history but begin with a dated team-decision note that the formal local demo deploys only FP32. Update the design status to implemented only after Task 9 evidence exists.

- [ ] **Step 4: Run documentation and artifact checks**

Run `rg -n "FP16|INT8|LFS|start-demo|FP32" README.md web_demo/README.md results/web_model_experiment/README.md docs/superpowers/specs/2026-08-30-offline-fp32-webdemo-design.md` and manually verify every deployment statement is consistent. Run all Task 9 gates again after the documentation/build change.

- [ ] **Step 5: Commit the completed runtime slice**

```powershell
git add README.md web_demo/README.md results/web_model_experiment/README.md THIRD_PARTY_NOTICES.md docs/superpowers/specs/2026-08-30-offline-fp32-webdemo-design.md
git commit -m "docs(web): document offline judge workflow"
```

## Final self-review checklist

- Spec coverage: Tasks 2/8 cover one-model provenance; Tasks 3/4 cover loopback one-click serving; Tasks 5/9 cover Python-equivalent input semantics; Task 6 covers same-model WebGPU/WASM; Task 7 covers complete functional states/privacy; Tasks 8/9 cover committed offline distribution/build drift; Task 10 covers judge/developer auditability.
- No implementation task deploys FP16, INT8, FastAPI, CDN assets, external fonts, analytics, persistence, batch upload, video, accounts, team profiles, or cloud configuration.
- Public type names are consistent across tasks: `ModelManifest`, `PreprocessedImage`, `DetectionResult`, provider values `webgpu | wasm`, model input `input`, model output `logits`, threshold `0.55657113`.
- No ordinary browser launch depends on Node.js, `node_modules`, the PyTorch checkpoint, or a network request.
- The visual-polish slice remains gated behind verified runtime parity and a separate Impeccable direction decision.
