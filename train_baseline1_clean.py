import argparse
import json
import time
import random
import platform
from pathlib import Path

import numpy as np
import pandas as pd

from PIL import Image, ImageFile

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms

from sklearn.metrics import (
    roc_auc_score,
    accuracy_score,
    f1_score,
)

import models


# ============================================================
# PIL SETTINGS
# ============================================================

# Allow loading some partially truncated images.
ImageFile.LOAD_TRUNCATED_IMAGES = True


# ============================================================
# EXPERIMENT CONFIG
# ============================================================

EXPERIMENT_NAME = "baseline1_clean"

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = REPO_ROOT / "results" / "baseline1_clean"

# Runtime paths are supplied through CLI in main().
TRAIN_ROOT = None
VAL_ROOT = None
OUT_DIR = None

# IMPORTANT:
# Test set is deliberately NOT referenced here.
# Baseline 1 training / model selection must not use test data.

HF_MODEL = "OwensLab/commfor-model-384"

# ============================================================
# CLI
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description="Baseline 1 clean-only fine-tuning."
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        required=True,
        help=(
            "Dataset root containing train/ and val/. Each split should use "
            "the SID/WildFake real/fake directory layout expected by this script."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Output directory. Default: ./results/baseline1_clean",
    )
    return parser.parse_args()


SEED = 42

IMAGE_SIZE = 384

BATCH_SIZE = 32
NUM_WORKERS = 4

EPOCHS = 5

# Conservative domain fine-tuning:
BACKBONE_LR = 2e-6
HEAD_LR = 1e-5

WEIGHT_DECAY = 1e-2

GRAD_CLIP_NORM = 1.0

USE_AMP = True

# Print training status every N batches
PRINT_EVERY = 50

EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
    ".tif",
    ".tiff",
}


# ============================================================
# RANDOM SEED
# ============================================================

def set_seed(seed: int):

    random.seed(seed)
    np.random.seed(seed)

    torch.manual_seed(seed)

    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)

    # Good speed on fixed 384x384 input.
    # Seed is fixed, but CUDA is not forced into fully deterministic mode.
    torch.backends.cudnn.benchmark = True


# ============================================================
# DATASET
# ============================================================

class BinaryFolderDataset(Dataset):

    """
    Expected directory structure:

    split/
        sid/
            real/
            fake/
        wildfake/
            real/
            fake/

    Label convention:
        real = 0
        fake = 1
    """

    def __init__(
        self,
        root: Path,
        transform,
        strict_size: int = 384,
    ):

        self.root = Path(root)
        self.transform = transform
        self.strict_size = strict_size

        if not self.root.exists():
            raise FileNotFoundError(
                f"Dataset directory does not exist:\n{self.root}"
            )

        self.samples = []

        for path in self.root.rglob("*"):

            if not path.is_file():
                continue

            if path.suffix.lower() not in EXTS:
                continue

            folder_name = path.parent.name.lower()

            if folder_name == "real":
                label = 0

            elif folder_name == "fake":
                label = 1

            else:
                continue

            self.samples.append(
                (path, label)
            )

        self.samples.sort(
            key=lambda x: str(x[0])
        )

        if len(self.samples) == 0:
            raise RuntimeError(
                f"No valid real/fake images found under:\n{self.root}"
            )

        self.num_real = sum(
            label == 0
            for _, label in self.samples
        )

        self.num_fake = sum(
            label == 1
            for _, label in self.samples
        )

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):

        path, label = self.samples[idx]

        try:
            with Image.open(path) as img:
                image = img.convert("RGB")

        except Exception as e:
            raise RuntimeError(
                f"\nFailed to load image:\n"
                f"{path}\n"
                f"Reason: {e}"
            )

        # ----------------------------------------------------
        # IMPORTANT:
        # processed_384 dataset should already be 384 x 384.
        #
        # We DO NOT silently resize here, because Baseline 1
        # must remain clean-only.
        # ----------------------------------------------------

        if image.size != (
            self.strict_size,
            self.strict_size,
        ):
            raise RuntimeError(
                f"\nUnexpected image size.\n"
                f"Path : {path}\n"
                f"Size : {image.size}\n"
                f"Expected: "
                f"({self.strict_size}, {self.strict_size})\n"
                f"\n"
                f"Do not automatically resize it in Baseline 1."
            )

        image = self.transform(image)

        label = torch.tensor(
            label,
            dtype=torch.float32
        )

        return (
            image,
            label,
            str(path),
        )


