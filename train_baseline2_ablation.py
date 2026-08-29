import argparse
import json
import platform
import random
import time
from pathlib import Path, PureWindowsPath
from typing import Optional

import numpy as np
import pandas as pd
from PIL import Image, ImageFile

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, RandomSampler
from torchvision import transforms

from sklearn.metrics import roc_auc_score, accuracy_score, f1_score

import models


# ============================================================
# PIL SETTINGS
# ============================================================

ImageFile.LOAD_TRUNCATED_IMAGES = True


# ============================================================
# BASELINE-1-COMPATIBLE DEFAULTS
# ============================================================

HF_MODEL = "OwensLab/commfor-model-384"
SEED = 42
IMAGE_SIZE = 384
BATCH_SIZE = 32
NUM_WORKERS = 4
EPOCHS = 5
BACKBONE_LR = 2e-6
HEAD_LR = 1e-5
WEIGHT_DECAY = 1e-2
GRAD_CLIP_NORM = 1.0
USE_AMP = True
PRINT_EVERY = 50

# Baseline 1 used exactly 20,930 training samples per epoch.
BASELINE1_TRAIN_SAMPLES = 20930

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_OUT_ROOT = REPO_ROOT / "results" / "baseline2_ablation"

CSV_FILENAMES = {
    "A": "baseline2_A_noise_jpeg.csv",
    "B": "baseline2_B_resize_blur.csv",
    "AB": "baseline2_AB_all.csv",
}

KNOWN_TRANSFORMS = {
    "clean",
    "gaussian_noise",
    "jpeg",
    "resize",
    "gaussian_blur",
}

EXTS = {
    ".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"
}


# ============================================================
# ARGUMENTS
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Baseline 2 ablation training from offline-augmented CSV manifests. "
            "Supports experiment A / B / AB and optional transform filtering."
        )
    )

    parser.add_argument(
        "--experiment",
        required=True,
        choices=["A", "B", "AB", "a", "b", "ab"],
        help=(
            "A = clean + gaussian_noise + jpeg; "
            "B = clean + resize + gaussian_blur; "
            "AB = clean + all four augmentations."
        ),
    )

    parser.add_argument(
        "--data-root",
        type=Path,
        required=True,
        help="Local root of baseline2_train_v1 used for path remapping.",
    )

    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help=(
            "Optional explicit manifest CSV. If omitted, the script searches "
            "under --data-root, --data-root/csv, --data-root/manifests, cwd, "
            "and the script directory."
        ),
    )

    parser.add_argument(
        "--val-root",
        type=Path,
        required=True,
        help="Clean validation root. Must remain the held-out Baseline-1 val split.",
    )

    parser.add_argument(
        "--out-root",
        type=Path,
        default=DEFAULT_OUT_ROOT,
        help="Root output directory for Baseline 2 experiments.",
    )

    parser.add_argument(
        "--transforms",
        nargs="*",
        default=None,
        choices=["gaussian_noise", "jpeg", "resize", "gaussian_blur"],
        help=(
            "Optional augmented transform filter. Clean is ALWAYS retained. "
            "Example for a true B2-N run: "
            "--experiment A --transforms gaussian_noise. "
            "If omitted, all transforms in the selected CSV are used."
        ),
    )

    parser.add_argument(
        "--epoch-samples",
        type=int,
        default=BASELINE1_TRAIN_SAMPLES,
        help=(
            "Samples drawn per training epoch. Default=20930 to match Baseline 1 "
            "optimizer-step budget. Set 0 to use the full selected CSV every epoch."
        ),
    )

    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--num-workers", type=int, default=NUM_WORKERS)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--seed", type=int, default=SEED)

    parser.add_argument(
        "--skip-path-check",
        action="store_true",
        help="Skip the startup existence check for every remapped training path.",
    )

    args = parser.parse_args()
    args.experiment = args.experiment.upper()

    if args.epoch_samples < 0:
        parser.error("--epoch-samples must be >= 0")

    return args


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

    # Same speed-oriented setting used by Baseline 1.
    torch.backends.cudnn.benchmark = True


# ============================================================
# CSV DISCOVERY + ROOT REMAP
# ============================================================

