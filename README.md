# Robust AIGC Image Detector under Real-World Transformations

**TikTok TechJam 2026 — Track 5**

A robust image-level detector for distinguishing authentic images from AI-generated images (AIGC), with a focus on maintaining detection performance after common real-world image transformations.

Our final model, **B2-NJR**, is based on the Community Forensics ViT-S/16 detector and is robustness-aware fine-tuned with **Gaussian Noise + JPEG Compression + Resize**.

---

## Highlights

- **Directory-in, JSON-out inference** with a continuous AIGC confidence score for every image.
- **CPU and CUDA support**.
- Final inference loads the frozen local checkpoint directly and does **not require model-weight downloads at inference time**.
- Systematic augmentation ablation rather than blindly stacking all transformations.
- Frozen validation threshold and one-time held-out test evaluation.
- External demonstration benchmark on **COCO + DALL·E Advanced**.
- Exact-duplicate and near-duplicate leakage audit.

---

## Final Model

| Item | Configuration |
|---|---|
| Base detector | `OwensLab/commfor-model-384` |
| Architecture | Community Forensics ViT-S/16 |
| Input size | 384 × 384 |
| Task | Binary image-level AIGC detection |
| Final recipe | Gaussian Noise + JPEG + Resize |
| Gaussian Blur | Excluded after ablation |
| Best epoch | 4 |
| Frozen threshold | `0.55657113` |
| Threshold source | Clean validation only |

The output field `pred` is the estimated probability/confidence that an image is **AI-generated**.

---

## Quick Start

### 1. Install dependencies

Python 3.11+ is recommended.

```bash
pip install -r requirements.txt
```

### 2. Place the final checkpoint

Place the frozen checkpoint at:

```text
checkpoints/baseline2_njr_best.pt
```

The checkpoint is intentionally excluded from normal Git commits. See [`checkpoints/README.md`](checkpoints/README.md).

### 3. Run inference

```bash
python inference.py \
  --input ./demo_images \
  --output ./results/predictions.json \
  --checkpoint ./checkpoints/baseline2_njr_best.pt \
  --device auto \
  --pretty
```

On Windows PowerShell:

```powershell
python .\inference.py `
  --input ".\demo_images" `
  --output ".\results\predictions.json" `
  --checkpoint ".\checkpoints\baseline2_njr_best.pt" `
  --device auto `
  --pretty
```

`--device` supports:

```text
auto
cuda
cpu
```

For memory-constrained machines, reduce the batch size:

```bash
python inference.py \
  --input ./demo_images \
  --output ./results/predictions.json \
  --checkpoint ./checkpoints/baseline2_njr_best.pt \
  --device cpu \
  --batch-size 4 \
  --pretty