# ============================================================
# TRANSFORMS
# ============================================================

def build_transforms():

    # Community Forensics / ImageNet normalization
    mean = [
        0.485,
        0.456,
        0.406,
    ]

    std = [
        0.229,
        0.224,
        0.225,
    ]

    # ========================================================
    # BASELINE 1 = CLEAN-ONLY FINE-TUNING
    #
    # No:
    #   JPEG compression
    #   Gaussian noise
    #   Gaussian blur
    #   Resize degradation
    #   RandomResize
    #   RandomCrop
    #   CenterCrop
    #   HorizontalFlip
    #   VerticalFlip
    #   Rotation
    #   ColorJitter
    #   Cutout
    #   RSA
    #
    # Images are ALREADY 384 x 384.
    # ========================================================

    clean_transform = transforms.Compose([
        transforms.ToTensor(),

        transforms.Normalize(
            mean=mean,
            std=std,
        ),
    ])

    return (
        clean_transform,
        clean_transform,
    )


# ============================================================
# METRICS / VALIDATION
# ============================================================

@torch.inference_mode()
def evaluate(
    model,
    loader,
    criterion,
    device,
    return_predictions=False,
):

    model.eval()

    total_loss = 0.0
    total_samples = 0

    all_probs = []
    all_labels = []
    all_paths = []

    for (
        images,
        labels,
        paths,
    ) in loader:

        images = images.to(
            device,
            non_blocking=True,
        )

        labels = labels.to(
            device,
            non_blocking=True,
        )

        logits = (
            model(images)
            .reshape(-1)
        )

        loss = criterion(
            logits,
            labels,
        )

        probs = torch.sigmoid(
            logits
        )

        batch_size = images.size(0)

        total_loss += (
            loss.item()
            * batch_size
        )

        total_samples += batch_size

        all_probs.extend(
            probs
            .detach()
            .cpu()
            .numpy()
            .tolist()
        )

        all_labels.extend(
            labels
            .detach()
            .cpu()
            .numpy()
            .astype(np.int64)
            .tolist()
        )

        all_paths.extend(
            list(paths)
        )

    all_probs = np.asarray(
        all_probs,
        dtype=np.float64,
    )

    all_labels = np.asarray(
        all_labels,
        dtype=np.int64,
    )

    # --------------------------------------------------------
    # Threshold-independent main metric
    # --------------------------------------------------------

    auc = roc_auc_score(
        all_labels,
        all_probs,
    )

    # --------------------------------------------------------
    # threshold=0.5 is ONLY for training monitoring.
    #
    # It is NOT the final Baseline 1 threshold.
    # Final threshold will later be calibrated on validation.
    # --------------------------------------------------------

    pred_05 = (
        all_probs >= 0.5
    ).astype(np.int64)

    acc_05 = accuracy_score(
        all_labels,
        pred_05,
    )

    f1_05 = f1_score(
        all_labels,
        pred_05,
        zero_division=0,
    )

    real_mask = (
        all_labels == 0
    )

    fake_mask = (
        all_labels == 1
    )

    mean_real_prob = float(
        all_probs[real_mask].mean()
    )

    mean_fake_prob = float(
        all_probs[fake_mask].mean()
    )

    metrics = {
        "loss":
            float(
                total_loss
                / total_samples
            ),

        "auc":
            float(auc),

        "acc_at_0.5":
            float(acc_05),

        "f1_at_0.5":
            float(f1_05),

        "mean_real_fake_prob":
            mean_real_prob,

        "mean_fake_fake_prob":
            mean_fake_prob,
    }

    if return_predictions:

        predictions = pd.DataFrame({
            "image_path":
                all_paths,

            "label":
                all_labels,

            "fake_prob":
                all_probs,
        })

        return (
            metrics,
            predictions,
        )

    return metrics


# ============================================================
# PARAMETER INFORMATION
# ============================================================

def count_parameters(params):
    return sum(
        p.numel()
        for p in params
    )


# ============================================================
# SAVE CHECKPOINT
# ============================================================

