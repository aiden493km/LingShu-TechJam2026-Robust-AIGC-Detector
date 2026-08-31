# Vercel Online WebDemo Deployment Design

**Date:** 2026-08-31
**Status:** Approved; Tasks 1–3 implemented and reviewed; Vercel account work pending
**Last reconciled:** 2026-08-31
**Branch:** `feat/vercel-online-deployment`
**Baseline:** `948a7ce`

## 1. Purpose

Add a public online judge path for the existing LingShu browser detector:

```text
Submission page / README / Release
  -> public Vercel URL
  -> select one image
  -> run the frozen detector in the judge's browser
  -> show the result
```

The online path is a second delivery mode. It must not replace or weaken the
separately maintained local Release, portable launchers, or offline acceptance
contract.

## 2. Scope and ownership boundary

This branch owns only online delivery:

- Vercel static deployment of the page, JavaScript, CSS, fonts, codec WASM, and
  ONNX Runtime WASM assets.
- Vercel Public Blob storage for the frozen browser model.
- A same-origin public model route backed by a Vercel external rewrite.
- Real model-download progress, online integrity verification, security headers,
  caching, failure recovery, and online acceptance evidence.
- Preview-first Git deployment and a production promotion gate.

This branch does not own or change:

- Python training, evaluation, or inference.
- The model parameters, export, precision, threshold, or preprocessing.
- `web_demo/start-demo.bat`, `web_demo/start-demo.command`, the bundled Python
  runtimes, or the loopback-only server contract.
- The local model path or local Release packaging.
- Existing experiment results or `results/web_demo_acceptance/latest.json`.
- A remote inference API, image upload endpoint, analytics, or persistence.

The parallel local Release work is allowed to land first. Before this branch is
merged, it will integrate the then-current `main`, resolve only genuine overlaps,
and rerun both local and online gates.

## 3. Frozen model contract

Online delivery must use exactly the existing browser model:

| Field | Required value |
|---|---|
| Repository source | `web_demo/models/baseline2_njr_fp32.onnx` |
| Bytes | `88,123,029` |
| SHA-256 | `e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69` |
| Format | ONNX, opset 18 |
| Precision | FP32 |
| Input | float32 `[1, 3, 384, 384]` named `input` |
| Output | float32 `[1, 1]` named `logits` |
| Threshold | `0.55657113` |

The preprocessing order remains EXIF transpose, RGB conversion, 384 x 384
bicubic resize, CHW FP32 tensor conversion, and ImageNet normalization. There is
no FP16 conversion, INT8 quantization, recompression, alternate model, or remote
inference fallback.

Moving the exact bytes to object storage changes initial delivery latency only.
It does not change model accuracy. WebGPU and WASM retain the existing browser
parity tolerance and must produce zero threshold flips on the frozen acceptance
set.

## 4. Considered architectures

### 4.1 Selected: Public Blob plus same-origin rewrite

The page requests `/models/baseline2_njr_fp32.onnx`. Vercel rewrites that path to
an immutable public Blob object without exposing a different URL to the browser.
This preserves the current client contract, keeps `connect-src 'self'`, and
requires no runtime function or read token.

### 4.2 Rejected: direct cross-origin Blob URL

Direct Blob delivery removes one proxy layer, but couples model loading to the
Blob origin's CORS and cross-origin embedding behavior. It also breaks the
explicit same-origin routing requirement.

### 4.3 Rejected: model bundled as a Vercel static deployment file

This is same-origin but attaches an 88 MB file to every site deployment, consumes
most of the Hobby CLI source-upload allowance, increases deployment churn, and
mixes model lifecycle with page lifecycle.

### 4.4 Rejected: private Blob streamed through a Function

The model is intentionally public and open. A private store adds authentication,
function latency, additional transfer, and a runtime secret without providing a
required product benefit.

## 5. Runtime architecture and data flow

