# Vercel Online WebDemo Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing frozen FP32 WebDemo through Vercel with an isolated online build, an immutable Vercel Public Blob model, same-origin delivery, exact model verification, and preview/production acceptance evidence.

**Architecture:** Keep the local Release contract unchanged and build online artifacts into `web_demo/dist-online/`. Serve the page and runtime assets as Vercel static output, serve the small frozen manifest with that output, and rewrite the existing same-origin ONNX route to one immutable public Blob object. Verify all 88,123,029 bytes and their SHA-256 in the browser before creating the WebGPU/WASM session.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, ONNX Runtime Web 1.29, Web Crypto, Playwright Core, Vercel static deployments, Vercel Public Blob, PowerShell on Windows.

---

## File structure and responsibilities

| Path | Responsibility |
|---|---|
| `web_demo/vite.config.ts` | Select `dist/` for local mode and `dist-online/` for online mode without changing asset names. |
| `web_demo/tools/prepare_online_dist.mjs` | Copy only the frozen JSON manifest into online output and reject any ONNX file. |
| `web_demo/tools/verify_online_dist.mjs` | Fail the build unless the online artifact contains the manifest/runtime assets and excludes model bytes. |
| `web_demo/tools/copy_ort_runtime.mjs` | Preserve the default local destination and accept an explicit online destination from its CLI. |
| `web_demo/src/runtime/model-integrity.ts` | Compute and compare browser SHA-256 without knowing UI or ONNX Runtime details. |
| `web_demo/src/runtime/model-session.ts` | Fetch streamed model bytes, invoke integrity verification, and pass only verified bytes to provider creation. |
| `web_demo/src/runtime/deployment.ts` | Provide local-versus-online model-loading copy from Vite mode. |
| `web_demo/src/detector/use-detector.ts` | Make an explicit retry use `cache: 'reload'` while the initial load keeps normal HTTP caching. |
| `web_demo/vercel.json` | Define build output, same-origin Blob rewrite, caching, isolation, and security headers. |
| `web_demo/.vercelignore` | Exclude the local model and Release-only material from CLI deployment input. |
| `web_demo/tools/run_online_acceptance.mjs` | Run deployed-header, privacy, WebGPU, WASM, progress, retry, and offline-after-ready checks. |
| `results/web_demo_online_acceptance/` | Store online deployment evidence separately from offline browser evidence. |

## Task 1: Isolate the online build artifact

**Files:**
- Modify: `web_demo/tests/unit/build-packaging.test.ts`
- Create: `web_demo/tests/unit/online-distribution.test.ts`
- Modify: `web_demo/vite.config.ts`
- Modify: `web_demo/tools/copy_ort_runtime.mjs`
- Create: `web_demo/tools/prepare_online_dist.mjs`
- Create: `web_demo/tools/verify_online_dist.mjs`
- Modify: `web_demo/package.json`
- Modify: `.gitignore`
- Create: `web_demo/.vercelignore`

- [ ] **Step 1: Write failing build-mode and package-script tests**

Add to `build-packaging.test.ts`:

```ts
import { buildOutputDirectory, runtimeAssetFileName } from '../../vite.config';

it('keeps local and online outputs isolated', () => {
  expect(buildOutputDirectory('production')).toBe('dist');
  expect(buildOutputDirectory('online')).toBe('dist-online');
});

it('builds the online artifact without copying the ONNX model', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { scripts?: Record<string, string> };

  expect(packageJson.scripts?.['build:online']).toBe(
    'node tools/preflight_online_build.mjs && node tools/normalize_build_inputs.mjs && vite build --mode online && node tools/prepare_online_dist.mjs && node tools/copy_ort_runtime.mjs dist-online && node tools/write_dist_integrity.mjs dist-online && node tools/verify_online_dist.mjs',
  );
});
```

Create `online-distribution.test.ts` with a temporary output containing an
`index.html`, invoke `prepareOnlineDist`, then assert:

```ts
expect(JSON.parse(await readFile(join(dist, 'models', 'manifest.json'), 'utf8')))
  .toEqual(manifestJson);
expect(await readdir(join(dist, 'models'))).toEqual(['manifest.json']);
await expect(prepareOnlineDist({
  distDirectory: dist,
  manifestPath,
})).rejects.toThrow(/onnx.*online distribution/i);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
Set-Location web_demo
npm.cmd test -- tests/unit/build-packaging.test.ts tests/unit/online-build-preflight.test.ts tests/unit/online-distribution.test.ts
```

