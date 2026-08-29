#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
TikTok TechJam 2026 Track 5
Final Inference Script

Requirement:
    Input : an image directory
    Output: a JSON file containing, for each image:
            {
              "image_path": "...",
              "pred": 0.987654
            }

`pred` is the confidence/probability that the image is AI-generated (AIGC).
Range: [0, 1]

Final model:
    Community Forensics ViT-S/16
    Base: OwensLab/commfor-model-384
    Fine-tuning: Gaussian Noise + JPEG + Resize (B2-NJR)

Frozen decision threshold:
    0.55657113

Important:
- The JSON `pred` field is the AIGC confidence score, NOT a hard 0/1 label.
- The frozen threshold is only used for optional console summary.
- No threshold calibration or model tuning is performed here.

Example:
python inference.py --input ./demo_images --output ./predictions.json \
  --checkpoint ./checkpoints/baseline2_njr_best.pt
"""

import argparse
import json
import sys
import time
from pathlib import Path

import torch
from PIL import Image, ImageFile, ImageOps
from torchvision import transforms

import models


# ============================================================
# CONFIG
# ============================================================

MODEL_NAME = "OwensLab/commfor-model-384"
IMAGE_SIZE = 384

# Frozen on clean validation only.
FROZEN_THRESHOLD = 0.55657113

SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
}

# Portable repository default.
# Recommended GitHub layout:
#
# project/
# ├── inference.py
# ├── models/
# └── checkpoints/
#     └── baseline2_njr_best.pt
#
DEFAULT_CHECKPOINT = (
    Path(__file__).resolve().parent
    / "checkpoints"
    / "baseline2_njr_best.pt"
)

ImageFile.LOAD_TRUNCATED_IMAGES = True


# ============================================================
# CLI
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Run the frozen Track 5 B2-NJR detector on an image directory "
            "and export AIGC confidence scores to JSON."
        )
    )

    parser.add_argument(
        "--input",
        required=True,
        type=Path,
        help="Input image directory.",
    )

    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Output JSON path.",
    )

    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=DEFAULT_CHECKPOINT,
        help=(
            "Path to the frozen B2-NJR checkpoint. "
            "Default: checkpoints/baseline2_njr_best.pt"
        ),
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Inference batch size. Default: 32.",
    )

    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="Inference device. Default: auto.",
    )

    parser.add_argument(
        "--absolute-paths",
        action="store_true",
        help=(
            "Write absolute image paths to JSON. "
            "By default paths are relative to the input directory."
        ),
    )

    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON with indentation.",
    )

    return parser.parse_args()


# ============================================================
# IMAGE PREPROCESSING
# ============================================================

NORMALIZE = transforms.Normalize(
    mean=[0.485, 0.456, 0.406],
    std=[0.229, 0.224, 0.225],
)


def preprocess_image(path: Path) -> torch.Tensor:
    """
    Preprocessing aligned with the final evaluation pipeline:
        EXIF transpose
        -> RGB
        -> 384x384 bicubic resize
        -> ToTensor
        -> ImageNet Normalize
    """
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")

        if image.size != (IMAGE_SIZE, IMAGE_SIZE):
            image = image.resize(
                (IMAGE_SIZE, IMAGE_SIZE),
                resample=Image.Resampling.BICUBIC,
            )

        tensor = transforms.functional.to_tensor(image)
        tensor = NORMALIZE(tensor)

    return tensor


# ============================================================
# INPUT DISCOVERY
# ============================================================

def collect_images(root: Path):
    """
    Recursively discover supported image files.
    """
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )


# ============================================================
# MODEL
# ============================================================

def load_model(checkpoint: Path, device: torch.device):
    if not checkpoint.exists():
        raise FileNotFoundError(
            "\nFrozen model checkpoint was not found:\n"
            f"{checkpoint}\n\n"
            "Pass it explicitly with:\n"
            '--checkpoint "PATH_TO_CHECKPOINT"'
        )

    print("Building local model architecture:")
    print("  Community Forensics ViT-S/16, 384x384")
    print("  Network access required: no")

    # IMPORTANT:
    # Build architecture only. The frozen B2-NJR checkpoint contains the
    # complete model state, so inference does not need Hugging Face or timm
    # to download pretrained weights.
    model = models.ViTClassifier(
        model_size="small",
        input_size=IMAGE_SIZE,
        patch_size=16,
        device="cpu",
        pretrained_backbone=False,
    )

    print("Loading frozen B2-NJR checkpoint:")
    print(f"  {checkpoint}")

    state_dict = torch.load(
        checkpoint,
        map_location="cpu",
        weights_only=True,
    )

    model.load_state_dict(
        state_dict,
        strict=True,
    )

    model = model.to(device)
    model.eval()

    return model


# ============================================================
# DEVICE
# ============================================================

def resolve_device(device_arg: str):
    if device_arg == "cpu":
        return torch.device("cpu")

    if device_arg == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError(
                "--device cuda was requested, but CUDA is not available."
            )
        return torch.device("cuda")

    # auto
    return torch.device(
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )


# ============================================================
# INFERENCE
# ============================================================

def run_inference(
    model,
    image_paths,
    input_root: Path,
    device: torch.device,
    batch_size: int,
    absolute_paths: bool,
):
    predictions = []
    failures = []

    total = len(image_paths)
    total_batches = (total + batch_size - 1) // batch_size

    start_time = time.time()

    with torch.inference_mode():

        for batch_index, start in enumerate(
            range(0, total, batch_size),
            start=1,
        ):
            current_paths = image_paths[
                start:start + batch_size
            ]

            tensors = []
            valid_paths = []

            for path in current_paths:
                try:
                    tensor = preprocess_image(path)
                    tensors.append(tensor)
                    valid_paths.append(path)

                except Exception as exc:
                    failures.append(
                        {
                            "image_path": str(path),
                            "error": repr(exc),
                        }
                    )

                    print(
                        f"[WARNING] Failed to read: {path}\n"
                        f"          {repr(exc)}",
                        file=sys.stderr,
                    )

            if tensors:
                batch = torch.stack(
                    tensors,
                    dim=0,
                ).to(
                    device,
                    non_blocking=True,
                )

                logits = model(batch).reshape(-1)

                probabilities = torch.sigmoid(
                    logits
                ).detach().cpu().numpy()

                for path, probability in zip(
                    valid_paths,
                    probabilities,
                ):
                    if absolute_paths:
                        output_path = str(
                            path.resolve()
                        )
                    else:
                        output_path = str(
                            path.relative_to(input_root)
                        ).replace("\\", "/")

                    predictions.append(
                        {
                            "image_path": output_path,
                            "pred": float(probability),
                        }
                    )

            if (
                batch_index % 10 == 0
                or batch_index == total_batches
            ):
                processed = min(
                    start + batch_size,
                    total,
                )

                print(
                    f"[{batch_index:>4}/{total_batches}] "
                    f"{processed}/{total} images"
                )

    elapsed = time.time() - start_time

    return predictions, failures, elapsed


# ============================================================
# SAVE
# ============================================================

def save_json(path: Path, predictions, pretty: bool):
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with path.open(
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            predictions,
            f,
            ensure_ascii=False,
            indent=2 if pretty else None,
        )


# ============================================================
# SUMMARY
# ============================================================

def print_summary(
    predictions,
    failures,
    elapsed,
    device,
    output_path,
):
    scores = [
        row["pred"]
        for row in predictions
    ]

    predicted_fake = sum(
        score >= FROZEN_THRESHOLD
        for score in scores
    )

    predicted_real = (
        len(scores) - predicted_fake
    )

    print()
    print("=" * 90)
    print("INFERENCE COMPLETE")
    print("=" * 90)
    print(
        f"Successful images     : {len(predictions)}"
    )
    print(
        f"Failed images         : {len(failures)}"
    )
    print(
        f"Frozen threshold      : {FROZEN_THRESHOLD:.8f}"
    )
    print(
        f"Predicted Real        : {predicted_real}"
    )
    print(
        f"Predicted AIGC        : {predicted_fake}"
    )
    print(
        f"Inference time        : {elapsed:.2f} s"
    )

    if predictions:
        print(
            f"Average time / image  : "
            f"{elapsed / len(predictions) * 1000:.2f} ms"
        )

    print(
        f"Device                : {device}"
    )

    if (
        device.type == "cuda"
        and torch.cuda.is_available()
    ):
        print(
            f"GPU                   : "
            f"{torch.cuda.get_device_name(0)}"
        )

    print(
        f"Output JSON           : {output_path}"
    )

    print()
    print(
        "JSON field `pred` = probability that the image is AIGC-generated."
    )

    print("=" * 90)


# ============================================================
# MAIN
# ============================================================

def main():
    args = parse_args()

    if not args.input.exists():
        raise FileNotFoundError(
            f"Input directory does not exist:\n{args.input}"
        )

    if not args.input.is_dir():
        raise NotADirectoryError(
            f"--input must be a directory:\n{args.input}"
        )

    if args.batch_size <= 0:
        raise ValueError(
            "--batch-size must be greater than 0."
        )

    input_root = args.input.resolve()
    checkpoint = args.checkpoint.resolve()
    output_path = args.output.resolve()

    image_paths = collect_images(
        input_root
    )

    if not image_paths:
        raise RuntimeError(
            f"No supported images found under:\n{input_root}"
        )

    device = resolve_device(
        args.device
    )

    print("=" * 90)
    print("TIKTOK TECHJAM 2026 TRACK 5")
    print("ROBUST AIGC IMAGE DETECTOR - FINAL INFERENCE")
    print("=" * 90)
    print(
        f"Input directory       : {input_root}"
    )
    print(
        f"Images found          : {len(image_paths)}"
    )
    print(
        f"Checkpoint            : {checkpoint}"
    )
    print(
        f"Output JSON           : {output_path}"
    )
    print(
        f"Batch size            : {args.batch_size}"
    )
    print(
        f"Device                : {device}"
    )
    print(
        f"Frozen threshold      : {FROZEN_THRESHOLD:.8f}"
    )

    if (
        device.type == "cuda"
        and torch.cuda.is_available()
    ):
        print(
            f"GPU                   : "
            f"{torch.cuda.get_device_name(0)}"
        )

    print("=" * 90)

    model = load_model(
        checkpoint=checkpoint,
        device=device,
    )

    predictions, failures, elapsed = run_inference(
        model=model,
        image_paths=image_paths,
        input_root=input_root,
        device=device,
        batch_size=args.batch_size,
        absolute_paths=args.absolute_paths,
    )

    # Sort by image path to guarantee stable/reproducible JSON ordering.
    predictions.sort(
        key=lambda row: row["image_path"]
    )

    save_json(
        output_path,
        predictions,
        pretty=args.pretty,
    )

    # Save failures separately if any exist.
    if failures:
        failure_path = output_path.with_name(
            output_path.stem
            + "_errors.json"
        )

        with failure_path.open(
            "w",
            encoding="utf-8",
        ) as f:
            json.dump(
                failures,
                f,
                ensure_ascii=False,
                indent=2,
            )

        print(
            f"\n[WARNING] Error details saved to:\n"
            f"{failure_path}",
            file=sys.stderr,
        )

    print_summary(
        predictions=predictions,
        failures=failures,
        elapsed=elapsed,
        device=device,
        output_path=output_path,
    )

    # Return non-zero exit code if any image failed.
    if failures:
        sys.exit(2)


if __name__ == "__main__":
    main()
