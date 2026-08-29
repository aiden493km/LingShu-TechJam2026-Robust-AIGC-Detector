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

For the public submission, publish the final checkpoint as a release asset or another stable model-hosting download, then add the download link to this file.

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