Expected: FAIL because `buildOutputDirectory`, the online preflight,
`prepareOnlineDist`, and the online script do not exist.

- [ ] **Step 3: Implement isolated Vite output and online packaging**

In `vite.config.ts`, keep `runtimeAssetFileName` unchanged and add:

```ts
export function buildOutputDirectory(mode: string): 'dist' | 'dist-online' {
  return mode === 'online' ? 'dist-online' : 'dist';
}

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [react()],
  build: {
    outDir: buildOutputDirectory(mode),
    assetsInlineLimit: 0,
    rollupOptions: { output: { assetFileNames: runtimeAssetFileName } },
  },
  test: { environment: 'node' },
}));
```

Change the `copy_ort_runtime.mjs` CLI to accept zero or one destination:

```js
async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    throw new Error('Usage: node tools/copy_ort_runtime.mjs [dist-directory]');
  }
  const result = await copyOrtRuntime(
    arguments_[0] === undefined ? {} : { distDirectory: arguments_[0] },
  );
  for (const copied of [result.mjs, result.wasm]) {
    console.log(`[ort-runtime] copied ${copied.bytes} bytes (${copied.sha256}) to ${copied.destinationPath}`);
  }
}
```

Implement `preflight_online_build.mjs` before Vite. It accepts the optional
online dist directory and, before Vite can empty the output, rejects a
pre-existing symbolic link, Windows junction, or non-directory. A missing
output directory remains valid because Vite creates it.

Implement `prepare_online_dist.mjs` as a focused module that:

1. resolves `dist-online/` and `models/manifest.json`;
2. rejects symlinks and non-regular manifest files;
3. recursively rejects any `.onnx` or `.onnx.data` entry already in the output;
4. creates `dist-online/models/`;
5. copies the manifest as UTF-8 bytes;
6. parses the copied JSON and asserts the fixed file, bytes, SHA-256, precision,
   opset, and threshold;
7. re-runs the ONNX exclusion scan.

Export this exact interface for tests:

```js
export async function prepareOnlineDist({
  distDirectory = defaultOnlineDistDirectory(),
  manifestPath = defaultModelManifestPath(),
} = {})
```

Implement `verify_online_dist.mjs` to require regular files at
`index.html`, `integrity.json`, `models/manifest.json`,
`assets/ort-wasm-simd-threaded.asyncify.mjs`, and
`assets/ort-wasm-simd-threaded.asyncify.wasm`; verify the ORT sizes/hashes from
`copy_ort_runtime.mjs`; verify that `integrity.json` lists the manifest and both
runtime files; and reject every `.onnx`, `.onnx.data`, symlink, or unexpected
`models/` sibling.

Add the exact `build:online` script asserted above, add
`web_demo/dist-online/` to the repository `.gitignore`, and create
`.vercelignore` containing:

```text
dist/
dist-online/
models/*.onnx
.generated-tests/
.runtime-cache/
runtimes/
start-demo.bat
start-demo.command
start-demo.sh
```

- [ ] **Step 4: Run focused tests and both builds**

```powershell
Set-Location web_demo
npm.cmd test -- tests/unit/build-packaging.test.ts tests/unit/online-build-preflight.test.ts tests/unit/online-distribution.test.ts tests/unit/ort-runtime-copy.test.ts tests/unit/dist-integrity.test.ts
npm.cmd run typecheck
npm.cmd run build:online
npm.cmd run verify:dist
```

Expected: all tests and typecheck PASS; `build:online` reports a verified
`dist-online/` with no ONNX; `verify:dist` reports no tracked local `dist/` diff.

- [ ] **Step 5: Commit the build boundary**

```powershell
git add .gitignore web_demo/.vercelignore web_demo/package.json web_demo/vite.config.ts web_demo/tools/copy_ort_runtime.mjs web_demo/tools/prepare_online_dist.mjs web_demo/tools/verify_online_dist.mjs web_demo/tests/unit/build-packaging.test.ts web_demo/tests/unit/online-distribution.test.ts
git commit -m "build(web-demo): isolate Vercel online output"
```

## Task 2: Verify remote model bytes before session creation

**Files:**
- Create: `web_demo/src/runtime/model-integrity.ts`
- Create: `web_demo/tests/unit/model-integrity.test.ts`
- Modify: `web_demo/src/runtime/model-session.ts`
- Modify: `web_demo/tests/unit/model-session.test.ts`
- Modify: `web_demo/src/detector/use-detector.ts`
- Modify: `web_demo/tests/unit/machine.test.ts`

