# Offline FP32 WebDemo Design

## Status

Implemented. The offline runtime foundation and fresh-copy browser acceptance are
recorded in the [formal acceptance evidence](../../../results/web_demo_acceptance/README.md).
The visual-polish and narrative slice remains separate from this specification.

## Objective

Provide a judge-facing WebDemo that works after cloning the GitHub repository and
double-clicking `start-demo.bat`. The demo must run the final B2-NJR detector wholly
inside the judge's browser, without an inference server, Internet access, Node.js
installation, dependency installation, or model download at launch time.

The deployed browser model is the single FP32 ONNX export of the frozen
`v1.0.0 — Final B2-NJR Checkpoint`. FP16 and INT8 are experiment artifacts only and
must not be loaded by the formal WebDemo.

## First-principles constraints

1. **One source of model truth.** The WebDemo exposes one FP32 model and one frozen
   threshold. There is no precision-dependent model selection.
2. **Local computation.** Uploaded images and inference outputs remain in the
   browser. The local Python process only serves static bytes.
3. **Reproducibility before convenience.** A prebuilt site and model are committed
   so a judge does not need a frontend toolchain. Source code and build instructions
   remain available for audit.
4. **Equivalent input pipeline.** Browser preprocessing must match the frozen
   Python inference semantics before the UI can be called a model demo.
5. **Graceful hardware fallback.** WebGPU and WASM use the same FP32 ONNX file;
   only the execution provider changes.
6. **Offline means offline.** Runtime execution must make no request to a CDN,
   analytics service, font host, model host, API, or other remote origin.

## Scope boundary

This specification covers the offline runtime foundation, model packaging,
one-click launcher, inference data flow, correctness checks, and a functional
judge-facing inference screen.

The high-polish visual language, animation system, team profiles, technical-route
storytelling, and results exhibition are a second design slice. They will reuse the
runtime defined here and will be designed with Impeccable after this foundation is
verified. Splitting these concerns prevents visual work from hiding model-pipeline
errors.

## Considered approaches

### A. Ordinary Git model plus prebuilt static app — selected

Commit the 88,123,029-byte FP32 ONNX file as a normal Git blob, together with the
minimal prebuilt browser runtime. This is the only approach that makes both
`git clone` and GitHub source archives self-contained without a first-run download.
The model is below GitHub's 100 MiB per-file block limit, although GitHub will warn
because it is above 50 MiB.

The model should be committed once after validation. Replacing it repeatedly would
retain every historical binary in Git and permanently inflate the clone.

### B. Git LFS — rejected

Git LFS keeps large binary content outside normal Git history, but a judge without
Git LFS can receive pointer files instead of the model. That violates the
clone-and-double-click requirement and makes source archives configuration-sensitive.

### C. GitHub Release or R2 first-run download — deferred

This keeps the repository small, but the local demo would depend on network access
and a remote service. It does not meet the approved offline requirement and is not
part of this design.

## Repository layout

```text
web_demo/
├── src/                         # React/TypeScript source
├── public/                      # source-time static assets, excluding the model
├── dist/                        # committed production build used by judges
├── models/
│   ├── baseline2_njr_fp32.onnx # the only deployed model
│   └── manifest.json            # provenance, hashes, tensor contract, threshold
├── tools/
│   └── serve_demo.py            # Python-standard-library local server
├── start-demo.bat               # Windows one-click entry point
├── start-demo.sh                # macOS/Linux command-line equivalent
├── package.json                 # developer build dependencies
├── package-lock.json            # reproducible developer build
└── README.md                    # judge and developer instructions
```

The model lives outside `dist` so the source tree contains only one copy. The local
server maps `/models/` to `web_demo/models/` and all other paths to `web_demo/dist/`.
Online hosting configuration is deliberately deferred to a later design.

The repository keeps broad ignores for generated experiment models (`*.onnx` and
`web_models/`) but explicitly unignores the one formal deployment artifact,
`web_demo/models/baseline2_njr_fp32.onnx`. `.gitattributes` marks that ONNX file as
binary without enabling Git LFS.

## Model contract and provenance

`manifest.json` is version controlled and contains:

- deployed model filename and byte size;
- ONNX file SHA-256;
- source release name and tag;
- source checkpoint filename, byte size, and SHA-256;
- export opset and FP32 precision;
- input name, dtype, and shape: `input`, float32, `1×3×384×384`;
- output name and sigmoid interpretation;
- frozen threshold `0.55657113`;
- preprocessing contract and channel order;
- exporter script version or Git commit.

The existing verified source checkpoint is 87,312,599 bytes with SHA-256
`9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba`.
The selected FP32 ONNX export is 88,123,029 bytes with SHA-256
`e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69`.
The launcher verifies this exact identity before serving.

## Runtime architecture

### Browser application