def resolve_manifest_csv(experiment: str, data_root: Path, explicit_csv: Optional[Path]):
    if explicit_csv is not None:
        explicit_csv = Path(explicit_csv)
        if not explicit_csv.exists():
            raise FileNotFoundError(f"Explicit CSV does not exist:\n{explicit_csv}")
        return explicit_csv

    filename = CSV_FILENAMES[experiment]
    script_dir = Path(__file__).resolve().parent

    candidates = [
        data_root / filename,
        data_root / "csv" / filename,
        data_root / "manifests" / filename,
        Path.cwd() / filename,
        script_dir / filename,
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    joined = "\n".join(f"  - {p}" for p in candidates)
    raise FileNotFoundError(
        "Could not find the Baseline 2 manifest CSV.\n"
        f"Experiment: {experiment}\n"
        f"Expected filename: {filename}\n"
        "Searched:\n"
        f"{joined}\n\n"
        "Pass the file explicitly with --csv <path>."
    )


def remap_baseline2_path(raw_path: str, new_root: Path) -> Path:
    """
    Historical CSV manifests may contain machine-specific paths such as:
        <old-root>/baseline2_train_v1/images/...

    The actual local root is supplied with --data-root.

    We intentionally remap by the marker directory 'baseline2_train_v1'
    rather than by drive letter or an exact old prefix.
    """
    raw_text = str(raw_path).strip()

    # If the path is already valid on this machine, keep it.
    direct = Path(raw_text)
    if direct.exists():
        return direct

    win_path = PureWindowsPath(raw_text)
    parts = list(win_path.parts)

    marker_index = None
    for i, part in enumerate(parts):
        if part.lower() == "baseline2_train_v1":
            marker_index = i
            break

    if marker_index is None:
        raise ValueError(
            "Cannot remap CSV path because marker directory "
            f"'baseline2_train_v1' was not found:\n{raw_text}"
        )

    relative_parts = parts[marker_index + 1:]
    if not relative_parts:
        raise ValueError(f"CSV path has no suffix after baseline2_train_v1:\n{raw_text}")

    return Path(new_root).joinpath(*relative_parts)


# ============================================================
# DATASETS
# ============================================================

class CSVManifestDataset(Dataset):
    """
    Offline-augmented Baseline 2 training dataset.

    Important:
      - Images listed in the CSV are already clean/augmented files on disk.
      - NO random image corruption is applied here.
      - Runtime preprocessing is ONLY ToTensor + ImageNet normalization,
        matching Baseline 1 after the offline image has been selected.
      - Label convention: real=0, fake=1.
    """

    REQUIRED_COLUMNS = {
        "path", "label", "dataset", "split", "transform",
        "sample_kind", "augmentation_applied"
    }

    def __init__(
        self,
        csv_path: Path,
        data_root: Path,
        transform,
        strict_size: int = 384,
        selected_transforms=None,
        check_paths=True,
    ):
        self.csv_path = Path(csv_path)
        self.data_root = Path(data_root)
        self.transform = transform
        self.strict_size = strict_size

        df = pd.read_csv(self.csv_path)

        missing_columns = self.REQUIRED_COLUMNS - set(df.columns)
        if missing_columns:
            raise RuntimeError(
                f"Manifest missing required columns: {sorted(missing_columns)}"
            )

        if not set(df["label"].dropna().astype(int).unique()).issubset({0, 1}):
            raise RuntimeError("Manifest label column contains values other than 0/1.")

        split_values = set(df["split"].dropna().astype(str).str.lower().unique())
        if split_values != {"train"}:
            raise RuntimeError(
                "Baseline 2 training manifest must contain train rows only. "
                f"Found split values: {sorted(split_values)}"
            )

        # Optional pure-transform ablation. Clean rows are always kept.
        self.selected_transforms = None
        if selected_transforms:
            selected = set(selected_transforms)
            unknown = selected - KNOWN_TRANSFORMS
            if unknown:
                raise ValueError(f"Unknown selected transforms: {sorted(unknown)}")

            available = set(df["transform"].dropna().astype(str).unique())
            absent = selected - available
            if absent:
                raise ValueError(
                    f"Requested transforms not present in this manifest: {sorted(absent)}. "
                    f"Available: {sorted(available)}"
                )

            self.selected_transforms = sorted(selected)
            keep = df["transform"].astype(str).isin({"clean", *selected})
            df = df.loc[keep].copy()

        if len(df) == 0:
            raise RuntimeError("No training rows remain after transform filtering.")

        # The generated Baseline 2 files are expected to be 384x384.
        if "width" in df.columns and "height" in df.columns:
            bad_size_meta = df[
                (df["width"].astype(int) != strict_size)
                | (df["height"].astype(int) != strict_size)
            ]
            if len(bad_size_meta) > 0:
                raise RuntimeError(
                    f"Manifest contains {len(bad_size_meta)} rows whose metadata is not "
                    f"{strict_size}x{strict_size}."
                )

        self.raw_paths = df["path"].astype(str).tolist()
        self.paths = [
            remap_baseline2_path(p, self.data_root)
            for p in self.raw_paths
        ]
        self.labels = df["label"].astype(int).tolist()
        self.transforms = df["transform"].astype(str).tolist()
        self.datasets = df["dataset"].astype(str).tolist()

        self.num_real = int(np.sum(np.asarray(self.labels) == 0))
        self.num_fake = int(np.sum(np.asarray(self.labels) == 1))
        self.transform_counts = {
            str(k): int(v)
            for k, v in df["transform"].value_counts().to_dict().items()
        }
        self.dataset_counts = {
            str(k): int(v)
            for k, v in df["dataset"].value_counts().to_dict().items()
        }

        self.duplicate_paths = int(df["path"].duplicated().sum())
        self.duplicate_sha256 = (
            int(df["sha256"].duplicated().sum())
            if "sha256" in df.columns
            else None
        )

        if check_paths:
            missing = [p for p in self.paths if not p.exists()]
            if missing:
                preview = "\n".join(str(p) for p in missing[:10])
                raise FileNotFoundError(
                    f"{len(missing)} remapped training files do not exist. "
                    "First missing paths:\n"
                    f"{preview}\n\n"
                    "Check --data-root."
                )

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        path = self.paths[idx]
        label = self.labels[idx]

        try:
            with Image.open(path) as img:
                image = img.convert("RGB")
        except Exception as e:
            raise RuntimeError(
                f"Failed to load image:\n{path}\nReason: {e}"
            )

        if image.size != (self.strict_size, self.strict_size):
            raise RuntimeError(
                "Unexpected Baseline 2 image size.\n"
                f"Path: {path}\n"
                f"Size: {image.size}\n"
                f"Expected: ({self.strict_size}, {self.strict_size})"
            )

        image = self.transform(image)
        label = torch.tensor(label, dtype=torch.float32)

        return image, label, str(path), self.transforms[idx]


class BinaryFolderDataset(Dataset):
    """
    Baseline-1-compatible clean validation dataset.

    Expected structure:
        val/sid/real, val/sid/fake,
        val/wildfake/real, val/wildfake/fake

    Label convention: real=0, fake=1.
    """

    def __init__(self, root: Path, transform, strict_size: int = 384):
        self.root = Path(root)
        self.transform = transform
        self.strict_size = strict_size

        if not self.root.exists():
            raise FileNotFoundError(f"Validation directory does not exist:\n{self.root}")

        self.samples = []
        for path in self.root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in EXTS:
                continue

            folder_name = path.parent.name.lower()
            if folder_name == "real":
                label = 0
            elif folder_name == "fake":
                label = 1
            else:
                continue

            self.samples.append((path, label))

        self.samples.sort(key=lambda x: str(x[0]))

        if not self.samples:
            raise RuntimeError(f"No valid real/fake validation images found under:\n{self.root}")

        self.num_real = sum(label == 0 for _, label in self.samples)
        self.num_fake = sum(label == 1 for _, label in self.samples)

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]

        try:
            with Image.open(path) as img:
                image = img.convert("RGB")
        except Exception as e:
            raise RuntimeError(f"Failed to load image:\n{path}\nReason: {e}")

        if image.size != (self.strict_size, self.strict_size):
            raise RuntimeError(
                f"Unexpected validation image size.\nPath: {path}\n"
                f"Size: {image.size}\nExpected: ({self.strict_size}, {self.strict_size})"
            )

        image = self.transform(image)
        label = torch.tensor(label, dtype=torch.float32)
        return image, label, str(path)


