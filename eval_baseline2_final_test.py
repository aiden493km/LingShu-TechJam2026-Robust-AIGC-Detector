import argparse
import csv
import json
import time
import hashlib
from io import BytesIO
from pathlib import Path

import numpy as np
import torch
from torchvision import transforms
from PIL import Image, ImageFile, ImageFilter, ImageEnhance

import models


# ============================================================
# PIL
# ============================================================

ImageFile.LOAD_TRUNCATED_IMAGES = True


# ============================================================
# PORTABLE DEFAULT CONFIG
# ============================================================

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_B2_CHECKPOINT = REPO_ROOT / "checkpoints" / "baseline2_njr_best.pt"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "results" / "final_test"

MODEL_NAME = "OwensLab/commfor-model-384"
IMAGE_SIZE = 384
DEFAULT_BATCH_SIZE = 32

SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp",
    ".bmp", ".tif", ".tiff",
}

CONDITIONS = [
    "clean",

    "jpeg_q90",
    "jpeg_q70",
    "jpeg_q50",
    "jpeg_q30",

    "blur_sigma0.5",
    "blur_sigma1.0",
    "blur_sigma2.0",

    "resize_0.5",
    "resize_0.25",

    "noise_sigma0.02",
    "noise_sigma0.05",
    "noise_sigma0.10",

    "color_jitter_20",
    "center_crop_80",
]


# ============================================================
# CLI
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Final held-out robustness evaluation for TikTok TechJam 2026 "
            "Track 5: B0 pretrained vs B1 clean fine-tuned vs B2-NJR final."
        )
    )

    parser.add_argument(
        "--val-root",
        type=Path,
        required=True,
        help=(
            "Validation split root. Expected SID/WildFake real/fake layout "
            "used by the frozen protocol."
        ),
    )

    parser.add_argument(
        "--test-root",
        type=Path,
        required=True,
        help=(
            "Held-out test split root. Expected SID/WildFake real/fake layout "
            "used by the frozen protocol."
        ),
    )

    parser.add_argument(
        "--b1-checkpoint",
        type=Path,
        required=True,
        help="Path to the frozen Baseline 1 clean fine-tuned checkpoint.",
    )

    parser.add_argument(
        "--b2-checkpoint",
        type=Path,
        default=DEFAULT_B2_CHECKPOINT,
        help=(
            "Path to the frozen B2-NJR checkpoint. "
            "Default: ./checkpoints/baseline2_njr_best.pt"
        ),
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for final-test CSV/JSON outputs.",
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
    )

    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="Inference device. Default: auto.",
    )

    return parser.parse_args()


def resolve_device(device_arg):
    if device_arg == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if device_arg == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError(
                "--device cuda was requested, but CUDA is not available."
            )
        return torch.device("cuda")

    return torch.device("cpu")


# ============================================================
# PREPROCESSING
# ============================================================

NORMALIZE = transforms.Normalize(
    mean=[0.485, 0.456, 0.406],
    std=[0.229, 0.224, 0.225],
)


def preprocess_batch(images):
    tensors = []

    for image in images:
        if image.size != (IMAGE_SIZE, IMAGE_SIZE):
            raise RuntimeError(
                f"Unexpected image size: {image.size}. "
                f"Expected {(IMAGE_SIZE, IMAGE_SIZE)}."
            )

        tensor = transforms.functional.to_tensor(image)
        tensor = NORMALIZE(tensor)
        tensors.append(tensor)

    return torch.stack(tensors, dim=0)


# ============================================================
# DETERMINISTIC RANDOM SEED
# ============================================================

def stable_seed(text):
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], byteorder="little")


# ============================================================
# ROBUSTNESS TRANSFORMS
# Kept aligned with the existing B0/B1 evaluator.
# ============================================================

def jpeg_compression(image, quality):
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    result = Image.open(buffer).convert("RGB")
    result.load()
    return result


def gaussian_blur(image, sigma):
    return image.filter(ImageFilter.GaussianBlur(radius=sigma))


def resize_down_up(image, scale):
    width, height = image.size

    down_width = max(1, int(round(width * scale)))
    down_height = max(1, int(round(height * scale)))

    small = image.resize(
        (down_width, down_height),
        resample=Image.Resampling.BICUBIC,
    )

    return small.resize(
        (width, height),
        resample=Image.Resampling.BICUBIC,
    )