Use a React and TypeScript static application built with Vite. React provides clear
state boundaries for model loading, upload/preprocessing, inference, and results;
Vite produces the static build served by the local launcher.

ONNX Runtime Web is bundled locally. The production build contains only the JS and
WASM runtime files required by the WebGPU and WASM execution providers. It does not
load `node_modules` or a CDN at runtime.

Application modules have single responsibilities:

- `runtime/model-session`: load the manifest, choose WebGPU or WASM, create and
  retain one FP32 inference session;
- `runtime/preprocess`: decode, orient, resize, tensorize, and normalize an image;
- `runtime/infer`: run one tensor, apply sigmoid, and compare with the threshold;
- `runtime/capabilities`: report browser, WebGPU, WASM, and isolation status;
- `features/detector`: own upload, progress, success, and error states;
- `features/result`: present continuous AIGC confidence and the thresholded label.

### Execution-provider selection

The application attempts WebGPU first. If adapter acquisition or session creation
fails, it automatically creates a WASM session using the same FP32 model. It never
falls back to FP16, INT8, an external API, or silent mock output.

The result screen identifies the execution provider actually used. A WebGPU failure
that successfully falls back to WASM is shown as a non-blocking compatibility note.

### Local server and launcher

`start-demo.bat` resolves paths relative to its own location, tries the repository
`.venv\Scripts\python.exe` first, then `py -3`, then `python`, and runs
`tools/serve_demo.py` with the first Python 3.11+ interpreter whose probe succeeds.
Python is already the repository's documented runtime requirement; no new system
dependency is introduced.

The server:

- binds only to `127.0.0.1`;
- selects an available local port, preferring 8765;
- verifies the model against `manifest.json` before opening the browser;
- streams files instead of loading the 84 MiB model into Python memory;
- sends correct HTML, JavaScript, JSON, ONNX, and WASM MIME types;
- sends the COOP, COEP, and CORP headers required by the tested threaded browser
  runtime;
- opens the default browser only after the listening socket is ready;
- remains attached to the launcher window and stops on Ctrl+C or window closure;
- never listens on the LAN and never executes uploaded image content.

If Python is missing, the BAT file displays a short explanation and the exact
Python requirement instead of closing immediately.

## End-to-end data flow

```text
Judge selects or drops an image
  -> browser validates type and size
  -> browser decodes image and applies EXIF orientation
  -> browser converts to RGB
  -> deterministic bicubic resize to 384×384
  -> float32 CHW tensor scaled to [0, 1]
  -> ImageNet normalization
       mean = [0.485, 0.456, 0.406]
       std  = [0.229, 0.224, 0.225]
  -> FP32 ONNX session returns one logit
  -> browser applies sigmoid
  -> continuous AIGC confidence is displayed
  -> frozen threshold 0.55657113 produces the Real/AIGC label
```

The browser preprocessing implementation must preserve the Python order:
`EXIF transpose -> RGB -> 384×384 bicubic -> ToTensor -> ImageNet Normalize`.
Canvas defaults are not accepted as implicit proof of bicubic equivalence. Tests
compare browser-generated tensors and scores with Python-generated references.

Images are processed one at a time in the first release. This bounds memory use,
simplifies progress reporting, and matches the judge's primary interaction. Batch
upload is outside this runtime-foundation scope.

## Functional inference screen

Before the visual-design slice, the functional screen provides:

- click and drag-and-drop upload for one supported image;
- local preview with filename and dimensions;
- explicit model-loading and inference progress;
- continuous AIGC confidence in `[0, 1]`;
- Real/AIGC decision using the frozen threshold;
- actual WebGPU or WASM provider;
- model identity and FP32 badge;
- a reset action that releases the image preview URL and keeps the model session;
- an offline/privacy statement that the image never leaves the browser.

Supported first-release formats are JPEG, PNG, and WebP. TIFF, BMP, animated images,
and malformed or truncated files are rejected with a clear message because browser
decoder behavior is not reliably equivalent to Pillow for those formats.

## Error handling

- **Missing or corrupt model:** the launcher stops before opening the page and prints
  the expected path and hash failure.
- **Missing built site or runtime asset:** the launcher reports an incomplete clone
  rather than serving a broken page.
- **Port conflict:** the server tries subsequent loopback ports and reports the
  selected URL.
- **WebGPU unavailable or initialization failure:** the app automatically retries
  with WASM and explains the fallback.
- **Both providers fail:** no classification is shown; the page displays browser,
  provider, and initialization details suitable for a bug report.
- **Unsupported or oversized image:** rejection happens before decoding. The default
  upload limit is 25 MiB.
- **Decode or preprocessing failure:** the current image is cleared and the model
  session remains usable for another attempt.
- **Inference failure:** no stale score remains visible; the user may retry or reset.

## Privacy and security