- [ ] **Step 1: Write failing SHA-256, integration, and retry-cache tests**

Use the known SHA-256 of `Uint8Array.of(1, 2, 3)`:

```ts
expect(await sha256Hex(Uint8Array.of(1, 2, 3))).toBe(
  '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
);
await expect(
  verifyModelSha256(Uint8Array.of(1, 2, 3), '0'.repeat(64)),
).rejects.toThrow(/sha-256.*does not match/i);
```

Add a `fetchVerifiedModelBytes` test with a five-byte streamed response and an
injected verifier:

```ts
const verifySha256 = vi.fn().mockResolvedValue(undefined);
const bytes = await fetchVerifiedModelBytes(
  { file: 'tiny.onnx', bytes: 5, sha256: 'a'.repeat(64) },
  { fetch: fetcher, verifySha256 },
);
expect(verifySha256).toHaveBeenCalledWith(bytes, 'a'.repeat(64));
```

In `machine.test.ts`, assert that the first load has no cache override and an
explicit Retry uses reload:

```ts
expect(loadModel.mock.calls[0]?.[0]?.modelCache).toBeUndefined();
await controller.retryModel();
expect(loadModel.mock.calls[1]?.[0]?.modelCache).toBe('reload');
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
Set-Location web_demo
npm.cmd test -- tests/unit/model-integrity.test.ts tests/unit/model-session.test.ts tests/unit/machine.test.ts
```

Expected: FAIL because SHA verification and `modelCache` are absent.

- [ ] **Step 3: Implement the focused integrity module**

Create `model-integrity.ts`:

```ts
export class ModelIntegrityError extends Error {
  override readonly name = 'ModelIntegrityError';
}

export type Sha256Digest = (bytes: Uint8Array) => Promise<string>;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new ModelIntegrityError('Web Crypto SHA-256 is unavailable');
  }
  const start = bytes.byteOffset;
  const end = start + bytes.byteLength;
  const buffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(start, end)
    : bytes.slice().buffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyModelSha256(
  bytes: Uint8Array,
  expected: string,
  digest: Sha256Digest = sha256Hex,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new ModelIntegrityError('Expected model SHA-256 must be 64 lowercase hexadecimal characters');
  }
  const actual = await digest(bytes);
  if (actual !== expected) {
    throw new ModelIntegrityError(`Model SHA-256 ${actual} does not match expected ${expected}`);
  }
}
```

- [ ] **Step 4: Integrate verification and cache-reloading Retry**

In `model-session.ts`:

- extend `ModelDownloadDescriptor` with optional `sha256` only for the generic
  byte fetch, and define a required `VerifiedModelDownloadDescriptor`;
- add `modelCache?: RequestCache` and `verifySha256?: typeof verifyModelSha256`
  to `LoadModelSessionOptions`/model fetch options;
- include `cache: options.modelCache` only on the ONNX fetch;
- export `fetchVerifiedModelBytes`, which streams via `fetchModelBytes`, calls the
  verifier, and returns only verified bytes;
- make `loadModelSession` call `fetchVerifiedModelBytes(manifest.model, ...)`
  before `chooseProvider`.

In `DetectorController`, pass no `modelCache` from `start()` and pass
`modelCache: 'reload'` from `retryModel()`. Preserve the existing active-load,
abort, stale-generation, and disposal behavior.

- [ ] **Step 5: Run tests, typecheck, and local browser-model tests**

```powershell
Set-Location web_demo
npm.cmd test -- tests/unit/model-integrity.test.ts tests/unit/model-session.test.ts tests/unit/machine.test.ts
npm.cmd run typecheck
npm.cmd test
```

Expected: all PASS. Existing manifest, provider, abort, and concurrency tests
remain green.

- [ ] **Step 6: Commit verified loading**

```powershell
git add web_demo/src/runtime/model-integrity.ts web_demo/src/runtime/model-session.ts web_demo/src/detector/use-detector.ts web_demo/tests/unit/model-integrity.test.ts web_demo/tests/unit/model-session.test.ts web_demo/tests/unit/machine.test.ts
git commit -m "feat(web-demo): verify downloaded model identity"
```

## Task 3: Make online download state explicit without changing local copy

**Files:**
- Create: `web_demo/src/runtime/deployment.ts`
- Create: `web_demo/tests/unit/deployment.test.ts`
- Modify: `web_demo/src/App.tsx`
- Modify: `web_demo/tests/unit/scaffold.test.ts`

- [ ] **Step 1: Write failing delivery-copy tests**