# ============================================================
# PREPROCESSING
# ============================================================

def build_transforms():
    mean = [0.485, 0.456, 0.406]
    std = [0.229, 0.224, 0.225]

    # Offline augmentation is already baked into Baseline 2 image files.
    # Runtime preprocessing therefore stays identical to Baseline 1.
    clean_transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mean=mean, std=std),
    ])

    return clean_transform, clean_transform


# ============================================================
# METRICS / VALIDATION
# ============================================================

@torch.inference_mode()
def evaluate(model, loader, criterion, device, return_predictions=False):
    model.eval()

    total_loss = 0.0
    total_samples = 0
    all_probs = []
    all_labels = []
    all_paths = []

    for images, labels, paths in loader:
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)

        logits = model(images).reshape(-1)
        loss = criterion(logits, labels)
        probs = torch.sigmoid(logits)

        batch_size = images.size(0)
        total_loss += loss.item() * batch_size
        total_samples += batch_size

        all_probs.extend(probs.detach().cpu().numpy().tolist())
        all_labels.extend(labels.detach().cpu().numpy().astype(np.int64).tolist())
        all_paths.extend(list(paths))

    all_probs = np.asarray(all_probs, dtype=np.float64)
    all_labels = np.asarray(all_labels, dtype=np.int64)

    auc = roc_auc_score(all_labels, all_probs)
    pred_05 = (all_probs >= 0.5).astype(np.int64)
    acc_05 = accuracy_score(all_labels, pred_05)
    f1_05 = f1_score(all_labels, pred_05, zero_division=0)

    real_mask = all_labels == 0
    fake_mask = all_labels == 1

    metrics = {
        "loss": float(total_loss / total_samples),
        "auc": float(auc),
        "acc_at_0.5": float(acc_05),
        "f1_at_0.5": float(f1_05),
        "mean_real_fake_prob": float(all_probs[real_mask].mean()),
        "mean_fake_fake_prob": float(all_probs[fake_mask].mean()),
    }

    if return_predictions:
        predictions = pd.DataFrame({
            "image_path": all_paths,
            "label": all_labels,
            "fake_prob": all_probs,
        })
        return metrics, predictions

    return metrics