```text
Judge browser
  |-- GET /, /assets/*, /brands/*
  |     -> Vercel static deployment
  |
  |-- GET /models/manifest.json
  |     -> small manifest in the online static output
  |
  `-- GET /models/baseline2_njr_fp32.onnx
        -> Vercel same-origin external rewrite
        -> immutable Vercel Public Blob object
        -> streamed Uint8Array with real byte progress
        -> byte-count and SHA-256 verification
        -> ONNX Runtime WebGPU, or WASM compatibility fallback
        -> local image preprocessing and inference
```

The page starts the model download when the detector application loads. Upload
controls stay disabled until the model has been verified and a session has been
created. The same in-memory session is reused for every image in that page
session.

A refresh recreates the inference session. The model should normally be read
from the browser HTTP cache, but a new browser, private window, evicted cache,
cleared cache, or future model URL requires another network download. The UI must
not promise permanent offline availability.

## 6. Build isolation

Online builds must not overwrite the committed local `web_demo/dist/` directory.

- Existing `npm run build` continues to build `dist/` exactly as the local
  Release expects.
- New `npm run build:online` builds into ignored `dist-online/`.
- `dist-online/` contains the site, runtime assets, and
  `models/manifest.json`, but never an `.onnx` file.
- The online build uses Vite's `online` mode so copy can describe a network
  download while local builds retain their current offline wording.
- Existing build helpers accept an explicit output directory rather than
  assuming `dist/`; default behavior remains unchanged.
- `.vercelignore` excludes the ONNX source, committed local `dist/`, bundled
  runtimes, caches, generated tests, and unrelated research artifacts from CLI
  deployment input.

The Vercel project is configured as follows:

| Setting | Value |
|---|---|
| Root Directory | `web_demo` |
| Framework | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build:online` |
| Output Directory | `dist-online` |
| Production Branch | `main` |

No runtime environment variable is required by the deployed application.

## 7. Blob publication contract

Create a public Blob store attached to the Vercel project. Upload the model once
through an authenticated operator workflow using:

- a pathname containing the complete model SHA-256;
- `Content-Type: application/octet-stream`;
- a one-year cache-control maximum age;
- overwrite disabled;
- the exact repository file as the upload source.

The returned public Blob URL is not a secret and is recorded as the fixed rewrite
destination in `web_demo/vercel.json`. `BLOB_READ_WRITE_TOKEN` is used only by
the operator uploading or managing the object. It must never enter client code,
source control, build logs, or runtime browser configuration.

After upload, verify the object byte count and SHA-256 before referencing it from
a deployment. A future model must use a new immutable object and a new reviewed
contract; the current object is never overwritten or deleted as part of an
ordinary website deploy.

## 8. Same-origin routes and response headers

`web_demo/vercel.json` defines the exact model rewrite and Vercel response
headers. It must preserve the local server's accepted isolation and CSP contract:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self';
  img-src 'self' blob: data:;
  connect-src 'self';
  worker-src 'self' blob:;
  font-src 'self';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  form-action 'none'

Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

These headers apply to the document and relevant static/model routes. The Vercel
Toolbar is not part of the judge experience and must not be required for Preview
or Production acceptance.

Acceptance requires `window.crossOriginIsolated === true`, `SharedArrayBuffer`
availability on the WASM path, and correct MIME types for JavaScript, MJS, JSON,
WASM, font, and ONNX responses.

## 9. Caching contract

| Route class | Browser policy | CDN policy |
|---|---|---|
| `/` and HTML | `max-age=0, must-revalidate` | revalidate current deployment |
| `/models/manifest.json` | `max-age=0, must-revalidate` | revalidate current deployment |
| `/assets/*` and immutable build assets | `max-age=31536000, immutable` | one year |
| `/models/baseline2_njr_fp32.onnx` | `max-age=31536000, immutable` | one year |

The model rewrite explicitly sets `x-vercel-enable-rewrite-caching: 1` because
external rewrites are not cached by default. It also sets a Vercel/CDN cache
directive for the immutable model response. The upstream Blob pathname includes
the full SHA-256, so the cached object and the frozen model identity cannot drift
through an overwrite.