```ts
expect(modelDeliveryCopy('local')).toEqual({
  title: 'LOADING LOCAL MODEL',
  detail: 'Verifying and preparing the local FP32 session.',
  progressLabel: 'Local FP32 model loading progress',
});
expect(modelDeliveryCopy('online')).toEqual({
  title: 'DOWNLOADING MODEL',
  detail: 'Downloading and verifying the frozen FP32 model in this browser.',
  progressLabel: 'FP32 model download progress',
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
Set-Location web_demo
npm.cmd test -- tests/unit/deployment.test.ts tests/unit/scaffold.test.ts
```

Expected: FAIL because the pure copy module does not exist.

- [ ] **Step 3: Implement mode-derived copy and wire both loading views**

Create `deployment.ts` with a pure `modelDeliveryCopy(mode)` function and:

```ts
export type DeploymentMode = 'local' | 'online';
export const DEPLOYMENT_MODE: DeploymentMode =
  import.meta.env.MODE === 'online' ? 'online' : 'local';
```

In `App.tsx`, obtain `const delivery = modelDeliveryCopy(DEPLOYMENT_MODE)` and
use its `title`, `detail`, and `progressLabel` in both `PhaseContent` and
`LocalFieldCard`. Do not change `LOCAL RUNTIME`, `LOCAL PRIVACY`, or local
inference wording because image processing still occurs locally online.

- [ ] **Step 4: Run tests and inspect both built strings**

```powershell
Set-Location web_demo
npm.cmd test -- tests/unit/deployment.test.ts tests/unit/scaffold.test.ts
npm.cmd run typecheck
npm.cmd run build
npm.cmd run build:online
rg -n "LOADING LOCAL MODEL|DOWNLOADING MODEL" dist dist-online
```

Expected: local output contains local loading copy; online output contains
download copy; all tests PASS.

- [ ] **Step 5: Commit delivery copy**

```powershell
git add web_demo/src/runtime/deployment.ts web_demo/src/App.tsx web_demo/tests/unit/deployment.test.ts web_demo/tests/unit/scaffold.test.ts
git commit -m "feat(web-demo): explain online model download"
```

## Task 4: Provision immutable Blob storage and add Vercel routing

**Files:**
- Create: `web_demo/tests/unit/vercel-config.test.ts`
- Create after a successful upload: `web_demo/vercel.json`
- Modify: `web_demo/tests/unit/build-packaging.test.ts`
- Local-only, ignored: `web_demo/.vercel/project.json`

- [ ] **Step 1: Install and authenticate the pinned operator CLI**

Use Vercel CLI `59.10.0`, the current stable version selected for this work:

```powershell
npm.cmd exec --yes --package=vercel@59.10.0 -- vercel --version
npm.cmd exec --yes --package=vercel@59.10.0 -- vercel login
```

Expected: version `59.10.0`; browser authentication completes for the user's
Vercel account. Do not print or persist an access token in the repository.

- [ ] **Step 2: Link a Vercel project rooted at `web_demo`**

From `web_demo/`, link the GitHub repository/project interactively, choose Vite,
set Production Branch to `main`, Build Command to `npm run build:online`, and
Output Directory to `dist-online`. Verify `.vercel/project.json` remains ignored.

- [ ] **Step 3: Create a public store and upload the exact immutable object**

```powershell
npm.cmd exec --yes --package=vercel@59.10.0 -- vercel blob create-store lingshu-web-model --access public
npm.cmd exec --yes --package=vercel@59.10.0 -- vercel blob put models\baseline2_njr_fp32.onnx --pathname models/baseline2_njr_fp32-e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69.onnx --content-type application/octet-stream --cache-control-max-age 31536000
```

Expected: a JSON/object result whose `url` uses
`https://*.public.blob.vercel-storage.com/` and ends in the exact hashed
pathname. Overwrite remains disabled.

Use `vercel blob list --prefix models/` and an HTTP download/hash check to verify
the remote object is exactly 88,123,029 bytes with the frozen SHA-256 before
continuing.

- [ ] **Step 4: Write a failing config contract using the returned literal URL**

The test parses `vercel.json`, derives
`const remoteBlobUrl = config.rewrites[0]?.destination`, and requires:

```ts
expect(config.framework).toBe('vite');
expect(config.buildCommand).toBe('npm run build:online');
expect(config.outputDirectory).toBe('dist-online');
expect(config.rewrites).toEqual([{
  source: '/models/baseline2_njr_fp32.onnx',
  destination: remoteBlobUrl,
}]);
expect(remoteBlobUrl).toMatch(
  /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\/models\/baseline2_njr_fp32-e2cdc94a[0-9a-f]+\.onnx$/,
);
```

