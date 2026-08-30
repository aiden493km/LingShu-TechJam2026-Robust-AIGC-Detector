# Repository Agent Guide

## Project scope

This repository contains the TikTok TechJam 2026 Track 5 B2-NJR robust AIGC
detector, its frozen evaluation evidence, the Python inference workflow, and a
self-contained local browser WebDemo.

Keep public claims evidence-bounded. Held-out robustness results, the external
COCO + DALL-E Advanced demonstration benchmark, browser deployment parity, and
historical compression experiments are different evidence sets and must not be
presented as interchangeable accuracy results.

## Local WebDemo contract

- The judge entries are `web_demo/start-demo.bat` on Windows x86-64 and
  `web_demo/start-demo.command` on Apple Silicon macOS. Each verifies and reuses
  its pinned repository-bundled Python runtime, starts a
  Python-standard-library server on `127.0.0.1`, and opens the local page.
- The only deployed browser model is
  `web_demo/models/baseline2_njr_fp32.onnx`.
- Model identity: 88,123,029 bytes, SHA-256
  `e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69`.
- Frozen AIGC threshold: `0.55657113`.
- WebGPU is attempted first; WASM is the compatibility fallback. Both providers
  must load the same FP32 model. Do not silently introduce FP16, INT8, a remote
  API, mock output, or a second deployed model.
- Browser preprocessing order is EXIF transpose, RGB conversion, 384 x 384
  bicubic resize, tensor conversion, then ImageNet normalization.
- Normal judge launch must not require Node.js, npm, pip installation, a model
  download, Git LFS, an API key, Internet access, or an inference server.
- Selected image bytes stay in the browser application. Do not add analytics,
  remote fonts/assets, persistence, uploads, or non-loopback serving without an
  explicit product decision and corresponding documentation/security review.

## Source, build, and evidence

`web_demo/src/` is the editable React/TypeScript source. `web_demo/dist/` is the
committed production build used by judges; keep it synchronized with source and
do not hand-edit generated assets.

Judge smoke check from the repository root:

```powershell
cmd /d /c web_demo\start-demo.bat --check
```

Fresh developer setup uses Python 3.12 for the recorded parity environment and a
Node.js version accepted by both pinned Vite and Vitest (`^20.19.0`, `^22.12.0`,
or `>=24.0.0`):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-web-experiment.txt
Set-Location web_demo
npm.cmd ci
Set-Location ..
```

Then run the developer gates:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Set-Location web_demo
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run verify:dist
```

Formal browser evidence must be generated from a clean committed tree in this
exact order:

```powershell
Set-Location web_demo
npm.cmd run test:browser-acceptance
npm.cmd run test:preprocess-parity
npm.cmd run record:acceptance-evidence
```

Commit only `results/web_demo_acceptance/latest.json` in the subsequent
evidence-only commit. Its `testedCommit` must equal that evidence commit's direct
parent. Do not edit the evidence JSON manually or describe deployment parity as a
new accuracy evaluation.

## Documentation and release boundaries

- `README.md` is the public project overview and judge entry point.
- `docs/Track5_数据处理与鲁棒性评测管线说明.docx` is the Chinese data-processing
  and robustness-evaluation handoff report. Preserve its evidence boundary: it
  explains the project pipeline but does not redistribute the datasets or
  original training manifests, and it does not supersede committed scripts or
  machine-readable results.
- `web_demo/README.md` is the judge/developer runbook.
- `docs/superpowers/specs/2026-08-30-offline-fp32-webdemo-design.md` records the
  implemented runtime architecture.
- `docs/superpowers/plans/2026-08-30-offline-fp32-webdemo.md` is a completed
  historical implementation plan, not the current task list.
- `docs/superpowers/plans/2026-08-30-portable-cross-platform-webdemo-launcher.md`
  records the implemented bundled-runtime launcher work and its remaining
  physical-machine acceptance boundary.
- `results/web_demo_acceptance/portable-launchers.md` records portable-launcher
  smoke evidence separately from the formal browser-inference `latest.json`.
- `results/web_model_experiment/README.md` preserves historical FP16/INT8
  experiments. Its old recommendation is superseded by the formal FP32-only
  decision.
- `THIRD_PARTY_NOTICES.md` is an inventory, not a legal certification. Do not
  state that public model-weight redistribution is cleared until the recorded
  model/dataset and complete runtime-notice gates are resolved.
- `PRODUCT.md` and `DESIGN.md` are the current product and visual contracts for
  the implemented Semantic Signal detector experience. The committed site now
  includes Detector, Technology, Results, Error Analysis, and About views,
  in-session recent detections, and the reference-locked title/particle motion.
  Team member names and individual biographies remain pending confirmation; do
  not replace those bounded placeholders with invented profiles.

## Change discipline

- Preserve unrelated user/team changes and existing experiment artifacts.
- Use Conventional Commits and semantic branch names such as `feat/web-demo`.
- Prefer focused commits after their relevant checks pass.
- Never rewrite or recommit the 84 MiB ONNX file for cosmetic changes.
- Before merging or pushing, fetch the current remote branch, compare against
  `origin/main`, resolve overlapping documentation deliberately, and rerun gates
  in proportion to the changed runtime surface.