No service worker or IndexedDB model cache is added. Standard HTTP caching is
sufficient and avoids a second cache invalidation system.

## 10. Download progress and integrity

The existing streaming loader remains authoritative for progress:

- total bytes come from the validated frozen manifest;
- loaded bytes increase only when a response chunk is received;
- progress begins at zero, is monotonic, and finishes at exactly `88,123,029`;
- a present `Content-Length` must equal the expected byte count;
- an early end or oversized stream fails closed.

Online mode adds a Web Crypto SHA-256 check over the completed bytes before ONNX
Runtime session creation. The transient integrity-check cost is accepted because
the priority is exact model identity, not the shortest first-load time.

If the digest is wrong, the application discards the response and offers one
explicit retry that bypasses or reloads the browser cache. A second mismatch
stops initialization and shows diagnostics. It must never continue with an
unverified model or return a detection result.

Online copy says the model is being downloaded to the browser and that image
bytes remain local. Once the model is ready, the UI continues to describe local
browser inference accurately.

## 11. Privacy boundary

Selected image bytes, decoded pixels, normalized tensors, thumbnails, scores,
and recent detections remain in browser memory only. The online application:

- has no image upload endpoint;
- sends no image, filename, hash, embedding, score, or inference telemetry;
- enables no Vercel Web Analytics, Speed Insights, advertising, or third-party
  analytics library;
- uses repository-bundled fonts, brand assets, figures, scripts, and styles;
- persists no image or result to localStorage, IndexedDB, cookies, Blob, or a
  backend;
- contacts external sites only after the user selects an ordinary outbound link.

Network inspection during acceptance must show only expected page/runtime/model
requests before the user deliberately follows an external link.

## 12. Failure and recovery behavior

| Failure | Required behavior |
|---|---|
| Network interruption during model download | Cancel the stream, retain no partial model, show Retry |
| Non-2xx manifest/model response | Show sanitized model-unavailable state |
| Missing or invalid response stream | Stop initialization |
| Byte-count mismatch | Stop initialization and discard bytes |
| SHA-256 mismatch | Force one cache-bypassing retry, then stop |
| WebGPU unavailable or initialization failure | Use the same verified bytes with WASM and disclose the reason |
| WASM initialization failure | Show provider diagnostics; output no result |
| Page goes offline after model readiness | Continue local preprocessing and inference |
| Unexpected server/API response | Never substitute a mock, remote API, or alternate model |

The existing Retry Model control remains the user recovery path. Error details
are sanitized and bounded; tokens, URLs containing secrets, stack traces, and
local filesystem paths are never rendered.

## 13. Deployment workflow

1. Implement and verify on `feat/vercel-online-deployment`.
2. Create or link one Vercel project rooted at `web_demo`.
3. Create the public Blob store and upload the verified immutable object.
4. Push the feature branch to create a commit-specific Preview deployment.
5. Run the complete online acceptance matrix against that Preview URL.
6. Keep the Preview non-production while the parallel local Release work lands.
7. Integrate current `main`, then rerun local and online gates.
8. Obtain user approval for the final review artifact before merge or production.
9. Merge to `main`; require Production to resolve to that exact commit.
10. Re-run the production smoke, header, privacy, WebGPU, and WASM checks.
11. Only then place the stable Production URL in README, Release, and submission
    material.

Git integration is the normal deployment mechanism. A custom CI workflow and
committed Vercel credentials are unnecessary. CLI commands may be used for the
one-time Blob operation and read-only deployment inspection.

## 14. Acceptance matrix

### 14.1 Repository and build isolation

- `npm test` and TypeScript checks pass.
- The default local build remains reproducible and `verify:dist` stays clean.
- The local launcher `--check` still passes.
- `build:online` succeeds in a clean checkout.
- `dist-online/` contains `models/manifest.json` and no `.onnx` file.
- No token, `.env`, `.vercel` link metadata, or private credential is tracked.