def gaussian_noise(image, sigma, seed):
    array = np.asarray(image, dtype=np.float32) / 255.0

    rng = np.random.default_rng(seed)
    noise = rng.normal(
        loc=0.0,
        scale=sigma,
        size=array.shape,
    ).astype(np.float32)

    noisy = np.clip(array + noise, 0.0, 1.0)
    noisy = (noisy * 255.0).round().astype(np.uint8)

    return Image.fromarray(noisy, mode="RGB")


def color_jitter_20(image, seed):
    rng = np.random.default_rng(seed)

    brightness = rng.uniform(0.8, 1.2)
    contrast = rng.uniform(0.8, 1.2)
    saturation = rng.uniform(0.8, 1.2)

    image = ImageEnhance.Brightness(image).enhance(brightness)
    image = ImageEnhance.Contrast(image).enhance(contrast)
    image = ImageEnhance.Color(image).enhance(saturation)

    return image


def center_crop_80(image):
    width, height = image.size

    crop_width = max(1, int(round(width * 0.8)))
    crop_height = max(1, int(round(height * 0.8)))

    left = (width - crop_width) // 2
    top = (height - crop_height) // 2

    cropped = image.crop(
        (
            left,
            top,
            left + crop_width,
            top + crop_height,
        )
    )

    return cropped.resize(
        (width, height),
        resample=Image.Resampling.BICUBIC,
    )


def apply_condition(image, condition, image_path):
    if condition == "clean":
        return image

    if condition.startswith("jpeg_q"):
        quality = int(condition.replace("jpeg_q", ""))
        return jpeg_compression(image, quality)

    if condition.startswith("blur_sigma"):
        sigma = float(condition.replace("blur_sigma", ""))
        return gaussian_blur(image, sigma)

    if condition.startswith("resize_"):
        scale = float(condition.replace("resize_", ""))
        return resize_down_up(image, scale)

    if condition.startswith("noise_sigma"):
        sigma = float(condition.replace("noise_sigma", ""))
        seed = stable_seed(f"{image_path}|{condition}")
        return gaussian_noise(image, sigma, seed)

    if condition == "color_jitter_20":
        seed = stable_seed(f"{image_path}|{condition}")
        return color_jitter_20(image, seed)

    if condition == "center_crop_80":
        return center_crop_80(image)

    raise ValueError(f"Unknown condition: {condition}")


# ============================================================
# DATA
# ============================================================

def collect_images(data_root):
    items = []

    for dataset_name in ["sid", "wildfake"]:
        for class_name, label in [("real", 0), ("fake", 1)]:
            folder = data_root / dataset_name / class_name

            if not folder.exists():
                print("[WARNING] Missing:", folder)
                continue

            paths = sorted(
                p
                for p in folder.rglob("*")
                if p.is_file()
                and p.suffix.lower() in SUPPORTED_EXTENSIONS
            )

            print(
                f"{dataset_name:10s}{class_name:6s}: "
                f"{len(paths)}"
            )

            for path in paths:
                items.append(
                    {
                        "path": path,
                        "dataset": dataset_name,
                        "label_name": class_name,
                        "label": label,
                    }
                )

    return items


# ============================================================
# AUC
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
        sum_pos_ranks - n_pos * (n_pos + 1) / 2
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

    accuracy = (tp + tn) / total if total > 0 else 0.0

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

    real_acc = (
        tn / (tn + fp)
        if (tn + fp) > 0
        else 0.0
    )

    fake_acc = (
        tp / (tp + fn)
        if (tp + fn) > 0
        else 0.0
    )

    balanced_acc = (real_acc + fake_acc) / 2.0
    auc = binary_auc(y_true, y_score)

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
        "samples": total,
        "threshold": float(threshold),
        "accuracy": float(accuracy),
        "balanced_accuracy": float(balanced_acc),
        "auc": float(auc),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "real_accuracy": float(real_acc),
        "fake_accuracy": float(fake_acc),
        "mean_prob_real": mean_prob_real,
        "mean_prob_fake": mean_prob_fake,
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
    }


# ============================================================
# CLEAN THRESHOLD CALIBRATION
# Clean validation ONLY.
# Objective: balanced accuracy.
# Tie-break: accuracy -> F1.
# ============================================================