# ============================================================
# HELPERS
# ============================================================

def count_parameters(params):
    return sum(p.numel() for p in params)


def save_weights(model, path: Path):
    # Pure state_dict for compatibility with robustness scripts.
    torch.save(model.state_dict(), path)


def make_run_tag(experiment: str, selected_transforms):
    if not selected_transforms:
        return experiment.lower()

    short = {
        "gaussian_noise": "noise",
        "jpeg": "jpeg",
        "resize": "resize",
        "gaussian_blur": "blur",
    }
    suffix = "_".join(short[t] for t in sorted(selected_transforms))
    return f"{experiment.lower()}_{suffix}"


def print_dataset_summary(train_dataset, val_dataset, csv_path, data_root, samples_per_epoch):
    print()
    print("DATASET")
    print("-" * 80)
    print("Manifest CSV       :", csv_path)
    print("Remap data root    :", data_root)
    print("Manifest rows used :", len(train_dataset))
    print("Samples per epoch  :", samples_per_epoch)
    print("Train Real         :", train_dataset.num_real)
    print("Train Fake         :", train_dataset.num_fake)
    print("Transform counts   :", train_dataset.transform_counts)
    print("Dataset counts     :", train_dataset.dataset_counts)
    print("Duplicate paths    :", train_dataset.duplicate_paths)
    print("Duplicate SHA256   :", train_dataset.duplicate_sha256)
    print("Val samples        :", len(val_dataset))
    print("  Real             :", val_dataset.num_real)
    print("  Fake             :", val_dataset.num_fake)

    print()
    print("PATH REMAP EXAMPLES")
    print("-" * 80)
    for raw, mapped in list(zip(train_dataset.raw_paths, train_dataset.paths))[:3]:
        print("OLD:", raw)
        print("NEW:", mapped)
        print()


# ============================================================
# MAIN
# ============================================================