Also assert the exact CSP from the design, COOP/COEP/CORP, Permissions-Policy,
Referrer-Policy, nosniff, frame denial, model rewrite caching, HTML/manifest
revalidation, and one-year immutable asset/model cache policies.

- [ ] **Step 5: Add `vercel.json` with the verified literal Blob URL**

Create schema-valid configuration with:

- `framework: "vite"`;
- `installCommand: "npm ci"`;
- `buildCommand: "npm run build:online"`;
- `outputDirectory: "dist-online"`;
- the one exact model rewrite;
- `x-vercel-enable-rewrite-caching: 1` on the model source;
- `Cache-Control` and `Vercel-CDN-Cache-Control` one-year immutable model values;
- no-cache/revalidate values for `/` and `/models/manifest.json`;
- immutable cache values for `/assets/:path*`;
- the exact global security headers from design section 8.

Do not use a build-time URL variable, runtime Function, redirect, wildcard model
rewrite, or read token.

- [ ] **Step 6: Run config, build, and secret scans**

```powershell
Set-Location web_demo
npm.cmd test -- tests/unit/vercel-config.test.ts tests/unit/build-packaging.test.ts
npm.cmd run build:online
rg -n -i "BLOB_READ_WRITE_TOKEN|VERCEL_TOKEN|BEGIN .*PRIVATE KEY" . -g "!node_modules/**" -g "!dist-online/**"
git status --short
```

Expected: tests/build PASS; the secret scan has no source hit; `.vercel/` and
`dist-online/` are absent from Git status.

- [ ] **Step 7: Commit Vercel delivery configuration**

```powershell
git add web_demo/vercel.json web_demo/tests/unit/vercel-config.test.ts web_demo/tests/unit/build-packaging.test.ts
git commit -m "build(web-demo): configure Vercel Blob delivery"
```

## Task 5: Deploy and record online acceptance

**Files:**
- Create: `web_demo/tools/run_online_acceptance.mjs`
- Create: `web_demo/tests/unit/online-acceptance.test.mjs`
- Modify: `web_demo/package.json`
- Create: `results/web_demo_online_acceptance/README.md`
- Create after a clean deployed test: `results/web_demo_online_acceptance/latest.json`

- [ ] **Step 1: Write failing argument, origin, and evidence-schema unit tests**

Export pure helpers from the acceptance runner and test:

```js
assert.throws(() => parseOnlineUrl('http://example.com'), /https/i);
assert.equal(parseOnlineUrl('https://preview.example/').origin, 'https://preview.example');
assert.equal(classifyRequest('https://preview.example/models/baseline2_njr_fp32.onnx', 'https://preview.example'), 'model');
assert.equal(classifyRequest('https://tracker.example/pixel', 'https://preview.example'), 'external');
const evidence = {
  schema_version: 1,
  testedCommit: '0123456789abcdef0123456789abcdef01234567',
  deploymentUrl: 'https://preview.example/',
  model: {
    bytes: 88123029,
    sha256: 'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69',
  },
  crossOriginIsolated: true,
  providers: ['webgpu', 'wasm'],
  thresholdFlips: 0,
  imageRequests: 0,
};
assert.doesNotThrow(() => validateOnlineEvidence(evidence));
```

- [ ] **Step 2: Run unit tests and verify RED**

```powershell
Set-Location web_demo
node --test tests/unit/online-acceptance.test.mjs
```

Expected: FAIL because the acceptance runner does not exist.

- [ ] **Step 3: Implement the deployed-browser runner**

`run_online_acceptance.mjs` accepts exactly one HTTPS Preview/Production URL,
locates installed Edge using the same Windows locations as the offline runner,
and performs these cases with Playwright Core:

1. request `/`, manifest, model, ORT MJS, and ORT WASM and record status/MIME,
   security, cache, ETag, and content length when present;
2. open the detector, capture progress events, require monotonic progress ending
   at 88,123,029, require `crossOriginIsolated`, and wait for `MODEL READY`;
3. ensure all automatic requests remain on the page origin and no POST/PUT/PATCH
   request occurs;
4. upload the ten committed demo images and compare label/probability against
   `results/demo_predictions_cpu.json` using the existing browser tolerance and
   zero threshold flips;
5. repeat the provider case with `?provider=wasm`;
6. take the browser context offline after readiness and confirm another image
   still completes;