def calibrate_threshold(records):
    labels = np.asarray(
        [r["label"] for r in records],
        dtype=np.int64,
    )

    probs = np.asarray(
        [r["aigc_probability"] for r in records],
        dtype=np.float64,
    )

    unique_probs = np.unique(probs)

    if len(unique_probs) > 1:
        midpoints = (unique_probs[:-1] + unique_probs[1:]) / 2.0
        thresholds = np.unique(
            np.concatenate(
                [
                    unique_probs,
                    midpoints,
                    np.asarray([0.5], dtype=np.float64),
                ]
            )
        )
    else:
        thresholds = np.asarray([0.5], dtype=np.float64)

    best = None

    for threshold in thresholds:
        metrics = calculate_metrics(records, float(threshold))

        candidate = {
            "threshold": float(threshold),
            "balanced_accuracy": metrics["balanced_accuracy"],
            "accuracy": metrics["accuracy"],
            "f1": metrics["f1"],
            "real_recall": metrics["real_accuracy"],
            "fake_recall": metrics["fake_accuracy"],
        }

        if best is None:
            best = candidate
            continue

        current_key = (
            candidate["balanced_accuracy"],
            candidate["accuracy"],
            candidate["f1"],
        )

        best_key = (
            best["balanced_accuracy"],
            best["accuracy"],
            best["f1"],
        )

        if current_key > best_key:
            best = candidate

    return best


# ============================================================
# MODEL LOADING
# ============================================================

def load_checkpoint_model(checkpoint, device, label):
    if not checkpoint.exists():
        raise FileNotFoundError(
            f"\n{label} checkpoint not found:\n{checkpoint}"
        )

    # B1/B2 checkpoints contain the full model state. Build the architecture
    # locally instead of downloading pretrained weights.
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
    print("=" * 90)
    print("LOADING MODELS")
    print("=" * 90)

    print("Baseline 1:")
    print(b1_checkpoint)
    baseline1 = load_checkpoint_model(
        b1_checkpoint,
        device,
        "Baseline 1",
    )
    print("Baseline 1 loaded.")

    print()
    print("B2-N:")
    print(b2_checkpoint)
    b2_noise = load_checkpoint_model(
        b2_checkpoint,
        device,
        "B2-N",
    )
    print("B2-N loaded.")

    return {
        "baseline1": baseline1,
        "b2_noise": b2_noise,
    }


# ============================================================
# EVALUATE ONE CONDITION FOR ALL MODELS
# One transformed tensor is shared by all models.
# ============================================================

def evaluate_condition(
    condition,
    items,
    model_dict,
    device,
    batch_size,
):
    print()
    print("=" * 90)
    print("CONDITION:", condition)
    print("=" * 90)

    records = {
        model_name: []
        for model_name in model_dict
    }

    start_time = time.time()
    total_batches = (
        len(items) + batch_size - 1
    ) // batch_size

    with torch.inference_mode():
        for start_idx in range(0, len(items), batch_size):
            batch_items = items[start_idx:start_idx + batch_size]

            images = []
            valid_items = []

            for item in batch_items:
                try:
                    with Image.open(item["path"]) as img:
                        original = img.convert("RGB")

                    if original.size != (IMAGE_SIZE, IMAGE_SIZE):
                        raise RuntimeError(
                            f"Image is {original.size}, expected "
                            f"{IMAGE_SIZE}x{IMAGE_SIZE}"
                        )

                    transformed = apply_condition(
                        original,
                        condition,
                        str(item["path"]),
                    )

                    images.append(transformed)
                    valid_items.append(item)

                except Exception as e:
                    print("[ERROR]", item["path"], e)

            if not images:
                continue

            pixel_values = preprocess_batch(images).to(
                device,
                non_blocking=True,
            )

            for model_name, model in model_dict.items():
                logits = model(pixel_values).reshape(-1)
                probs = torch.sigmoid(logits).cpu().numpy()

                for item, prob in zip(valid_items, probs):
                    records[model_name].append(
                        {
                            "model": model_name,
                            "condition": condition,
                            "path": str(item["path"]),
                            "dataset": item["dataset"],
                            "label_name": item["label_name"],
                            "label": item["label"],
                            "aigc_probability": float(prob),
                        }
                    )

            batch_num = start_idx // batch_size + 1

            if batch_num % 20 == 0 or batch_num == total_batches:
                print(
                    f"[{batch_num:3d}/{total_batches}] "
                    f"{len(valid_items)} current batch"
                )

    elapsed = time.time() - start_time
    print(f"Time: {elapsed:.2f}s")

    return records


# ============================================================
# DATASET SUBSET
# ============================================================