def main():
    args = parse_args()
    set_seed(args.seed)

    csv_path = resolve_manifest_csv(args.experiment, args.data_root, args.csv)
    run_tag = make_run_tag(args.experiment, args.transforms)
    experiment_name = f"baseline2_{run_tag}"
    out_dir = Path(args.out_root) / experiment_name
    out_dir.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    print("=" * 80)
    print("BASELINE 2 - OFFLINE AUGMENTATION ABLATION")
    print("=" * 80)
    print("Experiment        :", args.experiment)
    print("Run tag           :", run_tag)
    print("Transform filter  :", args.transforms if args.transforms else "ALL IN MANIFEST")
    print("Device            :", device)

    if device.type == "cuda":
        print("GPU               :", torch.cuda.get_device_name(0))
        props = torch.cuda.get_device_properties(0)
        print("GPU VRAM          :", f"{props.total_memory / 1024**3:.2f} GB")
    else:
        print("WARNING: CUDA not available; this experiment is intended for GPU training.")

    print("PyTorch           :", torch.__version__)
    print("Python            :", platform.python_version())
    print("CSV               :", csv_path)
    print("Baseline2 root    :", args.data_root)
    print("Validation root   :", args.val_root)
    print("Output            :", out_dir)
    print("=" * 80)

    # --------------------------------------------------------
    # TRANSFORMS / DATASETS
    # --------------------------------------------------------

    train_transform, val_transform = build_transforms()

    train_dataset = CSVManifestDataset(
        csv_path=csv_path,
        data_root=args.data_root,
        transform=train_transform,
        strict_size=IMAGE_SIZE,
        selected_transforms=args.transforms,
        check_paths=not args.skip_path_check,
    )

    val_dataset = BinaryFolderDataset(
        root=args.val_root,
        transform=val_transform,
        strict_size=IMAGE_SIZE,
    )

    if args.epoch_samples == 0:
        samples_per_epoch = len(train_dataset)
    else:
        samples_per_epoch = args.epoch_samples

    if samples_per_epoch > len(train_dataset):
        raise RuntimeError(
            f"--epoch-samples={samples_per_epoch} exceeds selected dataset size "
            f"{len(train_dataset)}. Use a smaller value or --epoch-samples 0."
        )

    print_dataset_summary(
        train_dataset,
        val_dataset,
        csv_path,
        args.data_root,
        samples_per_epoch,
    )

    if train_dataset.num_real == 0 or train_dataset.num_fake == 0:
        raise RuntimeError("Training dataset must contain both real and fake samples.")

    imbalance_ratio = max(train_dataset.num_real, train_dataset.num_fake) / min(
        train_dataset.num_real, train_dataset.num_fake
    )
    print("Train imbalance ratio:", f"{imbalance_ratio:.4f}")

    # --------------------------------------------------------
    # DATA LOADERS
    # --------------------------------------------------------

    pin_memory = device.type == "cuda"

    if samples_per_epoch < len(train_dataset):
        sampler_generator = torch.Generator()
        sampler_generator.manual_seed(args.seed)

        train_sampler = RandomSampler(
            train_dataset,
            replacement=False,
            num_samples=samples_per_epoch,
            generator=sampler_generator,
        )
        train_shuffle = False
    else:
        train_sampler = None
        train_shuffle = True

    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=train_shuffle,
        sampler=train_sampler,
        num_workers=args.num_workers,
        pin_memory=pin_memory,
        persistent_workers=args.num_workers > 0,
        drop_last=False,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=pin_memory,
        persistent_workers=args.num_workers > 0,
        drop_last=False,
    )

    print()
    print("Train batches:", len(train_loader))
    print("Val batches  :", len(val_loader))

    expected_b1_batches = (BASELINE1_TRAIN_SAMPLES + args.batch_size - 1) // args.batch_size
    print("B1-equivalent batches/epoch:", expected_b1_batches)

    # --------------------------------------------------------
    # FIRST-BATCH SANITY CHECK
    # --------------------------------------------------------

    print()
    print("=" * 80)
    print("INPUT SANITY CHECK")
    print("=" * 80)

    sample_images, sample_labels, sample_paths, sample_transform_names = next(iter(train_loader))
    print("Tensor shape:", tuple(sample_images.shape))
    print("Tensor dtype:", sample_images.dtype)
    print("Tensor min  :", f"{sample_images.min().item():.4f}")
    print("Tensor max  :", f"{sample_images.max().item():.4f}")
    print("First labels:", sample_labels[:16].tolist())
    print("Example path:", sample_paths[0])
    print("Example transform:", sample_transform_names[0])

    expected_shape = (
        sample_images.shape[1] == 3
        and sample_images.shape[2] == IMAGE_SIZE
        and sample_images.shape[3] == IMAGE_SIZE
    )
    if not expected_shape:
        raise RuntimeError(
            f"Unexpected input tensor shape: {tuple(sample_images.shape)}; "
            f"expected [B, 3, {IMAGE_SIZE}, {IMAGE_SIZE}]"
        )

    del sample_images, sample_labels, sample_paths, sample_transform_names

    # --------------------------------------------------------
    # MODEL
    # --------------------------------------------------------

    print()
    print("=" * 80)
    print("LOADING PRETRAINED MODEL")
    print("=" * 80)
    print("Model:", HF_MODEL)

    model = models.ViTClassifier.from_pretrained(HF_MODEL).to(device)
    print("Model loaded successfully.")

    if not hasattr(model, "vit"):
        raise AttributeError("Model does not contain model.vit")
    if not hasattr(model.vit, "head"):
        raise AttributeError("Model does not contain model.vit.head")

    head_params = list(model.vit.head.parameters())
    head_param_ids = {id(p) for p in head_params}
    backbone_params = [p for p in model.parameters() if id(p) not in head_param_ids]

    print()
    print("PARAMETERS")
    print("-" * 80)
    print("Backbone parameters:", f"{count_parameters(backbone_params):,}")
    print("Head parameters    :", f"{count_parameters(head_params):,}")
    print("Total parameters   :", f"{count_parameters(model.parameters()):,}")

    optimizer = torch.optim.AdamW(
        [
            {"params": backbone_params, "lr": BACKBONE_LR},
            {"params": head_params, "lr": HEAD_LR},
        ],
        weight_decay=WEIGHT_DECAY,
    )

    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="max",
        factor=0.5,
        patience=1,
        min_lr=1e-7,
    )

    criterion = nn.BCEWithLogitsLoss()
    amp_enabled = USE_AMP and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)

    # --------------------------------------------------------
    # SAVE CONFIG
    # --------------------------------------------------------

    config = {
        "experiment": experiment_name,
        "experiment_group": args.experiment,
        "run_tag": run_tag,
        "hf_model": HF_MODEL,
        "seed": args.seed,
        "image_size": IMAGE_SIZE,
        "batch_size": args.batch_size,
        "num_workers": args.num_workers,
        "epochs": args.epochs,
        "backbone_lr": BACKBONE_LR,
        "head_lr": HEAD_LR,
        "weight_decay": WEIGHT_DECAY,
        "grad_clip_norm": GRAD_CLIP_NORM,
        "amp": amp_enabled,
        "augmentation_source": "offline_precomputed_images_from_csv",
        "runtime_random_augmentation": "NONE",
        "manifest_csv": str(csv_path),
        "baseline2_data_root": str(args.data_root),
        "path_remap_marker": "baseline2_train_v1",
        "selected_transforms": args.transforms if args.transforms else "ALL_IN_MANIFEST",
        "manifest_rows_after_filter": len(train_dataset),
        "samples_per_epoch": samples_per_epoch,
        "baseline1_train_samples_reference": BASELINE1_TRAIN_SAMPLES,
        "fixed_step_budget_vs_baseline1": samples_per_epoch == BASELINE1_TRAIN_SAMPLES,
        "train_real": train_dataset.num_real,
        "train_fake": train_dataset.num_fake,
        "transform_counts": train_dataset.transform_counts,
        "dataset_counts": train_dataset.dataset_counts,
        "duplicate_paths": train_dataset.duplicate_paths,
        "duplicate_sha256": train_dataset.duplicate_sha256,
        "val_root": str(args.val_root),
        "val_samples": len(val_dataset),
        "val_real": val_dataset.num_real,
        "val_fake": val_dataset.num_fake,
        "label_mapping": {"real": 0, "fake": 1},
        "best_model_selection": "clean_validation_auc",
        "final_threshold": "NOT calibrated during training",
        "test_data_used": False,
    }

    with open(out_dir / "config.json", "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    # ========================================================
    # EPOCH 0 - PRETRAINED CLEAN VALIDATION
    # ========================================================

    print()
    print("=" * 80)
    print("EPOCH 0 - PRETRAINED MODEL CLEAN VALIDATION")
    print("=" * 80)

    epoch0_start = time.time()
    initial_metrics, initial_predictions = evaluate(
        model=model,
        loader=val_loader,
        criterion=criterion,
        device=device,
        return_predictions=True,
    )
    epoch0_time = time.time() - epoch0_start

    print(f"Val Loss          : {initial_metrics['loss']:.6f}")
    print(f"Val AUC           : {initial_metrics['auc']:.6f}")
    print(f"Val Acc @ 0.5     : {initial_metrics['acc_at_0.5']:.6f}")
    print(f"Val F1 @ 0.5      : {initial_metrics['f1_at_0.5']:.6f}")
    print(f"Mean P(fake)|Real : {initial_metrics['mean_real_fake_prob']:.6f}")
    print(f"Mean P(fake)|Fake : {initial_metrics['mean_fake_fake_prob']:.6f}")
    print(f"Epoch 0 time      : {epoch0_time:.1f}s")

    if initial_metrics["mean_fake_fake_prob"] <= initial_metrics["mean_real_fake_prob"]:
        raise RuntimeError(
            "SANITY CHECK FAILED: mean fake probability for FAKE images is not "
            "greater than REAL images. Possible label inversion or preprocessing problem."
        )

    initial_predictions.to_csv(
        out_dir / "val_predictions_epoch0_pretrained.csv",
        index=False,
    )

    history = [{
        "epoch": 0,
        "stage": "pretrained",
        "train_loss": np.nan,
        "val_loss": initial_metrics["loss"],
        "val_auc": initial_metrics["auc"],
        "val_acc_at_0.5": initial_metrics["acc_at_0.5"],
        "val_f1_at_0.5": initial_metrics["f1_at_0.5"],
        "mean_prob_real": initial_metrics["mean_real_fake_prob"],
        "mean_prob_fake": initial_metrics["mean_fake_fake_prob"],
        "backbone_lr": BACKBONE_LR,
        "head_lr": HEAD_LR,
        "epoch_seconds": epoch0_time,
        "samples_this_epoch": 0,
    }]
    pd.DataFrame(history).to_csv(out_dir / "history.csv", index=False)

    best_auc = -1.0
    best_epoch = None
    best_path = out_dir / f"{experiment_name}_best.pt"
    last_path = out_dir / f"{experiment_name}_last.pt"

    total_training_start = time.time()

    # ========================================================
    # TRAINING LOOP
    # ========================================================

    for epoch in range(1, args.epochs + 1):
        print()
        print("=" * 80)
        print(f"EPOCH {epoch}/{args.epochs}")
        print("=" * 80)

        epoch_start = time.time()
        model.train()
        running_loss = 0.0
        seen = 0
        epoch_transform_counts = {}

        for batch_idx, (images, labels, _, transform_names) in enumerate(train_loader, start=1):
            images = images.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True)

            optimizer.zero_grad(set_to_none=True)

            with torch.autocast(
                device_type=device.type,
                dtype=torch.float16,
                enabled=amp_enabled,
            ):
                logits = model(images).reshape(-1)
                loss = criterion(logits, labels)

            if not torch.isfinite(loss):
                raise RuntimeError(
                    f"Non-finite loss detected: epoch={epoch}, batch={batch_idx}, "
                    f"loss={loss.item()}"
                )

            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)

            grad_norm = torch.nn.utils.clip_grad_norm_(
                model.parameters(),
                max_norm=GRAD_CLIP_NORM,
            )

            scaler.step(optimizer)
            scaler.update()

            batch_n = images.size(0)
            running_loss += loss.item() * batch_n
            seen += batch_n

            for transform_name in transform_names:
                epoch_transform_counts[transform_name] = (
                    epoch_transform_counts.get(transform_name, 0) + 1
                )

            if batch_idx % PRINT_EVERY == 0 or batch_idx == len(train_loader):
                avg_train_loss = running_loss / seen
                print(
                    f"[{batch_idx:4d}/{len(train_loader):4d}] "
                    f"loss={avg_train_loss:.6f} | grad_norm={float(grad_norm):.4f}"
                )

        train_loss = running_loss / seen

        # ----------------------------------------------------
        # CLEAN VALIDATION ONLY FOR MODEL SELECTION
        # ----------------------------------------------------

        val_metrics, val_predictions = evaluate(
            model=model,
            loader=val_loader,
            criterion=criterion,
            device=device,
            return_predictions=True,
        )

        scheduler.step(val_metrics["auc"])
        backbone_lr_now = optimizer.param_groups[0]["lr"]
        head_lr_now = optimizer.param_groups[1]["lr"]
        epoch_seconds = time.time() - epoch_start

        save_weights(model, last_path)

        is_best = False
        if val_metrics["auc"] > best_auc:
            best_auc = val_metrics["auc"]
            best_epoch = epoch
            is_best = True
            save_weights(model, best_path)
            val_predictions.to_csv(out_dir / "val_predictions_best.csv", index=False)

        row = {
            "epoch": epoch,
            "stage": "fine_tune",
            "train_loss": train_loss,
            "val_loss": val_metrics["loss"],
            "val_auc": val_metrics["auc"],
            "val_acc_at_0.5": val_metrics["acc_at_0.5"],
            "val_f1_at_0.5": val_metrics["f1_at_0.5"],
            "mean_prob_real": val_metrics["mean_real_fake_prob"],
            "mean_prob_fake": val_metrics["mean_fake_fake_prob"],
            "backbone_lr": backbone_lr_now,
            "head_lr": head_lr_now,
            "epoch_seconds": epoch_seconds,
            "samples_this_epoch": seen,
            "transform_counts_seen": json.dumps(
                epoch_transform_counts, sort_keys=True, ensure_ascii=False
            ),
        }
        history.append(row)
        pd.DataFrame(history).to_csv(out_dir / "history.csv", index=False)

        best_text = "  <-- BEST" if is_best else ""
        print()
        print("-" * 80)
        print(f"Epoch {epoch:02d}{best_text}")
        print(f"Train Loss        : {train_loss:.6f}")
        print(f"Samples seen      : {seen}")
        print(f"Transforms seen   : {dict(sorted(epoch_transform_counts.items()))}")
        print(f"Val Loss          : {val_metrics['loss']:.6f}")
        print(f"Val AUC           : {val_metrics['auc']:.6f}")
        print(f"Val Acc @ 0.5     : {val_metrics['acc_at_0.5']:.6f}")
        print(f"Val F1 @ 0.5      : {val_metrics['f1_at_0.5']:.6f}")
        print(f"Mean P(fake)|Real : {val_metrics['mean_real_fake_prob']:.6f}")
        print(f"Mean P(fake)|Fake : {val_metrics['mean_fake_fake_prob']:.6f}")
        print(f"Backbone LR       : {backbone_lr_now:.2e}")
        print(f"Head LR           : {head_lr_now:.2e}")
        print(f"Epoch time        : {epoch_seconds:.1f}s")
        print("-" * 80)

        auc_drop = initial_metrics["auc"] - val_metrics["auc"]
        if auc_drop > 0.02:
            print()
            print("WARNING:")
            print(
                f"Val AUC is {auc_drop:.4f} below the pretrained Epoch-0 AUC. "
                "Check training setup if this persists."
            )

    # ========================================================
    # COMPLETE
    # ========================================================

    total_training_seconds = time.time() - total_training_start

    summary = {
        "experiment": experiment_name,
        "experiment_group": args.experiment,
        "selected_transforms": args.transforms if args.transforms else "ALL_IN_MANIFEST",
        "manifest_rows_after_filter": len(train_dataset),
        "samples_per_epoch": samples_per_epoch,
        "pretrained_val_auc": initial_metrics["auc"],
        "best_finetuned_epoch": best_epoch,
        "best_finetuned_val_auc": best_auc,
        "delta_auc_vs_pretrained": best_auc - initial_metrics["auc"],
        "best_model": str(best_path),
        "last_model": str(last_path),
        "best_validation_predictions": str(out_dir / "val_predictions_best.csv"),
        "training_seconds": total_training_seconds,
        "training_minutes": total_training_seconds / 60.0,
        "next_step": (
            "Calibrate threshold using CLEAN validation only, then evaluate the locked "
            "threshold across all robustness conditions. Do not use test for selection."
        ),
    }

    with open(out_dir / "summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print()
    print("=" * 80)
    print("BASELINE 2 TRAINING COMPLETED")
    print("=" * 80)
    print("Experiment                  :", experiment_name)
    print("Epoch-0 pretrained Val AUC  :", f"{initial_metrics['auc']:.6f}")
    print("Best fine-tuned epoch       :", best_epoch)
    print("Best fine-tuned Val AUC     :", f"{best_auc:.6f}")
    print("Delta vs pretrained         :", f"{best_auc - initial_metrics['auc']:+.6f}")
    print("Best model                  :", best_path)
    print("Validation predictions      :", out_dir / "val_predictions_best.csv")
    print("History                     :", out_dir / "history.csv")
    print("Config                      :", out_dir / "config.json")
    print("Total training time         :", f"{total_training_seconds / 60:.2f} min")
    print()
    print("NEXT STEP:")
    print("1) Calibrate a NEW threshold on CLEAN validation only.")
    print("2) Lock that threshold.")
    print("3) Run clean + 14 transformation robustness evaluation.")
    print("4) Do NOT use test data for Baseline 2 model/augmentation selection.")
    print("=" * 80)


if __name__ == "__main__":
    main()