7. reload once and record model request/cache behavior without claiming the
   browser can never evict cache;
8. write bounded JSON containing commit, URL, browser, headers, model identity,
   providers, progress, prediction deltas, privacy requests, cache, and offline
   results.

The runner rejects a dirty tree for formal evidence and writes raw disposable
data only under ignored `web_demo/.generated-tests/online/` until the recorder
step is explicitly requested.

- [ ] **Step 4: Add scripts and evidence documentation**

Add:

```json
"test:online-acceptance": "node tools/run_online_acceptance.mjs"
```

The results README states that online evidence proves delivery integrity and
runtime parity, not a new accuracy benchmark, and remains separate from
`results/web_demo_acceptance/latest.json`.

- [ ] **Step 5: Commit the runner before creating formal evidence**

```powershell
git add web_demo/tools/run_online_acceptance.mjs web_demo/tests/unit/online-acceptance.test.mjs web_demo/package.json results/web_demo_online_acceptance/README.md
git commit -m "test(web-demo): add Vercel online acceptance"
```

- [ ] **Step 6: Push the branch and obtain a commit-specific Preview**

```powershell
git push -u origin feat/vercel-online-deployment
```

Wait for the Vercel Git deployment, inspect it, and record its exact commit and
HTTPS Preview URL. Do not promote to Production.

- [ ] **Step 7: Run formal Preview acceptance and record evidence**

```powershell
Set-Location web_demo
$previewUrl = Read-Host 'Paste the exact HTTPS Preview URL reported by Vercel'
npm.cmd run test:online-acceptance -- $previewUrl
```

The command must use the actual URL returned by Vercel, not a committed
placeholder. Copy the validated generated record to
`results/web_demo_online_acceptance/latest.json`, ensure `testedCommit` equals
the direct parent of the evidence commit, then commit only the evidence:

```powershell
git add results/web_demo_online_acceptance/latest.json
git commit -m "test(web-demo): record Vercel Preview acceptance"
git push
```

## Task 6: Reconcile documentation and run the complete handoff gate

**Files:**
- Modify: `web_demo/README.md`
- Modify after Production exists: `README.md`
- Modify: `docs/superpowers/specs/2026-08-31-vercel-online-deployment-design.md` only if implementation differs from the approved contract

- [ ] **Step 1: Write the maintainer runbook**

Document:

- online architecture and first-download behavior;
- exact privacy boundary;
- local Release remains the offline path;
- Vercel project settings;
- immutable Blob upload/verification procedure;
- Preview acceptance command;
- cache re-download cases;
- rollback without Blob overwrite;
- the stable Production URL is added only after the production gate.

- [ ] **Step 2: Run the full local and online pre-push gates**

```powershell
Set-Location web_demo
npm.cmd test
npm.cmd run typecheck
npm.cmd run build:online
npm.cmd run verify:dist
Set-Location ..
cmd /d /c web_demo\start-demo.bat --check
git diff --check
git status --short --branch
```

Expected: all tests/builds/checks PASS, tracked local `dist/` is unchanged, and
only deliberate documentation/evidence changes remain.

- [ ] **Step 3: Commit the runbook**

```powershell
git add web_demo/README.md docs/superpowers/specs/2026-08-31-vercel-online-deployment-design.md
git commit -m "docs(web-demo): document Vercel operations"
```

- [ ] **Step 4: Integrate the parallel local Release work before merge**

Fetch/prune, compare this branch with current `origin/main`, merge current main
into the feature branch without rewriting history, resolve only overlapping
online/local documentation or build files, and rerun Step 2 plus Preview
acceptance on the new exact head.

- [ ] **Step 5: Present the review artifact and wait for merge approval**

Report commits, Preview URL/status, model Blob identity, acceptance evidence,
local Release non-regression, remaining production-only README update, and the
exact merge/production steps. Do not merge or promote before the user approves.

## Plan self-review result

- Spec coverage: all scope, model, build isolation, Blob, headers, caching,
  progress, integrity, privacy, failure, Preview, evidence, rollback, and local
  Release integration requirements map to Tasks 1-6.
- Placeholder scan: dynamic Vercel values are obtained from explicit CLI output
  and must be inserted as literal verified values; no source file is allowed to
  contain a dummy Blob or Preview URL.
- Type consistency: `modelCache`, `fetchVerifiedModelBytes`,
  `verifyModelSha256`, `buildOutputDirectory`, and `prepareOnlineDist` use the
  same names throughout tests and implementation steps.
