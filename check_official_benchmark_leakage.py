#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Official benchmark leakage audit for TikTok TechJam 2026 Track 5.

Checks CLEAN training-source images against the official demonstration benchmark:
1) filename overlap
2) SHA-256 exact duplicates
3) pHash near-duplicates
4) dHash near-duplicates

Install dependency once:
    pip install ImageHash

Example:
python check_official_benchmark_leakage.py \
  --train-root ./data/clean_train \
  --official-real-root ./data/official/real_coco \
  --official-fake-root ./data/official/fake_dalle \
  --output-dir ./results/data_integrity
"""

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image
import imagehash

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def iter_images(root: Path):
    return sorted(
        p for p in root.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


def sha256_file(path: Path, chunk_size=1024 * 1024):
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def image_hashes(path: Path):
    with Image.open(path) as im:
        im = im.convert("RGB")
        ph = imagehash.phash(im, hash_size=8)
        dh = imagehash.dhash(im, hash_size=8)
    return int(str(ph), 16), int(str(dh), 16)


def hamming64(a: int, b: int):
    return (a ^ b).bit_count()


class BKTree:
    def __init__(self):
        self.root = None

    def add(self, value, payload):
        node = [value, [payload], {}]
        if self.root is None:
            self.root = node
            return
        cur = self.root
        while True:
            d = hamming64(value, cur[0])
            if d == 0:
                cur[1].append(payload)
                return
            if d in cur[2]:
                cur = cur[2][d]
            else:
                cur[2][d] = node
                return

    def search(self, value, max_dist):
        if self.root is None:
            return []
        results = []
        stack = [self.root]
        while stack:
            cur = stack.pop()
            d = hamming64(value, cur[0])
            if d <= max_dist:
                for payload in cur[1]:
                    results.append((d, payload))
            low = d - max_dist
            high = d + max_dist
            for edge_dist, child in cur[2].items():
                if low <= edge_dist <= high:
                    stack.append(child)
        return results


def write_csv(path: Path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-root", required=True, type=Path)
    parser.add_argument("--official-real-root", required=True, type=Path)
    parser.add_argument("--official-fake-root", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--near-threshold", type=int, default=6)
    args = parser.parse_args()

    for name, root in [
        ("train-root", args.train_root),
        ("official-real-root", args.official_real_root),
        ("official-fake-root", args.official_fake_root),
    ]:
        if not root.exists():
            raise FileNotFoundError(f"{name} does not exist: {root}")

    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)

    print("=" * 100)
    print("OFFICIAL BENCHMARK LEAKAGE AUDIT")
    print("=" * 100)

    train_paths = iter_images(args.train_root)
    real_paths = iter_images(args.official_real_root)
    fake_paths = iter_images(args.official_fake_root)
    official_records = (
        [("real_coco", p) for p in real_paths]
        + [("fake_dalle", p) for p in fake_paths]
    )

    print("Training clean images :", len(train_paths))
    print("Official real images  :", len(real_paths))
    print("Official fake images  :", len(fake_paths))
    print("Official total        :", len(official_records))

    if len(real_paths) != 4998:
        print(f"[WARNING] Expected 4998 official real images, found {len(real_paths)}")
    if len(fake_paths) != 8843:
        print(f"[WARNING] Expected 8843 official fake images, found {len(fake_paths)}")

    # 1) filename overlap
    print("\n[1/4] Filename overlap...")
    train_name_map = defaultdict(list)
    for p in train_paths:
        train_name_map[p.name.lower()].append(p)

    filename_rows = []
    for label, p in official_records:
        for train_p in train_name_map.get(p.name.lower(), []):
            filename_rows.append({
                "official_label": label,
                "official_path": str(p),
                "train_path": str(train_p),
                "filename": p.name,
            })

    write_csv(
        out / "filename_overlap.csv",
        filename_rows,
        ["official_label", "official_path", "train_path", "filename"],
    )

    # 2) SHA256
    print("\n[2/4] SHA-256 exact duplicate check...")
    train_sha_map = defaultdict(list)
    for i, p in enumerate(train_paths, 1):
        train_sha_map[sha256_file(p)].append(p)
        if i % 1000 == 0 or i == len(train_paths):
            print(f"  Train SHA256: {i}/{len(train_paths)}")

    exact_rows = []
    official_sha_records = []
    for i, (label, p) in enumerate(official_records, 1):
        sha = sha256_file(p)
        official_sha_records.append((label, p, sha))
        for train_p in train_sha_map.get(sha, []):
            exact_rows.append({
                "official_label": label,
                "official_path": str(p),
                "train_path": str(train_p),
                "sha256": sha,
            })
        if i % 1000 == 0 or i == len(official_records):
            print(f"  Official SHA256: {i}/{len(official_records)}")

    write_csv(
        out / "exact_duplicates.csv",
        exact_rows,
        ["official_label", "official_path", "train_path", "sha256"],
    )

    # 3) perceptual hash index
    print("\n[3/4] Building pHash/dHash index...")
    phash_tree = BKTree()
    dhash_tree = BKTree()
    hash_failures = []

    for i, p in enumerate(train_paths, 1):
        try:
            ph, dh = image_hashes(p)
            payload = {"path": str(p), "phash": ph, "dhash": dh}
            phash_tree.add(ph, payload)
            dhash_tree.add(dh, payload)
        except Exception as e:
            hash_failures.append({"side": "train", "path": str(p), "error": repr(e)})

        if i % 500 == 0 or i == len(train_paths):
            print(f"  Train hashes: {i}/{len(train_paths)}")

    # 4) search near-duplicates
    print("\n[4/4] Searching near-duplicate candidates...")
    candidate_map = {}

    for i, (label, p, sha) in enumerate(official_sha_records, 1):
        try:
            ph, dh = image_hashes(p)

            for dist, payload in phash_tree.search(ph, args.near_threshold):
                key = (str(p), payload["path"])
                row = candidate_map.setdefault(key, {
                    "official_label": label,
                    "official_path": str(p),
                    "train_path": payload["path"],
                    "phash_distance": "",
                    "dhash_distance": "",
                    "exact_sha256_match": 0,
                    "manual_review": "",
                    "notes": "",
                })
                row["phash_distance"] = dist

            for dist, payload in dhash_tree.search(dh, args.near_threshold):
                key = (str(p), payload["path"])
                row = candidate_map.setdefault(key, {
                    "official_label": label,
                    "official_path": str(p),
                    "train_path": payload["path"],
                    "phash_distance": "",
                    "dhash_distance": "",
                    "exact_sha256_match": 0,
                    "manual_review": "",
                    "notes": "",
                })
                row["dhash_distance"] = dist

        except Exception as e:
            hash_failures.append({"side": "official", "path": str(p), "error": repr(e)})

        if i % 500 == 0 or i == len(official_sha_records):
            print(f"  Official search: {i}/{len(official_sha_records)}")

    exact_pairs = {(r["official_path"], r["train_path"]) for r in exact_rows}
    for key, row in candidate_map.items():
        if key in exact_pairs:
            row["exact_sha256_match"] = 1

    candidate_rows = list(candidate_map.values())

    def sort_key(r):
        p = r["phash_distance"] if r["phash_distance"] != "" else 999
        d = r["dhash_distance"] if r["dhash_distance"] != "" else 999
        return (min(p, d), p, d)

    candidate_rows.sort(key=sort_key)

    write_csv(
        out / "near_duplicate_candidates.csv",
        candidate_rows,
        [
            "official_label",
            "official_path",
            "train_path",
            "phash_distance",
            "dhash_distance",
            "exact_sha256_match",
            "manual_review",
            "notes",
        ],
    )

    write_csv(
        out / "hash_failures.csv",
        hash_failures,
        ["side", "path", "error"],
    )

    exact_real = sum(r["official_label"] == "real_coco" for r in exact_rows)
    exact_fake = sum(r["official_label"] == "fake_dalle" for r in exact_rows)

    summary = {
        "train_clean_images": len(train_paths),
        "official_real_images": len(real_paths),
        "official_fake_images": len(fake_paths),
        "official_total_images": len(official_records),
        "filename_overlap_pairs": len(filename_rows),
        "sha256_exact_overlap_pairs": len(exact_rows),
        "sha256_exact_overlap_real_pairs": exact_real,
        "sha256_exact_overlap_fake_pairs": exact_fake,
        "near_duplicate_threshold": args.near_threshold,
        "near_duplicate_candidate_pairs": len(candidate_rows),
        "hash_failures": len(hash_failures),
        "manual_review_required": len(candidate_rows) > 0,
        "final_status": (
            "EXACT_OVERLAP_FOUND"
            if exact_rows
            else ("PENDING_MANUAL_REVIEW" if candidate_rows else "NO_OVERLAP_DETECTED")
        ),
    }

    with (out / "leakage_summary.json").open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    report = f"""OFFICIAL BENCHMARK LEAKAGE AUDIT
