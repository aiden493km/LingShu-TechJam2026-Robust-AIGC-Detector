#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
TikTok TechJam 2026 Track 5
Official Demonstration Benchmark Evaluation

Official reference benchmark:
- Real / Non-AIGC: COCO val2017, 4,998 images
- Fake / AIGC: DALL-E Advanced, 8,843 images
- Total: 13,841 images

Protocol:
- B0/B1/B2-NJR are fully frozen.
- NO threshold calibration on the official benchmark.
- NO model / checkpoint / augmentation selection.
- Official benchmark is report-only.
- Input images are resized to 384x384 only as standard model preprocessing.
"""

import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np
import torch
from torchvision import transforms
from PIL import Image, ImageFile, ImageOps

import models


# ============================================================
# PIL SETTINGS
# ============================================================

ImageFile.LOAD_TRUNCATED_IMAGES = True


# ============================================================
# FROZEN CONFIG
# ============================================================

MODEL_NAME = "OwensLab/commfor-model-384"
IMAGE_SIZE = 384

SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp",
    ".bmp", ".tif", ".tiff",
}

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_B2_CHECKPOINT = REPO_ROOT / "checkpoints" / "baseline2_njr_best.pt"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "results" / "official_demo"

# FROZEN thresholds.
# Selected previously from CLEAN validation only.
FROZEN_THRESHOLDS = {
    "baseline0": 0.07581470,
    "baseline1": 0.59710413,
    "baseline2_njr": 0.55657113,
}

EXPECTED_REAL = 4998
EXPECTED_FAKE = 8843
EXPECTED_TOTAL = 13841


# ============================================================
# CLI
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Evaluate frozen B0/B1/B2-NJR on the official "
            "COCO + DALL-E demonstration benchmark."
        )
    )

    parser.add_argument(
        "--real-root",
        type=Path,
        required=True,
    )

    parser.add_argument(
        "--fake-root",
        type=Path,
        required=True,
    )

    parser.add_argument(
        "--b1-checkpoint",
        type=Path,
        required=True,
    )

    parser.add_argument(
        "--b2-checkpoint",
        type=Path,
        default=DEFAULT_B2_CHECKPOINT,
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
    )

    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="Inference device. Default: auto.",
    )

    return parser.parse_args()


# ============================================================
# PREPROCESSING
# ============================================================

NORMALIZE = transforms.Normalize(
    mean=[0.485, 0.456, 0.406],
    std=[0.229, 0.224, 0.225],
)


def prepare_image(path):
    """
    Standard model input preprocessing only.

    This is NOT a robustness transformation:
    - EXIF transpose
    - RGB conversion
    - resize to model-required 384x384 if necessary
    - ToTensor
    - ImageNet normalization
    """
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        original_size = img.size

        if img.size != (IMAGE_SIZE, IMAGE_SIZE):
            img = img.resize(
                (IMAGE_SIZE, IMAGE_SIZE),
                resample=Image.Resampling.BICUBIC,
            )

        tensor = transforms.functional.to_tensor(img)
        tensor = NORMALIZE(tensor)

    return tensor, original_size


# ============================================================
# DATA COLLECTION
# ============================================================

def list_images(root):
    return sorted(
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def collect_items(real_root, fake_root):
    real_paths = list_images(real_root)
    fake_paths = list_images(fake_root)

    print()
    print("=" * 100)
    print("OFFICIAL BENCHMARK DATA")
    print("=" * 100)
    print("COCO real / Non-AIGC :", len(real_paths))
    print("DALL-E Advanced fake :", len(fake_paths))
    print("Total                :", len(real_paths) + len(fake_paths))

    if len(real_paths) != EXPECTED_REAL:
        raise RuntimeError(
            f"Expected {EXPECTED_REAL} COCO real images, "
            f"found {len(real_paths)}."
        )

    if len(fake_paths) != EXPECTED_FAKE:
        raise RuntimeError(
            f"Expected {EXPECTED_FAKE} DALL-E fake images, "
            f"found {len(fake_paths)}."
        )

    if len(real_paths) + len(fake_paths) != EXPECTED_TOTAL:
        raise RuntimeError(
            f"Expected {EXPECTED_TOTAL} total official images, "
            f"found {len(real_paths) + len(fake_paths)}."
        )

    items = []

    for p in real_paths:
        items.append(
            {
                "path": p,
                "source": "COCO_val2017",
                "label_name": "real",
                "label": 0,
            }
        )

    for p in fake_paths:
        items.append(
            {
                "path": p,
                "source": "DALLE_Advanced",
                "label_name": "fake",
                "label": 1,
            }
        )

    return items


# ============================================================
# MODEL LOADING
# ============================================================

def load_checkpoint_model(checkpoint, device, label):
    if not checkpoint.exists():
        raise FileNotFoundError(
            f"{label} checkpoint not found:\n{checkpoint}"
        )

    model = models.ViTClassifier(
        model_size="small",
        input_size=IMAGE_SIZE,
        patch_size=16,
        device="cpu",
        pretrained_backbone=False,
    )

    state_dict = torch.load(
        checkpoint,
        map_location="cpu",
        weights_only=True,
    )

    model.load_state_dict(state_dict, strict=True)
    model = model.to(device)
    model.eval()

    return model


def load_models(b1_checkpoint, b2_checkpoint, device):
    print()
    print("=" * 100)
    print("LOADING FROZEN MODELS")
    print("=" * 100)

    print("B0 pretrained:")
    print(MODEL_NAME)
    b0 = models.ViTClassifier.from_pretrained(MODEL_NAME)
    b0 = b0.to(device)
    b0.eval()
    print("B0 loaded.")

    print()
    print("B1 clean fine-tuned:")
    print(b1_checkpoint)
    b1 = load_checkpoint_model(
        b1_checkpoint,
        device,
        "Baseline 1",
    )
    print("B1 loaded.")

    print()
    print("B2-NJR final:")
    print(b2_checkpoint)
    b2 = load_checkpoint_model(
        b2_checkpoint,
        device,
        "Baseline 2 NJR",
    )
    print("B2-NJR loaded.")

    return {
        "baseline0": b0,
        "baseline1": b1,
        "baseline2_njr": b2,
    }


# ============================================================
# AUC
# Kept aligned with previous evaluator.
# ============================================================

def binary_auc(y_true, y_score):
    y_true = np.asarray(y_true, dtype=np.int64)
    y_score = np.asarray(y_score, dtype=np.float64)

    pos_scores = y_score[y_true == 1]
    neg_scores = y_score[y_true == 0]

    if len(pos_scores) == 0 or len(neg_scores) == 0:
        return float("nan")

    order = np.argsort(y_score)
    sorted_scores = y_score[order]
    ranks = np.empty(len(y_score), dtype=np.float64)

    i = 0

    while i < len(sorted_scores):
        j = i + 1

        while (
            j < len(sorted_scores)
            and sorted_scores[j] == sorted_scores[i]
        ):
            j += 1

        average_rank = ((i + 1) + j) / 2.0
        ranks[order[i:j]] = average_rank
        i = j

    n_pos = len(pos_scores)
    n_neg = len(neg_scores)
    sum_pos_ranks = ranks[y_true == 1].sum()

    auc = (
        sum_pos_ranks
        - n_pos * (n_pos + 1) / 2
    ) / (n_pos * n_neg)

    return float(auc)


# ============================================================
# METRICS
# ============================================================

def calculate_metrics(records, threshold):
    y_true = np.asarray(
        [r["label"] for r in records],
        dtype=np.int64,
    )

    y_score = np.asarray(
        [r["aigc_probability"] for r in records],
        dtype=np.float64,
    )

    y_pred = (y_score >= threshold).astype(np.int64)

    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    tn = int(np.sum((y_true == 0) & (y_pred == 0)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))

    total = len(y_true)

    accuracy = (
        (tp + tn) / total
        if total > 0
        else 0.0
    )

    precision = (
        tp / (tp + fp)
        if (tp + fp) > 0
        else 0.0
    )

    recall = (
        tp / (tp + fn)
        if (tp + fn) > 0
        else 0.0
    )

    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )

    real_accuracy = (
        tn / (tn + fp)
        if (tn + fp) > 0
        else 0.0
    )

    fake_accuracy = (
        tp / (tp + fn)
        if (tp + fn) > 0
        else 0.0
    )

    balanced_accuracy = (
        real_accuracy + fake_accuracy
    ) / 2.0

    auc = binary_auc(
        y_true,
        y_score,
    )

    real_mask = y_true == 0
    fake_mask = y_true == 1

    mean_prob_real = (
        float(y_score[real_mask].mean())
        if np.any(real_mask)
        else float("nan")
    )

    mean_prob_fake = (
        float(y_score[fake_mask].mean())
        if np.any(fake_mask)
        else float("nan")
    )

    return {
        "samples": int(total),
        "threshold": float(threshold),
        "accuracy": float(accuracy),
        "balanced_accuracy": float(balanced_accuracy),
        "auc": float(auc),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "real_accuracy": float(real_accuracy),
        "fake_accuracy": float(fake_accuracy),
        "mean_prob_real": mean_prob_real,
        "mean_prob_fake": mean_prob_fake,
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
    }


# ============================================================
# INFERENCE
# ============================================================

def evaluate(items, model_dict, device, batch_size):
    records = {
        name: []
        for name in model_dict
    }

    image_errors = []

    total_batches = (
        len(items) + batch_size - 1
    ) // batch_size

    start_time = time.time()

    print()
    print("=" * 100)
    print("OFFICIAL BENCHMARK INFERENCE")
    print("No threshold calibration. No tuning.")
    print("=" * 100)

    with torch.inference_mode():

        for start_idx in range(
            0,
            len(items),
            batch_size,
        ):

            batch_items = items[
                start_idx:start_idx + batch_size
            ]

            tensors = []
            valid_items = []
            original_sizes = []

            for item in batch_items:

                try:
                    tensor, original_size = prepare_image(
                        item["path"]
                    )

                    tensors.append(tensor)
                    valid_items.append(item)
                    original_sizes.append(original_size)

                except Exception as e:
                    image_errors.append(
                        {
                            "path": str(item["path"]),
                            "error": repr(e),
                        }
                    )

                    print(
                        "[IMAGE ERROR]",
                        item["path"],
                        repr(e),
                    )

            if not tensors:
                continue

            pixel_values = torch.stack(
                tensors,
                dim=0,
            ).to(
                device,
                non_blocking=True,
            )

            for model_name, model in model_dict.items():

                logits = model(
                    pixel_values
                ).reshape(-1)

                probs = torch.sigmoid(
                    logits
                ).cpu().numpy()

                threshold = FROZEN_THRESHOLDS[
                    model_name
                ]

                for (
                    item,
                    prob,
                    original_size,
                ) in zip(
                    valid_items,
                    probs,
                    original_sizes,
                ):

                    pred = int(
                        float(prob) >= threshold
                    )

                    records[
                        model_name
                    ].append(
                        {
                            "model":
                                model_name,

                            "image_path":
                                str(item["path"]),

                            "source":
                                item["source"],

                            "label_name":
                                item["label_name"],

                            "label":
                                item["label"],

                            "original_width":
                                original_size[0],

                            "original_height":
                                original_size[1],

                            "aigc_probability":
                                float(prob),

                            "threshold":
                                threshold,

                            "pred":
                                pred,

                            "pred_name":
                                (
                                    "fake"
                                    if pred == 1
                                    else "real"
                                ),

                            "correct":
                                int(
                                    pred
                                    == item["label"]
                                ),
                        }
                    )

            batch_num = (
                start_idx // batch_size
                + 1
            )

            if (
                batch_num % 20 == 0
                or batch_num == total_batches
            ):
                print(
                    f"[{batch_num:3d}/{total_batches}] "
                    f"{len(valid_items)} current batch"
                )

    elapsed = time.time() - start_time

    print()
    print(
        f"Inference time: {elapsed:.2f}s"
    )

    return records, image_errors, elapsed


# ============================================================
# CSV
# ============================================================

def write_csv(path, rows):
    if not rows:
        return

    with path.open(
        "w",
        newline="",
        encoding="utf-8-sig",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=list(rows[0].keys()),
        )

        writer.writeheader()
        writer.writerows(rows)


# ============================================================
# ERROR ANALYSIS CANDIDATES
# ============================================================

def build_b2_error_candidates(records):
    """
    Save B2 false positives / false negatives for later
    competition error-analysis work.

    FP: real image predicted fake
    FN: fake image predicted real

    Sort by confidence in the wrong decision.
    """

    fp = [
        r
        for r in records
        if (
            r["label"] == 0
            and r["pred"] == 1
        )
    ]

    fn = [
        r
        for r in records
        if (
            r["label"] == 1
            and r["pred"] == 0
        )
    ]

    fp.sort(
        key=lambda r:
            r["aigc_probability"],
        reverse=True,
    )

    fn.sort(
        key=lambda r:
            r["aigc_probability"],
    )

    rows = []

    for rank, r in enumerate(
        fp,
        1,
    ):
        x = dict(r)
        x["error_type"] = "false_positive"
        x["error_rank"] = rank
        rows.append(x)

    for rank, r in enumerate(
        fn,
        1,
    ):
        x = dict(r)
        x["error_type"] = "false_negative"
        x["error_rank"] = rank
        rows.append(x)

    return rows


# ============================================================
# MAIN
# ============================================================

def main():
    args = parse_args()

    print("=" * 120)
    print("TIKTOK TECHJAM 2026 TRACK 5")
    print("OFFICIAL DEMONSTRATION BENCHMARK")
    print("B0 PRETRAINED vs B1 CLEAN-FT vs B2-NJR FINAL")
    print("=" * 120)

    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    elif args.device == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError(
                "--device cuda was requested, but CUDA is not available."
            )
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")

    print("Device              :", device)

    if device.type == "cuda":
        print(
            "GPU                 :",
            torch.cuda.get_device_name(0),
        )

    print("Official real root  :", args.real_root)
    print("Official fake root  :", args.fake_root)
    print("B1 checkpoint       :", args.b1_checkpoint)
    print("B2 checkpoint       :", args.b2_checkpoint)
    print("Output directory    :", args.output_dir)
    print("Batch size          :", args.batch_size)
    print()
    print("Frozen thresholds:")
    print(
        "  B0:",
        f"{FROZEN_THRESHOLDS['baseline0']:.8f}"
    )
    print(
        "  B1:",
        f"{FROZEN_THRESHOLDS['baseline1']:.8f}"
    )
    print(
        "  B2:",
        f"{FROZEN_THRESHOLDS['baseline2_njr']:.8f}"
    )
    print("=" * 120)

    # --------------------------------------------------------
    # PATH CHECKS
    # --------------------------------------------------------

    for path, label in [
        (args.real_root, "Official real root"),
        (args.fake_root, "Official fake root"),
        (args.b1_checkpoint, "B1 checkpoint"),
        (args.b2_checkpoint, "B2 checkpoint"),
    ]:

        if not path.exists():
            raise FileNotFoundError(
                f"{label} does not exist:\n{path}"
            )

    args.output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    # --------------------------------------------------------
    # DATA
    # --------------------------------------------------------

    items = collect_items(
        args.real_root,
        args.fake_root,
    )

    # --------------------------------------------------------
    # MODELS
    # --------------------------------------------------------

    model_dict = load_models(
        args.b1_checkpoint,
        args.b2_checkpoint,
        device,
    )

    model_order = [
        "baseline0",
        "baseline1",
        "baseline2_njr",
    ]

    # --------------------------------------------------------
    # INFERENCE
    # --------------------------------------------------------

    records, image_errors, elapsed = evaluate(
        items=items,
        model_dict=model_dict,
        device=device,
        batch_size=args.batch_size,
    )

    # Strict completeness check.
    if image_errors:
        raise RuntimeError(
            f"\n{len(image_errors)} image(s) failed to load. "
            "The error list will be saved, but official metrics "
            "are NOT finalized until all 13,841 images succeed."
        )

    for model_name in model_order:

        if len(records[model_name]) != EXPECTED_TOTAL:
            raise RuntimeError(
                f"{model_name}: expected "
                f"{EXPECTED_TOTAL} predictions, "
                f"got {len(records[model_name])}."
            )

    # --------------------------------------------------------
    # METRICS
    # --------------------------------------------------------

    summary_rows = []

    for model_name in model_order:

        metrics = calculate_metrics(
            records[model_name],
            FROZEN_THRESHOLDS[model_name],
        )

        summary_rows.append(
            {
                "model": model_name,
                **metrics,
            }
        )

    summary_map = {
        r["model"]: r
        for r in summary_rows
    }

    b0 = summary_map["baseline0"]
    b1 = summary_map["baseline1"]
    b2 = summary_map["baseline2_njr"]

    comparison_rows = [
        {
            "comparison": "B1_minus_B0",
            "delta_accuracy":
                b1["accuracy"] - b0["accuracy"],
            "delta_balanced_accuracy":
                b1["balanced_accuracy"]
                - b0["balanced_accuracy"],
            "delta_auc":
                b1["auc"] - b0["auc"],
            "delta_f1":
                b1["f1"] - b0["f1"],
            "delta_real_accuracy":
                b1["real_accuracy"]
                - b0["real_accuracy"],
            "delta_fake_accuracy":
                b1["fake_accuracy"]
                - b0["fake_accuracy"],
        },
        {
            "comparison": "B2_minus_B1",
            "delta_accuracy":
                b2["accuracy"] - b1["accuracy"],
            "delta_balanced_accuracy":
                b2["balanced_accuracy"]
                - b1["balanced_accuracy"],
            "delta_auc":
                b2["auc"] - b1["auc"],
            "delta_f1":
                b2["f1"] - b1["f1"],
            "delta_real_accuracy":
                b2["real_accuracy"]
                - b1["real_accuracy"],
            "delta_fake_accuracy":
                b2["fake_accuracy"]
                - b1["fake_accuracy"],
        },
        {
            "comparison": "B2_minus_B0",
            "delta_accuracy":
                b2["accuracy"] - b0["accuracy"],
            "delta_balanced_accuracy":
                b2["balanced_accuracy"]
                - b0["balanced_accuracy"],
            "delta_auc":
                b2["auc"] - b0["auc"],
            "delta_f1":
                b2["f1"] - b0["f1"],
            "delta_real_accuracy":
                b2["real_accuracy"]
                - b0["real_accuracy"],
            "delta_fake_accuracy":
                b2["fake_accuracy"]
                - b0["fake_accuracy"],
        },
    ]

    # --------------------------------------------------------
    # SAVE
    # --------------------------------------------------------

    all_prediction_rows = []

    for model_name in model_order:
        all_prediction_rows.extend(
            records[model_name]
        )

    predictions_path = (
        args.output_dir
        / "official_demo_predictions.csv"
    )

    summary_path = (
        args.output_dir
        / "official_demo_summary.csv"
    )

    comparison_path = (
        args.output_dir
        / "official_demo_comparison.csv"
    )

    json_path = (
        args.output_dir
        / "official_demo_summary.json"
    )

    errors_path = (
        args.output_dir
        / "official_demo_image_errors.csv"
    )

    b2_error_path = (
        args.output_dir
        / "b2_official_demo_error_candidates.csv"
    )

    protocol_path = (
        args.output_dir
        / "OFFICIAL_DEMO_PROTOCOL.json"
    )

    write_csv(
        predictions_path,
        all_prediction_rows,
    )

    write_csv(
        summary_path,
        summary_rows,
    )

    write_csv(
        comparison_path,
        comparison_rows,
    )

    if image_errors:
        write_csv(
            errors_path,
            image_errors,
        )

    b2_error_candidates = build_b2_error_candidates(
        records["baseline2_njr"]
    )

    if b2_error_candidates:
        write_csv(
            b2_error_path,
            b2_error_candidates,
        )

    json_payload = {
        "benchmark":
            "Official demonstration benchmark",

        "usage":
            "report-only; not used for training or tuning",

        "samples": {
            "real_coco_val2017":
                EXPECTED_REAL,
            "fake_dalle_advanced":
                EXPECTED_FAKE,
            "total":
                EXPECTED_TOTAL,
        },

        "input_preprocessing": (
            "EXIF transpose -> RGB -> "
            "resize to 384x384 with bicubic if needed -> "
            "ToTensor -> ImageNet Normalize"
        ),

        "thresholds":
            FROZEN_THRESHOLDS,

        "metrics": {
            r["model"]: r
            for r in summary_rows
        },

        "comparisons":
            comparison_rows,

        "inference_seconds":
            elapsed,

        "image_errors":
            len(image_errors),
    }

    with json_path.open(
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            json_payload,
            f,
            indent=2,
            ensure_ascii=False,
        )

    protocol = {
        "status":
            "FROZEN_BEFORE_OFFICIAL_DEMO",

        "benchmark_role":
            (
                "Official demonstration/reference benchmark; "
                "report-only"
            ),

        "training_contamination_audit":
            (
                "PASS - no confirmed overlap detected "
                "before evaluation"
            ),

        "models": {
            "baseline0":
                MODEL_NAME,

            "baseline1_checkpoint":
                str(args.b1_checkpoint),

            "baseline2_njr_checkpoint":
                str(args.b2_checkpoint),
        },

        "frozen_thresholds":
            FROZEN_THRESHOLDS,

        "threshold_source":
            (
                "Previous clean validation only. "
                "No threshold selection on official demo."
            ),

        "model_selection":
            (
                "B2-NJR recipe/checkpoint selected before "
                "official demo evaluation."
            ),

        "no_post_demo_tuning":
            True,
    }

    with protocol_path.open(
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            protocol,
            f,
            indent=2,
            ensure_ascii=False,
        )

    # --------------------------------------------------------
    # PRINT FINAL TABLE
    # --------------------------------------------------------

    print()
    print("=" * 120)
    print("OFFICIAL DEMONSTRATION BENCHMARK RESULTS")
    print("=" * 120)

    header = (
        f"{'Model':<18}"
        f"{'Acc':>11}"
        f"{'BAcc':>11}"
        f"{'AUC':>11}"
        f"{'F1':>11}"
        f"{'Real Acc':>12}"
        f"{'Fake Acc':>12}"
    )

    print(header)
    print("-" * len(header))

    display_names = {
        "baseline0": "B0",
        "baseline1": "B1",
        "baseline2_njr": "B2-NJR",
    }

    for row in summary_rows:

        print(
            f"{display_names[row['model']]:<18}"
            f"{row['accuracy']:>11.6f}"
            f"{row['balanced_accuracy']:>11.6f}"
            f"{row['auc']:>11.6f}"
            f"{row['f1']:>11.6f}"
            f"{row['real_accuracy']:>12.6f}"
            f"{row['fake_accuracy']:>12.6f}"
        )

    print()
    print("=" * 120)
    print("B2-NJR vs B1")
    print("=" * 120)
    print(
        "Accuracy delta :",
        f"{b2['accuracy'] - b1['accuracy']:+.6f}"
    )
    print(
        "BAcc delta     :",
        f"{b2['balanced_accuracy'] - b1['balanced_accuracy']:+.6f}"
    )
    print(
        "AUC delta      :",
        f"{b2['auc'] - b1['auc']:+.6f}"
    )
    print(
        "F1 delta       :",
        f"{b2['f1'] - b1['f1']:+.6f}"
    )
    print(
        "Real Acc delta :",
        f"{b2['real_accuracy'] - b1['real_accuracy']:+.6f}"
    )
    print(
        "Fake Acc delta :",
        f"{b2['fake_accuracy'] - b1['fake_accuracy']:+.6f}"
    )

    print()
    print("=" * 120)
    print("EVALUATION COMPLETE")
    print("=" * 120)
    print(
        "Official benchmark was used for REPORTING ONLY."
    )
    print(
        "Do NOT tune model, threshold, checkpoint, or "
        "augmentation recipe based on these results."
    )
    print()
    print("Saved:")
    print(predictions_path)
    print(summary_path)
    print(comparison_path)
    print(json_path)
    print(protocol_path)

    if b2_error_candidates:
        print(b2_error_path)


if __name__ == "__main__":
    main()