```

---

## Output Format

For each discovered image, the inference script outputs:

```json
[
  {
    "image_path": "example.jpg",
    "pred": 0.987654
  }
]
```

where:

- `image_path` is the input image path;
- `pred ∈ [0,1]` is the AIGC confidence score;
- larger values indicate stronger confidence that the image is AI-generated.

The frozen threshold `0.55657113` is used only for console-level Real/AIGC summaries. The JSON retains the continuous score.

Supported formats include JPEG, PNG, WebP, BMP, TIFF, and related common extensions.

---

## Method

### Baseline 0 — Pretrained detector

We first evaluated the pretrained Community Forensics model without Track 5 fine-tuning.

### Baseline 1 — Clean-only fine-tuning

The model was fine-tuned on clean SID + WildFake training data to measure how much domain adaptation alone improves performance.

### Baseline 2 — Robustness-aware fine-tuning

Four transformation families were evaluated through ablation:

- Gaussian Noise
- JPEG Compression
- Resize
- Gaussian Blur

The experiments showed that:

- Gaussian Noise produced the strongest overall robustness gain;
- JPEG substantially improved heavy-compression robustness;
- Resize improved robustness to downsampling;
- Gaussian Blur provided narrower benefits and was not included in the final combination.

The selected final recipe was therefore:

**Noise + JPEG + Resize (B2-NJR)**.

---

## Held-Out Test Results

The final model configuration, checkpoint, epoch, and threshold were frozen **before** evaluating the held-out test set.

| Metric | Baseline 1 | Final B2-NJR |
|---|---:|---:|
| Clean AUC | 0.999925 | **0.999918** |
| Mean Robust Accuracy | 0.889521 | **0.973977** |
| Mean Robust AUC | 0.952179 | **0.996791** |
| Worst Robust Accuracy | 0.640803 | **0.927090** |
| Worst Robust AUC | 0.724830 | **0.980329** |

The hardest final condition was **Gaussian Noise, σ = 0.10**.

B2-NJR improves mean robust accuracy by approximately **8.45 percentage points** and worst-case robust accuracy by approximately **28.63 percentage points** over clean-only fine-tuning, while preserving essentially unchanged clean AUC.

Detailed files are available under:

```text
results/final_test/
results/ablation/
```

---

## External Demonstration Benchmark

A separate post-freeze external benchmark was used to examine cross-source generalisation:

- **COCO val2017** authentic images: 4,998
- **DALL·E Advanced** AI-generated images: 8,843
- Total: 13,841 images

The frozen B2-NJR model achieved:

| Metric | B2-NJR |
|---|---:|
| Accuracy | **0.919876** |
| Balanced Accuracy | **0.935686** |
| ROC-AUC | **0.993124** |
| F1 | **0.933397** |
| Authentic / Real Accuracy | **0.992597** |
| AIGC / Fake Accuracy | **0.878774** |

No threshold calibration was performed on this external benchmark.

Detailed results and error candidates are available under:

```text
results/official_demo/
```

---

## Data Integrity and Leakage Audit

Before using the external demonstration benchmark, we audited potential overlap between development/training data and the external benchmark.

Results:

- filename overlap: **0**
- exact SHA-256 duplicates: **0**
- perceptual-hash candidate pairs reviewed: **465**
- manually confirmed duplicates: **0**

The public repository includes compact audit summaries under:

```text
results/data_integrity/
```

The image assets used during manual review are intentionally not distributed.

---

## Repository Structure

```text
.
├── README.md
├── requirements.txt
├── .gitignore
├── THIRD_PARTY_NOTICES.md
│
├── inference.py
├── models.py
├── train_baseline1_clean.py
├── train_baseline2_ablation.py
├── eval_baseline2_final_test.py
├── eval_official_demo_benchmark.py
├── check_official_benchmark_leakage.py
├── make_near_duplicate_review.py
├── finalize_near_duplicate_review.py
│
├── checkpoints/
│   └── README.md
│
├── demo_images/
│
├── results/
│   ├── ablation/
│   ├── final_test/
│   ├── official_demo/
│   └── data_integrity/
│
├── reports/
│
└── assets/
    └── figures/
```

---

## Evaluation Protocol

The final evaluation protocol follows a strict model-selection separation:

```text
Training
   ↓
Validation-based ablation and model selection
   ↓
Checkpoint / augmentation recipe / threshold frozen
   ↓
Held-out test evaluated once
   ↓
External demonstration benchmark evaluated post-freeze
```

The held-out test was not used to modify:

- augmentation recipe;
- checkpoint selection;
- training epoch;
- threshold;
- learning rate;
- sampling ratio.

---

## Reproducing the Final Held-Out Evaluation

The portable final-test script accepts command-line paths rather than machine-specific absolute paths:

```bash
python eval_baseline2_final_test.py \
  --val-root /path/to/val \
  --test-root /path/to/test \
  --b1-checkpoint /path/to/baseline1_clean_best.pt \
  --b2-checkpoint ./checkpoints/baseline2_njr_best.pt \
  --output-dir ./results/final_test \
  --device auto \
  --batch-size 32
```

Dataset files are not redistributed in this repository. Users should obtain the relevant datasets from their original sources and follow the expected directory structure used by the scripts.

---

## Notes on Offline Inference

The final B2-NJR checkpoint stores the complete model state.

For final inference, `models.py` builds the ViT-S/16 architecture locally with pretrained-backbone downloading disabled, and `inference.py` then loads the frozen checkpoint.

Therefore, after Python dependencies and the checkpoint itself are available locally, final image inference does not need to download model weights from Hugging Face or timm.

---

## Third-Party Attribution

This project builds on **Community Forensics** and its ViT classifier implementation.

Please see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for attribution and licensing information.

---

## Track

**TikTok TechJam 2026**  
**Track 5 — Robust Detection of AI-Generated Images Under Real-World Transformations**