- Bind to loopback, never `0.0.0.0`.
- Make no remote network request in offline mode.
- Do not upload, persist, log, or hash user-selected image bytes.
- Revoke object URLs on reset and component cleanup.
- Treat filenames as text only and never interpolate them into HTML.
- Serve a restrictive local Content Security Policy compatible with the bundled
  ONNX runtime and WebGPU/WASM workers.
- Do not ship an unsigned custom executable; keep the launcher and Python server
  inspectable as text.

## Build and source auditability

Judges run committed `dist` files, while developers work from `src`. The repository
documents both paths:

- judge: clone, double-click `web_demo/start-demo.bat`;
- developer: `npm ci`, tests, production build, then local verification.

The local verification command rebuilds the site and fails if committed `dist`
differs from source. The repository does not currently claim an automated CI gate
for this check. Formal local browser evidence separately records the tested commit
and immutable artifact identities. Together these checks avoid asking judges to
trust an opaque generated bundle while preserving the no-install launcher.

## Verification strategy

### Unit tests

- sigmoid and frozen-threshold boundary behavior;
- CHW layout, `[0,1]` scaling, and ImageNet normalization;
- manifest parsing and model-contract validation;
- provider selection and WebGPU-to-WASM fallback;
- upload validation and stale-result clearing;
- server path containment, MIME types, headers, and port selection.

### Model and preprocessing parity

- ONNX FP32 output on Python-preprocessed tensors remains within the already
  demonstrated `1.2e-7` maximum absolute probability error and produces zero
  threshold flips on the committed demo set.
- Browser preprocessing tensor parity is evaluated against `inference.py` on 15
  inputs: all ten committed demo images plus five committed edge/parity fixtures.
  Every tensor must stay within mean absolute error `0.02` and maximum absolute
  error `0.50`.
- Built-app WebGPU and WASM acceptance runs the same 15 inputs. Each provider must
  produce zero frozen-threshold flips and maximum absolute probability error no
  greater than `0.01`.
- The five fixtures cover EXIF rotation, non-square input, grayscale input, RGBA
  input with hidden RGB values, and a synthetic near-threshold input so orientation,
  RGB conversion, and threshold stability cannot pass accidentally.

### Fresh-clone acceptance tests

Run from a disposable tracked-file copy whose path contains both spaces and Chinese
text. Exclude `.git`, `node_modules`, `.venv`, and ignored experiment models so the
copy exercises the same no-install artifact set a fresh clone receives:

1. Intercept browser requests and fail the run if any origin is not the selected
   loopback server.
2. Run `web_demo/start-demo.bat --check` and then the normal launcher without
   running `npm install`.
3. Verify that the browser opens, the model hash passes, and no external request is
   attempted.
4. Run all 15 inputs (ten demo images plus five fixtures) through WebGPU and compare
   with the Python/FP32 ONNX references.
5. Launch with the forced-WASM diagnostic query, verify WASM selection, and compare
   the same 15 inputs.
6. Corrupt a disposable copy of the model and remove the exact WASM asset in another
   disposable copy; verify fail-fast artifact diagnostics.
7. Occupy port 8765 and verify automatic loopback-port selection.
8. Terminate the launcher process tree and verify that the local server is no longer
   reachable.

### Browser targets

Microsoft Edge on Windows is fully accepted for WebGPU and WASM in the formal
evidence. Current Google Chrome on Windows remains a target browser, but no Chrome
smoke or full acceptance result is recorded yet. Firefox and Safari are best-effort
through WASM and are not release-blocking for the Windows BAT workflow.

## Documentation changes

The root README will gain a prominent `Local WebDemo` section with the one-click
path, expected first-load behavior, supported browsers, privacy statement, and a
manual command fallback. The browser experiment report will distinguish its
historical FP16 recommendation from the team's final deployment decision to ship
only FP32.

## Acceptance criteria

The runtime foundation is complete only when all of the following are true:

- a fresh offline clone contains exactly one deployed ONNX model, FP32;
- the exact FP32 model and its manifest are committed through ordinary Git, not LFS;
- double-clicking the BAT file opens a functioning local demo without npm install;
- WebGPU and WASM both use the same model and produce no demo-set threshold flips;
- browser preprocessing meets the defined end-to-end parity tolerance;
- no uploaded image data leaves the browser or is persisted locally;
- missing prerequisites and corrupt artifacts fail with actionable messages;
- source, committed build, model provenance, and reproduction commands are documented;
- automated tests and the fresh-clone offline test pass before UI-polish work begins.

## Non-goals for this slice

- FP16, INT8, quantization, calibration, or alternate deployed models;
- server-side inference or FastAPI as part of the normal judge workflow;
- cloud deployment configuration;
- batch processing, video, user accounts, persistence, or analytics;
- final visual design, narrative sections, team profiles, or showcase animations.
