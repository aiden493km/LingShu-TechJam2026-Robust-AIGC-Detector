# Final Checkpoint

The final frozen model checkpoint should be placed here as:

```text
checkpoints/baseline2_njr_best.pt
```

Original experiment checkpoint name:

```text
baseline2_ab_noise_jpeg_resize_best.pt
```

Final model configuration:

```text
Community Forensics ViT-S/16
Input: 384 x 384
Fine-tuning recipe: Gaussian Noise + JPEG + Resize
Best epoch: 4
Frozen validation threshold: 0.55657113
```

## Why the checkpoint is not committed directly

Model checkpoints (`*.pt`, `*.pth`, `*.ckpt`) are ignored by `.gitignore` to keep the Git repository lightweight and avoid accidental commits of historical checkpoints.

The frozen checkpoint is published as the `baseline2_njr_best.pt` asset on
[`v1.0.0 — Final B2-NJR Checkpoint`](https://github.com/aiden493km/LingShu-TechJam2026-Robust-AIGC-Detector/releases/tag/v1.0.0).
Download that release asset into this directory for the Python CLI and evaluation
scripts.

Expected identity:

```text
Bytes:   87,312,599
SHA-256: 9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba
```

The local browser WebDemo does not load this PyTorch file. It uses the FP32 ONNX
export committed as an ordinary Git blob at
`web_demo/models/baseline2_njr_fp32.onnx`, so the submitted WebDemo clone/ZIP is
self-contained and does not need a release download at launch.

## Expected local layout

```text
project/
├── inference.py
├── models.py
└── checkpoints/
    ├── README.md
    └── baseline2_njr_best.pt
```

Once the checkpoint is present, inference can be run with:

```bash
python inference.py \
  --input ./demo_images \
  --output ./results/predictions.json \
  --checkpoint ./checkpoints/baseline2_njr_best.pt \
  --device auto \
  --pretty
```