def select_subset(records, dataset_name):
    if dataset_name == "SID":
        return [r for r in records if r["dataset"] == "sid"]

    if dataset_name == "WildFake":
        return [r for r in records if r["dataset"] == "wildfake"]

    return records


# ============================================================
# SAVE CSV
# ============================================================

def write_csv(path, rows):
    if not rows:
        return

    with open(
        path,
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
# MAIN
# ============================================================



# ============================================================
# FINAL TEST PROTOCOL
# ============================================================

# These thresholds were already selected using CLEAN validation only
# before opening the held-out test set.
FROZEN_B1_THRESHOLD = 0.59710413
FROZEN_B2_THRESHOLD = 0.55657113

# Recalibration on clean validation is used ONLY as a consistency check.
THRESHOLD_TOLERANCE = 1e-6


def load_pretrained_b0(device):
    model = models.ViTClassifier.from_pretrained(MODEL_NAME)
    model = model.to(device)
    model.eval()
    return model


def aggregate_for_model(summary_rows, model_name):
    combined_rows = [
        row
        for row in summary_rows
        if (
            row["model"] == model_name
            and row["dataset"] == "Combined"
        )
    ]

    clean_row = next(
        row
        for row in combined_rows
        if row["condition"] == "clean"
    )

    transformed_rows = [
        row
        for row in combined_rows
        if row["condition"] != "clean"
    ]

    acc_values = np.asarray(
        [row["accuracy"] for row in transformed_rows],
        dtype=np.float64,
    )

    bacc_values = np.asarray(
        [row["balanced_accuracy"] for row in transformed_rows],
        dtype=np.float64,
    )

    auc_values = np.asarray(
        [row["auc"] for row in transformed_rows],
        dtype=np.float64,
    )

    f1_values = np.asarray(
        [row["f1"] for row in transformed_rows],
        dtype=np.float64,
    )

    worst_acc_idx = int(np.argmin(acc_values))
    worst_auc_idx = int(np.argmin(auc_values))

    return {
        "threshold":
            clean_row["threshold"],

        "clean_accuracy":
            clean_row["accuracy"],

        "clean_balanced_accuracy":
            clean_row["balanced_accuracy"],

        "clean_auc":
            clean_row["auc"],

        "clean_f1":
            clean_row["f1"],

        "mean_robust_accuracy":
            float(np.mean(acc_values)),

        "mean_robust_balanced_accuracy":
            float(np.mean(bacc_values)),

        "mean_robust_auc":
            float(np.mean(auc_values)),

        "mean_robust_f1":
            float(np.mean(f1_values)),

        "worst_robust_accuracy":
            float(np.min(acc_values)),

        "worst_accuracy_condition":
            transformed_rows[worst_acc_idx]["condition"],

        "worst_robust_auc":
            float(np.min(auc_values)),

        "worst_auc_condition":
            transformed_rows[worst_auc_idx]["condition"],
    }


def main():
    args = parse_args()

    val_root = args.val_root.resolve()
    test_root = args.test_root.resolve()
    b1_checkpoint = args.b1_checkpoint.resolve()
    b2_checkpoint = args.b2_checkpoint.resolve()
    output_dir = args.output_dir.resolve()
    batch_size = args.batch_size
    device = resolve_device(args.device)

    if batch_size < 1:
        raise ValueError("--batch-size must be >= 1.")

    print("=" * 128)
    print("TRACK 5 - BASELINE 2 FINAL HELD-OUT TEST EVALUATION")
    print("B0 PRETRAINED vs B1 CLEAN-FT vs B2-NJR FINAL")
    print("=" * 128)

    print("Device              :", device)

    if device.type == "cuda":
        print(
            "GPU                 :",
            torch.cuda.get_device_name(0),
        )

    print("Validation root     :", val_root)
    print("Held-out test root  :", test_root)
    print("B1 checkpoint       :", b1_checkpoint)
    print("B2-NJR checkpoint   :", b2_checkpoint)
    print("Output              :", output_dir)
    print("Frozen B1 threshold :", f"{FROZEN_B1_THRESHOLD:.8f}")
    print("Frozen B2 threshold :", f"{FROZEN_B2_THRESHOLD:.8f}")
    print("Batch size          :", batch_size)
    print("=" * 128)

    # --------------------------------------------------------
    # PATH CHECKS
    # --------------------------------------------------------

    for path, label in [
        (val_root, "Validation root"),
        (test_root, "Test root"),
        (b1_checkpoint, "B1 checkpoint"),
        (b2_checkpoint, "B2 checkpoint"),
    ]:
        if not path.exists():
            raise FileNotFoundError(
                f"{label} does not exist:\n{path}"
            )

    # ========================================================
    # LOAD MODELS
    # ========================================================

    print()
    print("=" * 100)
    print("LOADING FROZEN MODELS")
    print("=" * 100)

    print("B0 pretrained:")
    print(MODEL_NAME)
    b0 = load_pretrained_b0(device)
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

    model_dict = {
        "baseline0": b0,
        "baseline1": b1,
        "baseline2_njr": b2,
    }

    model_order = [
        "baseline0",
        "baseline1",
        "baseline2_njr",
    ]

    # ========================================================
    # STEP 1: CLEAN VALIDATION ONLY
    #
    # B0 threshold is calibrated here.
    # B1/B2 thresholds are already frozen and are only
    # verified for exact pipeline consistency.
    # ========================================================

    print()
    print("=" * 128)
    print("PHASE 1 - CLEAN VALIDATION THRESHOLD LOCK / CONSISTENCY CHECK")
    print("NO TEST IMAGES HAVE BEEN EVALUATED YET.")
    print("=" * 128)

    val_items = collect_images(
        val_root
    )

    print()
    print(
        "Validation images:",
        len(val_items),
    )

    if len(val_items) != 4485:
        raise RuntimeError(
            "Expected exactly 4485 validation images, "
            f"found {len(val_items)}."
        )

    val_clean_records = evaluate_condition(
        condition="clean",
        items=val_items,
        model_dict=model_dict,
        device=device,
        batch_size=batch_size,
    )

    # B0: same clean-validation calibration rule
    b0_cal = calibrate_threshold(
        val_clean_records["baseline0"]
    )
    b0_threshold = b0_cal["threshold"]

    # B1/B2: recalc ONLY to verify the frozen pipeline
    b1_check = calibrate_threshold(
        val_clean_records["baseline1"]
    )

    b2_check = calibrate_threshold(
        val_clean_records["baseline2_njr"]
    )

    print()
    print("=" * 100)
    print("VALIDATION THRESHOLD CHECK")
    print("=" * 100)

    print()
    print("BASELINE 0")
    print(
        "Validation-calibrated threshold:",
        f"{b0_threshold:.8f}",
    )

    print()
    print("BASELINE 1")
    print(
        "Frozen threshold      :",
        f"{FROZEN_B1_THRESHOLD:.8f}",
    )
    print(
        "Recomputed validation :",
        f"{b1_check['threshold']:.8f}",
    )

    print()
    print("BASELINE 2 NJR")
    print(
        "Frozen threshold      :",
        f"{FROZEN_B2_THRESHOLD:.8f}",
    )
    print(
        "Recomputed validation :",
        f"{b2_check['threshold']:.8f}",
    )

    if abs(
        b1_check["threshold"]
        - FROZEN_B1_THRESHOLD
    ) > THRESHOLD_TOLERANCE:
        raise RuntimeError(
            "\nB1 threshold consistency check FAILED.\n"
            f"Frozen    : {FROZEN_B1_THRESHOLD:.8f}\n"
            f"Recomputed: {b1_check['threshold']:.8f}\n"
            "STOPPING BEFORE TEST evaluation."
        )

    if abs(
        b2_check["threshold"]
        - FROZEN_B2_THRESHOLD
    ) > THRESHOLD_TOLERANCE:
        raise RuntimeError(
            "\nB2 threshold consistency check FAILED.\n"
            f"Frozen    : {FROZEN_B2_THRESHOLD:.8f}\n"
            f"Recomputed: {b2_check['threshold']:.8f}\n"
            "STOPPING BEFORE TEST evaluation."
        )

    thresholds = {
        "baseline0": b0_threshold,
        "baseline1": FROZEN_B1_THRESHOLD,
        "baseline2_njr": FROZEN_B2_THRESHOLD,
    }

    print()
    print(
        "Threshold consistency checks PASSED."
    )
    print(
        "All thresholds are now LOCKED."
    )
    print(
        "Starting held-out TEST evaluation."
    )

    # Drop validation records from active references.
    del val_clean_records
    del val_items

    # ========================================================
    # STEP 2: HELD-OUT TEST
    # ========================================================

    print()
    print("=" * 128)
    print("PHASE 2 - HELD-OUT TEST")
    print("TEST IS REPORT-ONLY: NO MODEL / THRESHOLD / AUGMENTATION TUNING.")
    print("=" * 128)

    test_items = collect_images(
        test_root
    )

    print()
    print(
        "Total held-out test images:",
        len(test_items),
    )

    if len(test_items) != 4485:
        raise RuntimeError(
            "Expected exactly 4485 test images, "
            f"found {len(test_items)}."
        )

    condition_records = {}

    for condition in CONDITIONS:
        condition_records[
            condition
        ] = evaluate_condition(
            condition=condition,
            items=test_items,
            model_dict=model_dict,
            device=device,
            batch_size=batch_size,
        )

    # ========================================================
    # TEST METRICS
    # ========================================================

    all_prediction_rows = []
    summary_rows = []

    for model_name in model_order:

        threshold = thresholds[
            model_name
        ]

        for condition in CONDITIONS:

            records = condition_records[
                condition
            ][model_name]

            for record in records:

                score = record[
                    "aigc_probability"
                ]

                pred = int(
                    score >= threshold
                )

                new_record = dict(
                    record
                )

                new_record[
                    "threshold"
                ] = threshold

                new_record[
                    "pred"
                ] = pred

                new_record[
                    "pred_name"
                ] = (
                    "fake"
                    if pred == 1
                    else "real"
                )

                new_record[
                    "correct"
                ] = int(
                    pred
                    ==
                    record["label"]
                )

                all_prediction_rows.append(
                    new_record
                )

            for dataset_name in [
                "SID",
                "WildFake",
                "Combined",
            ]:

                subset = select_subset(
                    records,
                    dataset_name,
                )

                metrics = calculate_metrics(
                    subset,
                    threshold,
                )

                summary_rows.append(
                    {
                        "model":
                            model_name,

                        "condition":
                            condition,

                        "dataset":
                            dataset_name,

                        **metrics,
                    }
                )

    def combined_row(
        model_name,
        condition,
    ):
        return next(
            row
            for row in summary_rows
            if (
                row["model"]
                == model_name
                and
                row["condition"]
                == condition
                and
                row["dataset"]
                == "Combined"
            )
        )

    # ========================================================
    # COMPARISON TABLE
    # ========================================================

    comparison_rows = []

    for condition in CONDITIONS:

        b0_row = combined_row(
            "baseline0",
            condition,
        )

        b1_row = combined_row(
            "baseline1",
            condition,
        )

        b2_row = combined_row(
            "baseline2_njr",
            condition,
        )

        comparison_rows.append(
            {
                "condition":
                    condition,

                "b0_accuracy":
                    b0_row["accuracy"],

                "b1_accuracy":
                    b1_row["accuracy"],

                "b2_accuracy":
                    b2_row["accuracy"],

                "delta_b1_vs_b0_accuracy":
                    b1_row["accuracy"]
                    - b0_row["accuracy"],

                "delta_b2_vs_b1_accuracy":
                    b2_row["accuracy"]
                    - b1_row["accuracy"],

                "delta_b2_vs_b0_accuracy":
                    b2_row["accuracy"]
                    - b0_row["accuracy"],

                "b0_balanced_accuracy":
                    b0_row["balanced_accuracy"],

                "b1_balanced_accuracy":
                    b1_row["balanced_accuracy"],

                "b2_balanced_accuracy":
                    b2_row["balanced_accuracy"],

                "b0_auc":
                    b0_row["auc"],

                "b1_auc":
                    b1_row["auc"],

                "b2_auc":
                    b2_row["auc"],

                "delta_b1_vs_b0_auc":
                    b1_row["auc"]
                    - b0_row["auc"],

                "delta_b2_vs_b1_auc":
                    b2_row["auc"]
                    - b1_row["auc"],

                "delta_b2_vs_b0_auc":
                    b2_row["auc"]
                    - b0_row["auc"],

                "b0_f1":
                    b0_row["f1"],

                "b1_f1":
                    b1_row["f1"],

                "b2_f1":
                    b2_row["f1"],

                "b0_real_accuracy":
                    b0_row["real_accuracy"],

                "b1_real_accuracy":
                    b1_row["real_accuracy"],

                "b2_real_accuracy":
                    b2_row["real_accuracy"],

                "b0_fake_accuracy":
                    b0_row["fake_accuracy"],

                "b1_fake_accuracy":
                    b1_row["fake_accuracy"],

                "b2_fake_accuracy":
                    b2_row["fake_accuracy"],
            }
        )

    # ========================================================
    # AGGREGATE TEST ROBUSTNESS
    # ========================================================

    aggregate = {
        model_name:
            aggregate_for_model(
                summary_rows,
                model_name,
            )
        for model_name
        in model_order
    }

    def aggregate_delta(
        new_name,
        old_name,
    ):

        new = aggregate[
            new_name
        ]

        old = aggregate[
            old_name
        ]

        return {
            "delta_clean_accuracy":
                new["clean_accuracy"]
                - old["clean_accuracy"],

            "delta_clean_auc":
                new["clean_auc"]
                - old["clean_auc"],

            "delta_mean_robust_accuracy":
                new["mean_robust_accuracy"]
                - old["mean_robust_accuracy"],

            "delta_mean_robust_balanced_accuracy":
                new["mean_robust_balanced_accuracy"]
                - old["mean_robust_balanced_accuracy"],

            "delta_mean_robust_auc":
                new["mean_robust_auc"]
                - old["mean_robust_auc"],

            "delta_mean_robust_f1":
                new["mean_robust_f1"]
                - old["mean_robust_f1"],

            "delta_worst_robust_accuracy":
                new["worst_robust_accuracy"]
                - old["worst_robust_accuracy"],

            "delta_worst_robust_auc":
                new["worst_robust_auc"]
                - old["worst_robust_auc"],
        }

    delta_b1_vs_b0 = aggregate_delta(
        "baseline1",
        "baseline0",
    )

    delta_b2_vs_b1 = aggregate_delta(
        "baseline2_njr",
        "baseline1",
    )

    delta_b2_vs_b0 = aggregate_delta(
        "baseline2_njr",
        "baseline0",
    )

    # ========================================================
    # SAVE FINAL ARTIFACTS
    # ========================================================

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    predictions_path = (
        output_dir
        / "final_test_predictions.csv"
    )

    summary_path = (
        output_dir
        / "final_test_summary.csv"
    )

    comparison_path = (
        output_dir
        / "b0_b1_b2_final_test_comparison.csv"
    )

    json_path = (
        output_dir
        / "final_test_summary.json"
    )

    frozen_protocol_path = (
        output_dir
        / "FROZEN_PROTOCOL.json"
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

    frozen_protocol = {
        "status":
            "FROZEN_BEFORE_TEST",

        "model":
            "B2-NJR",

        "model_name":
            MODEL_NAME,

        "checkpoint":
            str(
                b2_checkpoint
            ),

        "checkpoint_selection":
            (
                "best clean validation AUC; "
                "epoch 4"
            ),

        "augmentations": [
            "gaussian_noise",
            "jpeg",
            "resize",
        ],

        "excluded_from_final_recipe": [
            "gaussian_blur",
        ],

        "frozen_threshold":
            FROZEN_B2_THRESHOLD,

        "threshold_selection":
            (
                "clean validation only; "
                "maximize balanced accuracy; "
                "tie-break accuracy then F1"
            ),

        "test_policy":
            (
                "held-out test used once for final "
                "reporting only; no tuning"
            ),
    }

    with open(
        frozen_protocol_path,
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            frozen_protocol,
            f,
            indent=2,
            ensure_ascii=False,
        )

    with open(
        json_path,
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            {
                "split":
                    "held_out_test",

                "test_samples":
                    len(test_items),

                "input_size":
                    IMAGE_SIZE,

                "conditions":
                    CONDITIONS,

                "threshold_source":
                    "clean validation only",

                "thresholds":
                    thresholds,

                "b0_validation_calibration":
                    b0_cal,

                "frozen_b1_threshold":
                    FROZEN_B1_THRESHOLD,

                "frozen_b2_threshold":
                    FROZEN_B2_THRESHOLD,

                "baseline1_checkpoint":
                    str(
                        b1_checkpoint
                    ),

                "baseline2_checkpoint":
                    str(
                        b2_checkpoint
                    ),

                "aggregate":
                    aggregate,

                "delta_b1_vs_b0":
                    delta_b1_vs_b0,

                "delta_b2_vs_b1":
                    delta_b2_vs_b1,

                "delta_b2_vs_b0":
                    delta_b2_vs_b0,

                "comparison":
                    comparison_rows,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    # ========================================================
    # PRINT FINAL TABLE
    # ========================================================

    print()
    print("=" * 144)

    print(
        f"{'Condition':22s}"
        f"{'B0 Acc':>10s}"
        f"{'B1 Acc':>10s}"
        f"{'B2 Acc':>10s}"
        f"{'B2-B1':>10s}"
        f"{'B0 AUC':>10s}"
        f"{'B1 AUC':>10s}"
        f"{'B2 AUC':>10s}"
        f"{'B2-B1':>10s}"
    )

    print("-" * 144)

    for row in comparison_rows:

        print(
            f"{row['condition']:22s}"
            f"{row['b0_accuracy']:10.4f}"
            f"{row['b1_accuracy']:10.4f}"
            f"{row['b2_accuracy']:10.4f}"
            f"{row['delta_b2_vs_b1_accuracy']:+10.4f}"
            f"{row['b0_auc']:10.4f}"
            f"{row['b1_auc']:10.4f}"
            f"{row['b2_auc']:10.4f}"
            f"{row['delta_b2_vs_b1_auc']:+10.4f}"
        )

    print("=" * 144)

    # ========================================================
    # HARD CONDITIONS
    # ========================================================

    print()
    print("=" * 128)
    print("FINAL HARD-CONDITION TEST RESULTS")
    print("=" * 128)

    for condition in [
        "noise_sigma0.10",
        "jpeg_q30",
        "resize_0.25",
        "blur_sigma2.0",
    ]:

        row = next(
            r
            for r in comparison_rows
            if r["condition"] == condition
        )

        print(
            f"{condition:20s} | "
            f"Acc B0/B1/B2 = "
            f"{row['b0_accuracy']:.4f} / "
            f"{row['b1_accuracy']:.4f} / "
            f"{row['b2_accuracy']:.4f}"
            f" | AUC B0/B1/B2 = "
            f"{row['b0_auc']:.4f} / "
            f"{row['b1_auc']:.4f} / "
            f"{row['b2_auc']:.4f}"
        )

    # ========================================================
    # AGGREGATE
    # ========================================================

    print()
    print("=" * 128)
    print("FINAL HELD-OUT TEST AGGREGATE")
    print("=" * 128)

    for model_name in model_order:

        s = aggregate[
            model_name
        ]

        print()
        print(
            model_name.upper()
        )

        print(
            "Threshold                  :",
            f"{s['threshold']:.8f}",
        )

        print(
            "Clean Accuracy             :",
            f"{s['clean_accuracy']:.6f}",
        )

        print(
            "Clean AUC                  :",
            f"{s['clean_auc']:.6f}",
        )

        print(
            "Mean Robust Accuracy       :",
            f"{s['mean_robust_accuracy']:.6f}",
        )

        print(
            "Mean Robust Balanced Acc   :",
            f"{s['mean_robust_balanced_accuracy']:.6f}",
        )

        print(
            "Mean Robust AUC            :",
            f"{s['mean_robust_auc']:.6f}",
        )

        print(
            "Worst Robust Accuracy      :",
            f"{s['worst_robust_accuracy']:.6f}",
        )

        print(
            "Worst Accuracy Condition   :",
            s[
                "worst_accuracy_condition"
            ],
        )

        print(
            "Worst Robust AUC           :",
            f"{s['worst_robust_auc']:.6f}",
        )

        print(
            "Worst AUC Condition        :",
            s[
                "worst_auc_condition"
            ],
        )

    print()
    print("=" * 128)
    print("FINAL B2 - B1 TEST DELTA")
    print("=" * 128)

    for key, value in delta_b2_vs_b1.items():

        print(
            f"{key:38s}: "
            f"{value:+.6f}"
        )

    print()
    print("=" * 128)
    print("FINAL B2 - B0 TEST DELTA")
    print("=" * 128)

    for key, value in delta_b2_vs_b0.items():

        print(
            f"{key:38s}: "
            f"{value:+.6f}"
        )

    print()
    print("=" * 128)
    print("SAVED")
    print("=" * 128)

    print(predictions_path)
    print(summary_path)
    print(comparison_path)
    print(json_path)
    print(frozen_protocol_path)

    print()
    print("=" * 128)
    print("BASELINE 2 FINAL TEST EVALUATION COMPLETED")
    print("MODEL / THRESHOLD / RECIPE ARE FROZEN.")
    print("DO NOT TUNE USING THESE TEST RESULTS.")
    print("=" * 128)


if __name__ == "__main__":
    main()