def save_weights(
    model,
    path: Path,
):

    # Save pure state_dict for maximum compatibility
    # with later threshold / robustness scripts.

    torch.save(
        model.state_dict(),
        path,
    )


# ============================================================
# MAIN
# ============================================================

def main():
    global TRAIN_ROOT, VAL_ROOT, OUT_DIR

    args = parse_args()
    data_root = args.data_root.resolve()
    TRAIN_ROOT = data_root / "train"
    VAL_ROOT = data_root / "val"
    OUT_DIR = args.output_dir.resolve()

    set_seed(SEED)

    OUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    # --------------------------------------------------------
    # DEVICE
    # --------------------------------------------------------

    device = torch.device(
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )

    print("=" * 80)
    print("BASELINE 1 - CLEAN-ONLY FINE-TUNING")
    print("=" * 80)

    print(
        "Experiment :",
        EXPERIMENT_NAME,
    )

    print(
        "Device     :",
        device,
    )

    if device.type == "cuda":

        print(
            "GPU        :",
            torch.cuda.get_device_name(0),
        )

        props = (
            torch.cuda
            .get_device_properties(0)
        )

        print(
            "GPU VRAM   :",
            f"{props.total_memory / 1024**3:.2f} GB",
        )

    else:

        print()
        print(
            "WARNING: CUDA not available."
        )
        print(
            "This experiment is intended to run on GPU."
        )
        print()

    print(
        "PyTorch    :",
        torch.__version__,
    )

    print(
        "Python     :",
        platform.python_version(),
    )

    print(
        "Train root :",
        TRAIN_ROOT,
    )

    print(
        "Val root   :",
        VAL_ROOT,
    )

    print(
        "Output     :",
        OUT_DIR,
    )

    print("=" * 80)

    # --------------------------------------------------------
    # TRANSFORMS / DATASET
    # --------------------------------------------------------

    train_transform, val_transform = (
        build_transforms()
    )

    train_dataset = BinaryFolderDataset(
        root=TRAIN_ROOT,
        transform=train_transform,
        strict_size=IMAGE_SIZE,
    )

    val_dataset = BinaryFolderDataset(
        root=VAL_ROOT,
        transform=val_transform,
        strict_size=IMAGE_SIZE,
    )

    print()
    print("DATASET")
    print("-" * 80)

    print(
        f"Train samples : "
        f"{len(train_dataset)}"
    )

    print(
        f"  Real        : "
        f"{train_dataset.num_real}"
    )

    print(
        f"  Fake        : "
        f"{train_dataset.num_fake}"
    )

    print(
        f"Val samples   : "
        f"{len(val_dataset)}"
    )

    print(
        f"  Real        : "
        f"{val_dataset.num_real}"
    )

    print(
        f"  Fake        : "
        f"{val_dataset.num_fake}"
    )

    imbalance_ratio = (
        max(
            train_dataset.num_real,
            train_dataset.num_fake,
        )
        /
        min(
            train_dataset.num_real,
            train_dataset.num_fake,
        )
    )

    print(
        "Train imbalance ratio:",
        f"{imbalance_ratio:.4f}",
    )

    # --------------------------------------------------------
    # DATA LOADERS
    # --------------------------------------------------------

    train_loader = DataLoader(
        train_dataset,

        batch_size=BATCH_SIZE,

        shuffle=True,

        num_workers=NUM_WORKERS,

        pin_memory=(
            device.type == "cuda"
        ),

        persistent_workers=(
            NUM_WORKERS > 0
        ),

        drop_last=False,
    )

    val_loader = DataLoader(
        val_dataset,

        batch_size=BATCH_SIZE,

        shuffle=False,

        num_workers=NUM_WORKERS,

        pin_memory=(
            device.type == "cuda"
        ),

        persistent_workers=(
            NUM_WORKERS > 0
        ),

        drop_last=False,
    )

    print()
    print(
        "Train batches:",
        len(train_loader),
    )

    print(
        "Val batches  :",
        len(val_loader),
    )

    # --------------------------------------------------------
    # FIRST-BATCH SANITY CHECK
    # --------------------------------------------------------

    print()
    print("=" * 80)
    print("INPUT SANITY CHECK")
    print("=" * 80)

    sample_images, (
        sample_labels
    ), sample_paths = next(
        iter(train_loader)
    )

    print(
        "Tensor shape:",
        tuple(sample_images.shape),
    )

    print(
        "Tensor dtype:",
        sample_images.dtype,
    )

    print(
        "Tensor min  :",
        f"{sample_images.min().item():.4f}",
    )

    print(
        "Tensor max  :",
        f"{sample_images.max().item():.4f}",
    )

    print(
        "First labels:",
        sample_labels[:16].tolist(),
    )

    print(
        "Example path:",
        sample_paths[0],
    )

    expected_shape = (
        sample_images.shape[1] == 3
        and
        sample_images.shape[2] == IMAGE_SIZE
        and
        sample_images.shape[3] == IMAGE_SIZE
    )

    if not expected_shape:
        raise RuntimeError(
            "\nUnexpected input tensor shape.\n"
            f"Got: {tuple(sample_images.shape)}\n"
            f"Expected: [B, 3, {IMAGE_SIZE}, {IMAGE_SIZE}]"
        )

    del sample_images
    del sample_labels
    del sample_paths

    # --------------------------------------------------------
    # MODEL
    # --------------------------------------------------------

    print()
    print("=" * 80)
    print("LOADING PRETRAINED MODEL")
    print("=" * 80)

    print(
        "Model:",
        HF_MODEL,
    )

    model = (
        models
        .ViTClassifier
        .from_pretrained(
            HF_MODEL
        )
    )

    model = model.to(
        device
    )

    print(
        "Model loaded successfully."
    )

    # --------------------------------------------------------
    # FIND CLASSIFICATION HEAD
    # --------------------------------------------------------

    if not hasattr(model, "vit"):
        raise AttributeError(
            "Model does not contain model.vit"
        )

    if not hasattr(
        model.vit,
        "head",
    ):
        raise AttributeError(
            "Model does not contain model.vit.head"
        )

    head_params = list(
        model.vit
        .head
        .parameters()
    )

    head_param_ids = {
        id(p)
        for p in head_params
    }

    backbone_params = [
        p
        for p in model.parameters()
        if id(p)
        not in head_param_ids
    ]

    print()
    print("PARAMETERS")
    print("-" * 80)

    print(
        "Backbone parameters:",
        f"{count_parameters(backbone_params):,}",
    )

    print(
        "Head parameters    :",
        f"{count_parameters(head_params):,}",
    )

    print(
        "Total parameters   :",
        f"{count_parameters(model.parameters()):,}",
    )

    # --------------------------------------------------------
    # OPTIMIZER
    # --------------------------------------------------------

    optimizer = torch.optim.AdamW(
        [
            {
                "params":
                    backbone_params,

                "lr":
                    BACKBONE_LR,
            },

            {
                "params":
                    head_params,

                "lr":
                    HEAD_LR,
            },
        ],

        weight_decay=WEIGHT_DECAY,
    )

    scheduler = (
        torch.optim.lr_scheduler
        .ReduceLROnPlateau(
            optimizer,

            mode="max",

            factor=0.5,

            patience=1,

            min_lr=1e-7,
        )
    )

    criterion = (
        nn.BCEWithLogitsLoss()
    )

    amp_enabled = (
        USE_AMP
        and
        device.type == "cuda"
    )

    scaler = torch.amp.GradScaler(
        "cuda",
        enabled=amp_enabled,
    )

    # --------------------------------------------------------
    # SAVE CONFIG
    # --------------------------------------------------------

    config = {
        "experiment":
            EXPERIMENT_NAME,

        "hf_model":
            HF_MODEL,

        "seed":
            SEED,

        "image_size":
            IMAGE_SIZE,

        "batch_size":
            BATCH_SIZE,

        "num_workers":
            NUM_WORKERS,

        "epochs":
            EPOCHS,

        "backbone_lr":
            BACKBONE_LR,

        "head_lr":
            HEAD_LR,

        "weight_decay":
            WEIGHT_DECAY,

        "grad_clip_norm":
            GRAD_CLIP_NORM,

        "amp":
            amp_enabled,

        "augmentation":
            "NONE",

        "train_root":
            str(TRAIN_ROOT),

        "val_root":
            str(VAL_ROOT),

        "train_samples":
            len(train_dataset),

        "train_real":
            train_dataset.num_real,

        "train_fake":
            train_dataset.num_fake,

        "val_samples":
            len(val_dataset),

        "val_real":
            val_dataset.num_real,

        "val_fake":
            val_dataset.num_fake,

        "label_mapping": {
            "real": 0,
            "fake": 1,
        },

        "best_model_selection":
            "validation_auc",

        "final_threshold":
            "NOT calibrated during training",
    }

    with open(
        OUT_DIR / "config.json",
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            config,
            f,
            indent=2,
            ensure_ascii=False,
        )

    # ========================================================
    # EPOCH 0
    # PRETRAINED MODEL VALIDATION
    # ========================================================

    print()
    print("=" * 80)
    print("EPOCH 0 - PRETRAINED MODEL VALIDATION")
    print("=" * 80)

    epoch0_start = time.time()

    (
        initial_metrics,
        initial_predictions,
    ) = evaluate(
        model=model,
        loader=val_loader,
        criterion=criterion,
        device=device,
        return_predictions=True,
    )

    epoch0_time = (
        time.time()
        - epoch0_start
    )

    print(
        f"Val Loss          : "
        f"{initial_metrics['loss']:.6f}"
    )

    print(
        f"Val AUC           : "
        f"{initial_metrics['auc']:.6f}"
    )

    print(
        f"Val Acc @ 0.5     : "
        f"{initial_metrics['acc_at_0.5']:.6f}"
    )

    print(
        f"Val F1 @ 0.5      : "
        f"{initial_metrics['f1_at_0.5']:.6f}"
    )

    print(
        f"Mean P(fake)|Real : "
        f"{initial_metrics['mean_real_fake_prob']:.6f}"
    )

    print(
        f"Mean P(fake)|Fake : "
        f"{initial_metrics['mean_fake_fake_prob']:.6f}"
    )

    print(
        f"Epoch 0 time      : "
        f"{epoch0_time:.1f}s"
    )

    # Very important sanity check
    if (
        initial_metrics[
            "mean_fake_fake_prob"
        ]
        <=
        initial_metrics[
            "mean_real_fake_prob"
        ]
    ):
        raise RuntimeError(
            "\nSANITY CHECK FAILED:\n"
            "Mean fake probability for FAKE images "
            "is not greater than REAL images.\n"
            "Possible label inversion or preprocessing problem."
        )

    # Save pretrained validation predictions
    initial_predictions.to_csv(
        OUT_DIR
        / "val_predictions_epoch0_pretrained.csv",

        index=False,
    )

    # --------------------------------------------------------
    # Training history begins with epoch 0
    # --------------------------------------------------------

    history = [{
        "epoch":
            0,

        "stage":
            "pretrained",

        "train_loss":
            np.nan,

        "val_loss":
            initial_metrics["loss"],

        "val_auc":
            initial_metrics["auc"],

        "val_acc_at_0.5":
            initial_metrics["acc_at_0.5"],

        "val_f1_at_0.5":
            initial_metrics["f1_at_0.5"],

        "mean_prob_real":
            initial_metrics[
                "mean_real_fake_prob"
            ],

        "mean_prob_fake":
            initial_metrics[
                "mean_fake_fake_prob"
            ],

        "backbone_lr":
            BACKBONE_LR,

        "head_lr":
            HEAD_LR,

        "epoch_seconds":
            epoch0_time,
    }]

    pd.DataFrame(
        history
    ).to_csv(
        OUT_DIR
        / "history.csv",

        index=False,
    )

    # --------------------------------------------------------
    # IMPORTANT:
    #
    # We do NOT treat epoch 0 as the Baseline 1 checkpoint.
    # It is the Baseline 0 pretrained reference.
    #
    # best_auc starts below possible AUC so that at least one
    # fine-tuned epoch will be recorded.
    # --------------------------------------------------------

    best_auc = -1.0
    best_epoch = None

    best_path = (
        OUT_DIR
        / "baseline1_clean_best.pt"
    )

    last_path = (
        OUT_DIR
        / "baseline1_clean_last.pt"
    )

    total_training_start = (
        time.time()
    )

    # ========================================================
    # TRAINING LOOP
    # ========================================================

    for epoch in range(
        1,
        EPOCHS + 1,
    ):

        print()
        print("=" * 80)
        print(
            f"EPOCH {epoch}/{EPOCHS}"
        )
        print("=" * 80)

        epoch_start = time.time()

        model.train()

        running_loss = 0.0
        seen = 0

        for batch_idx, (
            images,
            labels,
            _,
        ) in enumerate(
            train_loader,
            start=1,
        ):

            images = images.to(
                device,
                non_blocking=True,
            )

            labels = labels.to(
                device,
                non_blocking=True,
            )

            optimizer.zero_grad(
                set_to_none=True
            )

            # ------------------------------------------------
            # Forward
            # ------------------------------------------------

            with torch.autocast(
                device_type=device.type,
                dtype=torch.float16,
                enabled=amp_enabled,
            ):

                logits = (
                    model(images)
                    .reshape(-1)
                )

                loss = criterion(
                    logits,
                    labels,
                )

            if not torch.isfinite(
                loss
            ):
                raise RuntimeError(
                    f"\nNon-finite loss detected:\n"
                    f"Epoch: {epoch}\n"
                    f"Batch: {batch_idx}\n"
                    f"Loss : {loss.item()}"
                )

            # ------------------------------------------------
            # Backward
            # ------------------------------------------------

            scaler.scale(
                loss
            ).backward()

            scaler.unscale_(
                optimizer
            )

            grad_norm = (
                torch.nn.utils
                .clip_grad_norm_(
                    model.parameters(),
                    max_norm=GRAD_CLIP_NORM,
                )
            )

            scaler.step(
                optimizer
            )

            scaler.update()

            batch_n = (
                images.size(0)
            )

            running_loss += (
                loss.item()
                * batch_n
            )

            seen += batch_n

            if (
                batch_idx % PRINT_EVERY == 0
                or
                batch_idx
                == len(train_loader)
            ):

                avg_train_loss = (
                    running_loss
                    / seen
                )

                print(
                    f"["
                    f"{batch_idx:4d}/"
                    f"{len(train_loader):4d}"
                    f"] "
                    f"loss="
                    f"{avg_train_loss:.6f} "
                    f"| grad_norm="
                    f"{float(grad_norm):.4f}"
                )

        train_loss = (
            running_loss
            / seen
        )

        # ====================================================
        # VALIDATION
        # ====================================================

        (
            val_metrics,
            val_predictions,
        ) = evaluate(
            model=model,
            loader=val_loader,
            criterion=criterion,
            device=device,
            return_predictions=True,
        )

        # LR scheduler uses validation AUC only
        scheduler.step(
            val_metrics["auc"]
        )

        backbone_lr_now = (
            optimizer
            .param_groups[0]["lr"]
        )

        head_lr_now = (
            optimizer
            .param_groups[1]["lr"]
        )

        epoch_seconds = (
            time.time()
            - epoch_start
        )

        # ----------------------------------------------------
        # Always save last checkpoint
        # ----------------------------------------------------

        save_weights(
            model,
            last_path,
        )

        # ----------------------------------------------------
        # BEST checkpoint by VALIDATION AUC
        # ----------------------------------------------------

        is_best = False

        if (
            val_metrics["auc"]
            >
            best_auc
        ):

            best_auc = (
                val_metrics["auc"]
            )

            best_epoch = epoch

            is_best = True

            save_weights(
                model,
                best_path,
            )

            # Also save predictions corresponding exactly
            # to the best checkpoint.
            val_predictions.to_csv(
                OUT_DIR
                / "val_predictions_best.csv",

                index=False,
            )

        # ----------------------------------------------------
        # HISTORY
        # ----------------------------------------------------

        row = {
            "epoch":
                epoch,

            "stage":
                "fine_tune",

            "train_loss":
                train_loss,

            "val_loss":
                val_metrics["loss"],

            "val_auc":
                val_metrics["auc"],

            "val_acc_at_0.5":
                val_metrics[
                    "acc_at_0.5"
                ],

            "val_f1_at_0.5":
                val_metrics[
                    "f1_at_0.5"
                ],

            "mean_prob_real":
                val_metrics[
                    "mean_real_fake_prob"
                ],

            "mean_prob_fake":
                val_metrics[
                    "mean_fake_fake_prob"
                ],

            "backbone_lr":
                backbone_lr_now,

            "head_lr":
                head_lr_now,

            "epoch_seconds":
                epoch_seconds,
        }

        history.append(
            row
        )

        pd.DataFrame(
            history
        ).to_csv(
            OUT_DIR
            / "history.csv",

            index=False,
        )

        # ----------------------------------------------------
        # PRINT SUMMARY
        # ----------------------------------------------------

        best_text = (
            "  <-- BEST"
            if is_best
            else ""
        )

        print()
        print("-" * 80)

        print(
            f"Epoch {epoch:02d}"
            f"{best_text}"
        )

        print(
            f"Train Loss        : "
            f"{train_loss:.6f}"
        )

        print(
            f"Val Loss          : "
            f"{val_metrics['loss']:.6f}"
        )

        print(
            f"Val AUC           : "
            f"{val_metrics['auc']:.6f}"
        )

        print(
            f"Val Acc @ 0.5     : "
            f"{val_metrics['acc_at_0.5']:.6f}"
        )

        print(
            f"Val F1 @ 0.5      : "
            f"{val_metrics['f1_at_0.5']:.6f}"
        )

        print(
            f"Mean P(fake)|Real : "
            f"{val_metrics['mean_real_fake_prob']:.6f}"
        )

        print(
            f"Mean P(fake)|Fake : "
            f"{val_metrics['mean_fake_fake_prob']:.6f}"
        )

        print(
            f"Backbone LR       : "
            f"{backbone_lr_now:.2e}"
        )

        print(
            f"Head LR           : "
            f"{head_lr_now:.2e}"
        )

        print(
            f"Epoch time        : "
            f"{epoch_seconds:.1f}s"
        )

        print("-" * 80)

        # ----------------------------------------------------
        # WARNING ONLY:
        # Fine-tuning may temporarily underperform epoch 0,
        # so we do not auto-stop.
        # ----------------------------------------------------

        auc_drop = (
            initial_metrics["auc"]
            -
            val_metrics["auc"]
        )

        if auc_drop > 0.02:

            print()
            print(
                "WARNING:"
            )

            print(
                f"Val AUC is "
                f"{auc_drop:.4f} below "
                f"the pretrained Epoch-0 AUC."
            )

            print(
                "Consider stopping with Ctrl+C "
                "and checking the training setup."
            )

    # ========================================================
    # COMPLETE
    # ========================================================

    total_training_seconds = (
        time.time()
        - total_training_start
    )

    summary = {
        "experiment":
            EXPERIMENT_NAME,

        "pretrained_val_auc":
            initial_metrics["auc"],

        "best_finetuned_epoch":
            best_epoch,

        "best_finetuned_val_auc":
            best_auc,

        "delta_auc_vs_pretrained":
            (
                best_auc
                -
                initial_metrics["auc"]
            ),

        "best_model":
            str(best_path),

        "last_model":
            str(last_path),

        "best_validation_predictions":
            str(
                OUT_DIR
                / "val_predictions_best.csv"
            ),

        "training_seconds":
            total_training_seconds,

        "training_minutes":
            (
                total_training_seconds
                / 60.0
            ),
    }

    with open(
        OUT_DIR
        / "summary.json",
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            summary,
            f,
            indent=2,
            ensure_ascii=False,
        )

    print()
    print("=" * 80)
    print("BASELINE 1 TRAINING COMPLETED")
    print("=" * 80)

    print(
        "Epoch-0 pretrained Val AUC :",
        f"{initial_metrics['auc']:.6f}",
    )

    print(
        "Best fine-tuned epoch       :",
        best_epoch,
    )

    print(
        "Best fine-tuned Val AUC     :",
        f"{best_auc:.6f}",
    )

    print(
        "Delta vs pretrained         :",
        f"{best_auc - initial_metrics['auc']:+.6f}",
    )

    print()
    print(
        "Best model:"
    )

    print(
        best_path
    )

    print()
    print(
        "Validation predictions:"
    )

    print(
        OUT_DIR
        / "val_predictions_best.csv"
    )

    print()
    print(
        "History:"
    )

    print(
        OUT_DIR
        / "history.csv"
    )

    print()
    print(
        "Total training time:"
    )

    print(
        f"{total_training_seconds / 60:.2f} min"
    )

    print()
    print(
        "NEXT STEP:"
    )

    print(
        "Calibrate a NEW threshold using "
        "the validation set."
    )

    print(
        "Do NOT reuse Baseline-0 threshold 0.081."
    )

    print("=" * 80)


if __name__ == "__main__":
    main()