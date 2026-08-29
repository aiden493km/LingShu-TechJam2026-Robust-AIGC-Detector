# Browser Model Deployment Experiment

This experiment answers one deployment question: can the frozen B2-NJR checkpoint
run entirely in a judge's browser, without a continuously running inference server?

## Decision

- Use **ONNX FP16 with ONNX Runtime Web WebGPU** as the primary browser model.
- Use **ONNX FP32 with ONNX Runtime Web WASM** as the compatibility fallback.
- Do **not** ship the current dynamic INT8 export. It is smaller, but it produced
  unacceptable probability drift and decision flips on the extended parity set.
- Host the static frontend on Cloudflare Pages and the model files on R2 (or an
  equivalent object store). Both accepted models exceed the
  [25 MiB single-file Pages asset limit](https://developers.cloudflare.com/pages/platform/limits/#file-size),
  and Cloudflare explicitly recommends R2 for larger files. R2's Standard class
  currently includes a [monthly free tier](https://developers.cloudflare.com/r2/pricing/#free-tier).
- Keep the existing PyTorch inference path as a local FastAPI plus Tunnel fallback
  for development and the competition venue. It is not required by the normal
  browser-only path.

This is a deployment-parity result, not a new accuracy evaluation. The 67-image
extended fixture is anonymous and unlabeled. Before claiming that FP16 preserves
the detector's accuracy, run it against the official or another labeled,
representative validation set, especially samples close to the frozen threshold.

## Frozen inputs

| Item | Value |
|---|---:|
| Release checkpoint | `v1.0.0 — Final B2-NJR Checkpoint` |
| Checkpoint file | `baseline2_njr_best.pt` |
| Checkpoint size | 87,312,599 bytes |
| Checkpoint SHA-256 | `9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba` |
| Input tensor | `1 × 3 × 384 × 384`, float32 |
| Frozen threshold | `0.55657113` |
| ONNX opset | 18 |

## Environment

- Windows 11, Python 3.12.10, Node.js 24.19.0
- PyTorch 2.10.0+cpu, ONNX 1.22.0, ONNX Runtime 1.29.0
- ONNX Runtime Web 1.29.0, Microsoft Edge 151.0.4129.107
- NVIDIA GeForce RTX 3070 Laptop GPU, Ampere, 8 GiB

The recorded `model_download_ms` values below use a local HTTP server. They measure
browser fetch and model handoff overhead, not real Internet download time.

## Results

### Model size

| Variant | Bytes | MiB | Relative to FP32 |
|---|---:|---:|---:|
| ONNX FP32 | 88,123,029 | 84.04 | 100% |
| ONNX FP16 | 44,499,632 | 42.44 | 50.5% |
| ONNX dynamic INT8 | 22,809,585 | 21.75 | 25.9% |

### Edge browser, 10 committed demo images

Times are a single local run and should be treated as indicative, not as a universal
latency guarantee. Probability errors are measured against PyTorch FP32.

| Model | Provider | Session create | First/warm-up | Mean per image | Max probability error | Threshold flips |
|---|---|---:|---:|---:|---:|---:|
| FP32 | WebGPU | 955.36 ms | 441.80 ms | 20.55 ms | 5.77e-8 | 0/10 |
| FP16 | WebGPU | 862.33 ms | 495.75 ms | 17.07 ms | 3.63e-4 | 0/10 |
| INT8 | WebGPU | 810.44 ms | 877.90 ms | 360.29 ms | 9.71e-5 | 0/10 |
| FP32 | WASM | 417.67 ms | 358.20 ms | 340.35 ms | 5.77e-8 | 0/10 |
| INT8 | WASM | 340.70 ms | 412.18 ms | 241.47 ms | 7.95e-4 | 0/10 |

INT8/WebGPU also emitted an ONNX Runtime execution-provider assignment warning and
was much slower than FP16/WebGPU, so its small demo-set parity does not make it a
useful primary path.

### Extended parity fixture, 67 unlabeled images

| Model | Provider | Mean per image | Max probability error | Mean probability error | Threshold flips |
|---|---|---:|---:|---:|---:|
| FP16 | WebGPU | 15.47 ms | 0.06521 | 0.002441 | 0/67 |
| INT8 | WASM | 228.86 ms | 0.93600 | 0.155510 | 10/67 |

Desktop ONNX Runtime follow-ups did not rescue dynamic INT8: per-channel INT8
produced 9/67 flips, and per-channel plus reduced range produced 4/67 flips. Static
quantization with representative calibration data remains a possible future
experiment, but the present INT8 artifacts are rejected.

FP16 CPU execution was stopped after ten minutes without completing the 10-image
demo. FP16 is therefore a WebGPU-only choice; it must not be used as the WASM/CPU
fallback.

## Reproduce

The checkpoint and generated ONNX models are intentionally ignored by Git. Download
the release checkpoint to `checkpoints/baseline2_njr_best.pt` first.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-web-experiment.txt
.\.venv\Scripts\python.exe web_model_experiment.py `
  --checkpoint checkpoints\baseline2_njr_best.pt `
  --images demo_images `
  --model-dir web_models `
  --fixture-name demo

Set-Location browser_benchmark
npm.cmd ci
npm.cmd run benchmark
```

The browser runner always executes the five committed-demo combinations. It also
runs the two extended-fixture combinations when the local
`web_models/extended_inputs.json` and `extended_inputs_f32.bin` files exist.

## Recorded artifacts

- `pytorch_fp32_predictions.json`: PyTorch FP32 scores for the committed demo images.
- `browser_runtime_results.json`: raw Edge WebGPU/WASM measurements and parity data.
- `web_models/python_experiment_report.json`: generated local ONNX Runtime report;
  ignored because it lives with the generated models.