============================================================
Training clean images: {len(train_paths)}

Official benchmark:
  COCO Real: {len(real_paths)}
  DALL-E Advanced Fake: {len(fake_paths)}
  Total: {len(official_records)}

Filename overlap pairs: {len(filename_rows)}

SHA-256 exact overlap:
  Real pairs: {exact_real}
  Fake pairs: {exact_fake}
  Total pairs: {len(exact_rows)}

Perceptual near-duplicate threshold: <= {args.near_threshold}
  Candidate pairs: {len(candidate_rows)}

Hash failures: {len(hash_failures)}

FINAL STATUS:
{summary["final_status"]}

Interpretation:
- SHA256 matches are confirmed exact duplicates.
- pHash/dHash matches are candidates only and require manual visual review.
- If candidates exist, do not claim "no contamination" until manual review is completed.
"""
    (out / "leakage_report.txt").write_text(report, encoding="utf-8")

    print("\n" + "=" * 100)
    print("AUDIT COMPLETED")
    print("=" * 100)
    print("Filename overlap pairs    :", len(filename_rows))
    print("Exact SHA256 overlap pairs:", len(exact_rows))
    print("Near-duplicate candidates :", len(candidate_rows))
    print("Hash failures             :", len(hash_failures))
    print("Final status              :", summary["final_status"])
    print("Output                    :", out)


if __name__ == "__main__":
    main()