### 14.2 HTTP and routing

- `/`, required hashed assets, WASM, MJS, manifest, and model routes return 200.
- The model request remains visibly under the website origin with no browser-side
  redirect.
- MIME, CSP, COOP, COEP, CORP, cache, ETag, and nosniff behavior are correct.
- Detector, Technology, Results, Error Analysis, and About hash routes work from
  a fresh navigation.

### 14.3 Browser runtime

- Model progress is monotonic from 0 to 88,123,029 bytes.
- The byte count and SHA-256 contract pass before session readiness.
- `crossOriginIsolated` is true.
- WebGPU succeeds on a supported judge-like browser.
- Forced WASM succeeds.
- Automatic WebGPU-to-WASM fallback succeeds.
- Frozen demo predictions remain inside the existing browser parity tolerance
  with zero threshold flips.
- Multiple image analyses reuse one model session and do not refetch the model in
  the same page session.

### 14.4 Resilience, cache, and privacy

- A throttled first download keeps the UI responsive and shows real progress.
- An interrupted download reaches a recoverable error state.
- Retry succeeds after connectivity returns.
- A simulated wrong-length or wrong-digest model never initializes.
- Reload uses the HTTP cache when the browser retains it; the documentation still
  acknowledges legitimate re-download cases.
- After readiness, disabling network access does not stop inference.
- Network interception confirms that selected image bytes and derived data are
  never transmitted.

### 14.5 Evidence boundary

Online acceptance evidence is recorded separately from
`results/web_demo_acceptance/latest.json`. It proves deployment integrity and
runtime parity, not a new accuracy benchmark. It records at minimum:

- tested commit and Preview/Production deployment URL;
- browser and operating-system identity;
- response headers and cross-origin isolation state;
- model byte count and SHA-256;
- provider cases, prediction deltas, and threshold flips;
- network privacy observations;
- cache, interruption, retry, and offline-after-ready outcomes.

## 15. Production, rollback, and operations

Production is allowed only after the exact Preview commit passes acceptance and
the user approves merge/release. The final Production URL must resolve to the
exact merged `main` commit.

Rollback re-points the production alias to the previous verified Vercel
deployment. The immutable model object remains available, so a page rollback does
not depend on re-uploading model bytes. A bad future model is corrected with a new
object and deployment, never by overwriting the old object.

Each previously uncached browser downloads about 88 MB. Ten first downloads are
about 0.88 GB and one hundred are about 8.8 GB of visitor transfer before any
plan-specific accounting details. CDN caching reduces repeated origin work but
does not eliminate delivery bytes to distinct judges. Usage is monitored in the
Vercel project; no exact monetary claim is fixed in source because plan and
regional pricing can change.

## 16. Planned implementation surface

Expected focused changes are limited to:

- `web_demo/vercel.json`;
- `web_demo/.vercelignore`;
- `web_demo/package.json` and its lockfile only if required;
- `web_demo/vite.config.ts` for isolated online output;
- focused build helpers under `web_demo/tools/`;
- focused online-mode and integrity code under `web_demo/src/`;
- unit and online browser acceptance tests under `web_demo/tests/`;
- a separate online acceptance evidence location under `results/`;
- `web_demo/README.md` and the root README after a stable Production URL exists.

Unrelated refactoring and changes to experiment materials are out of scope.

## 17. Authoritative platform references

- Vercel Vite deployment: <https://vercel.com/docs/frameworks/frontend/vite>
- Vercel project configuration and headers:
  <https://vercel.com/docs/project-configuration/vercel-json>
- Vercel external rewrites and rewrite caching:
  <https://vercel.com/docs/routing/rewrites>
- Vercel Blob overview: <https://vercel.com/docs/vercel-blob>
- Vercel Public Blob storage:
  <https://vercel.com/docs/vercel-blob/public-storage>
- Vercel platform limits: <https://vercel.com/docs/limits>
