#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Create an interactive local HTML review page for near-duplicate candidates.

Input:
    near_duplicate_candidates.csv
Output:
    near_duplicate_review/
        review.html
        assets/
            ... thumbnails ...

Run:
python make_near_duplicate_review.py \
  --csv ./results/data_integrity/near_duplicate_candidates.csv \
  --output-dir ./results/data_integrity/near_duplicate_review

Open review.html in a browser.
Mark SAME / DIFFERENT / UNCERTAIN, then click "Download review CSV".
"""

import argparse
import csv
import html
import json
import os
import shutil
from pathlib import Path

from PIL import Image, ImageOps

THUMB_SIZE = (320, 320)


def safe_thumb(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail(THUMB_SIZE, Image.Resampling.LANCZOS)

            canvas = Image.new("RGB", THUMB_SIZE, "white")
            x = (THUMB_SIZE[0] - im.width) // 2
            y = (THUMB_SIZE[1] - im.height) // 2
            canvas.paste(im, (x, y))
            canvas.save(dst, "JPEG", quality=88, optimize=True)
        return True, ""
    except Exception as e:
        return False, repr(e)


def dist_value(v):
    v = (v or "").strip()
    if v == "":
        return None
    try:
        return int(v)
    except Exception:
        return None


def risk_bucket(ph, dh):
    vals = [x for x in [ph, dh] if x is not None]
    if not vals:
        return "UNKNOWN"

    m = min(vals)
    both = ph is not None and dh is not None

    if m == 0:
        return "A"
    if both and ph <= 2 and dh <= 2:
        return "A"
    if both and ph <= 4 and dh <= 4:
        return "B"
    if m <= 2:
        return "B"
    if both and ph <= 6 and dh <= 6:
        return "C"
    return "D"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    csv_path = args.csv
    out = args.output_dir
    assets = out / "assets"

    if not csv_path.exists():
        raise FileNotFoundError(csv_path)

    out.mkdir(parents=True, exist_ok=True)
    assets.mkdir(parents=True, exist_ok=True)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        print("CSV contains no candidates.")
        return

    enriched = []
    failures = []

    print(f"Candidates: {len(rows)}")

    for i, row in enumerate(rows, 1):
        official = Path(row["official_path"])
        train = Path(row["train_path"])

        ph = dist_value(row.get("phash_distance"))
        dh = dist_value(row.get("dhash_distance"))
        bucket = risk_bucket(ph, dh)

        off_thumb = assets / f"{i:04d}_official.jpg"
        tr_thumb = assets / f"{i:04d}_train.jpg"

        ok1, err1 = safe_thumb(official, off_thumb)
        ok2, err2 = safe_thumb(train, tr_thumb)

        if not ok1:
            failures.append({"index": i, "side": "official", "path": str(official), "error": err1})
        if not ok2:
            failures.append({"index": i, "side": "train", "path": str(train), "error": err2})

        enriched.append({
            "index": i,
            "official_label": row.get("official_label", ""),
            "official_path": str(official),
            "train_path": str(train),
            "phash_distance": "" if ph is None else ph,
            "dhash_distance": "" if dh is None else dh,
            "exact_sha256_match": row.get("exact_sha256_match", "0"),
            "risk_bucket": bucket,
            "official_thumb": f"assets/{off_thumb.name}",
            "train_thumb": f"assets/{tr_thumb.name}",
        })

        if i % 50 == 0 or i == len(rows):
            print(f"  thumbnails: {i}/{len(rows)}")

    order = {"A": 0, "B": 1, "C": 2, "D": 3, "UNKNOWN": 4}

    def sort_key(r):
        ph = r["phash_distance"] if r["phash_distance"] != "" else 999
        dh = r["dhash_distance"] if r["dhash_distance"] != "" else 999
        return (order.get(r["risk_bucket"], 9), min(ph, dh), ph, dh)

    enriched.sort(key=sort_key)

    bucket_counts = {}
    for r in enriched:
        bucket_counts[r["risk_bucket"]] = bucket_counts.get(r["risk_bucket"], 0) + 1

    data_json = json.dumps(enriched, ensure_ascii=False)

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Near-Duplicate Manual Review</title>
<style>
body {{
  font-family: Arial, sans-serif;
  margin: 20px;
  background: #f5f5f5;
}}
h1 {{ margin-bottom: 6px; }}
.summary {{
  background: white; padding: 14px; border-radius: 10px; margin-bottom: 16px;
  position: sticky; top: 0; z-index: 5; box-shadow: 0 2px 8px rgba(0,0,0,.08);
}}
.card {{
  background: white; border-radius: 10px; padding: 14px; margin: 14px 0;
  box-shadow: 0 1px 5px rgba(0,0,0,.08);
}}
.images {{
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
}}
.panel {{ text-align: center; }}
img {{
  width: 320px; height: 320px; object-fit: contain; background: #eee;
  border: 1px solid #ccc;
}}
.path {{
  font-size: 11px; word-break: break-all; text-align: left; margin-top: 6px;
}}
.meta {{
  margin: 8px 0; font-family: monospace;
}}
button {{
  padding: 9px 14px; margin-right: 6px; cursor: pointer;
}}
.same.active {{ background: #ffb3b3; }}
.diff.active {{ background: #b9f6ca; }}
.uncertain.active {{ background: #fff59d; }}
.badge {{
  display:inline-block; min-width:24px; text-align:center; border-radius:12px;
  padding:3px 8px; font-weight:bold; margin-right:8px;
}}
.A {{ background:#ffcdd2; }}
.B {{ background:#ffe0b2; }}
.C {{ background:#fff9c4; }}
.D {{ background:#e0e0e0; }}
.filters button {{ margin-top: 5px; }}
</style>
</head>
<body>
<h1>Official Benchmark Near-Duplicate Review</h1>

<div class="summary">
  <div><b>Total candidates:</b> {len(enriched)}</div>
  <div><b>Risk buckets:</b> {html.escape(str(bucket_counts))}</div>
  <div>
    <b>Reviewed:</b> <span id="reviewed">0</span> /
    <span id="total">{len(enriched)}</span>
    &nbsp; | &nbsp;
    SAME: <span id="sameCount">0</span>
    &nbsp; DIFFERENT: <span id="diffCount">0</span>
    &nbsp; UNCERTAIN: <span id="uncertainCount">0</span>
  </div>
  <div class="filters">
    Show:
    <button onclick="setFilter('ALL')">ALL</button>
    <button onclick="setFilter('A')">A</button>
    <button onclick="setFilter('B')">B</button>
    <button onclick="setFilter('C')">C</button>
    <button onclick="setFilter('D')">D</button>
    <button onclick="setFilter('UNREVIEWED')">UNREVIEWED</button>
    <button onclick="downloadCSV()"><b>Download review CSV</b></button>
  </div>
</div>

<div id="cards"></div>

<script>
const data = {data_json};
const reviews = {{}};
let filterMode = 'ALL';

function setReview(idx, value) {{
  reviews[idx] = value;
  renderCounts();

  const card = document.getElementById('card-' + idx);
  for (const b of card.querySelectorAll('.review-btn')) b.classList.remove('active');

  const btn = card.querySelector('[data-value="' + value + '"]');
  if (btn) btn.classList.add('active');
}}

function renderCounts() {{
  let same=0, diff=0, uncertain=0;
  for (const v of Object.values(reviews)) {{
    if (v === 'SAME') same++;
    if (v === 'DIFFERENT') diff++;
    if (v === 'UNCERTAIN') uncertain++;
  }}
  document.getElementById('reviewed').innerText = same+diff+uncertain;
  document.getElementById('sameCount').innerText = same;
  document.getElementById('diffCount').innerText = diff;
  document.getElementById('uncertainCount').innerText = uncertain;
}}

function shouldShow(r) {{
  if (filterMode === 'ALL') return true;
  if (filterMode === 'UNREVIEWED') return !reviews[r.index];
  return r.risk_bucket === filterMode;
}}

function setFilter(mode) {{
  filterMode = mode;
  render();
}}

function render() {{
  const root = document.getElementById('cards');
  root.innerHTML = '';

  for (const r of data) {{
    if (!shouldShow(r)) continue;

    const div = document.createElement('div');
    div.className = 'card';
    div.id = 'card-' + r.index;

    div.innerHTML = `
      <div class="meta">
        <span class="badge ${{r.risk_bucket}}">${{r.risk_bucket}}</span>
        Pair #${{r.index}}
        | label=${{r.official_label}}
        | pHash=${{r.phash_distance}}
        | dHash=${{r.dhash_distance}}
        | SHA256 exact=${{r.exact_sha256_match}}
      </div>

      <div class="images">
        <div class="panel">
          <h3>Official benchmark</h3>
          <img src="${{r.official_thumb}}">
          <div class="path">${{r.official_path}}</div>
        </div>

        <div class="panel">
          <h3>Training image</h3>
          <img src="${{r.train_thumb}}">
          <div class="path">${{r.train_path}}</div>
        </div>
      </div>

      <div style="margin-top:12px">
        <button class="review-btn same" data-value="SAME"
          onclick="setReview(${{r.index}}, 'SAME')">SAME</button>
        <button class="review-btn diff" data-value="DIFFERENT"
          onclick="setReview(${{r.index}}, 'DIFFERENT')">DIFFERENT</button>
        <button class="review-btn uncertain" data-value="UNCERTAIN"
          onclick="setReview(${{r.index}}, 'UNCERTAIN')">UNCERTAIN</button>
      </div>
    `;

    root.appendChild(div);

    if (reviews[r.index]) {{
      const btn = div.querySelector('[data-value="' + reviews[r.index] + '"]');
      if (btn) btn.classList.add('active');
    }}
  }}
}}

function csvEscape(v) {{
  const s = String(v ?? '');
  return '"' + s.replaceAll('"', '""') + '"';
}}

function downloadCSV() {{
  const header = [
    'index','official_label','official_path','train_path',
    'phash_distance','dhash_distance','exact_sha256_match',
    'risk_bucket','manual_review'
  ];

  const lines = [header.join(',')];

  for (const r of data) {{
    const row = [
      r.index,
      r.official_label,
      r.official_path,
      r.train_path,
      r.phash_distance,
      r.dhash_distance,
      r.exact_sha256_match,
      r.risk_bucket,
      reviews[r.index] || ''
    ];
    lines.push(row.map(csvEscape).join(','));
  }}

  const blob = new Blob([lines.join('\\n')], {{type:'text/csv;charset=utf-8'}});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'manual_review_completed.csv';
  a.click();
  URL.revokeObjectURL(url);
}}

render();
renderCounts();
</script>
</body>
</html>
"""

    (out / "review.html").write_text(page, encoding="utf-8")

    with (out / "thumbnail_failures.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["index", "side", "path", "error"])
        w.writeheader()
        w.writerows(failures)

    (out / "review_summary.json").write_text(
        json.dumps({
            "candidate_pairs": len(enriched),
            "bucket_counts": bucket_counts,
            "thumbnail_failures": len(failures),
            "risk_bucket_definition": {
                "A": "very high priority: one hash distance = 0, or both pHash/dHash <= 2",
                "B": "high priority: both <= 4, or minimum distance <= 2",
                "C": "medium priority: both pHash/dHash <= 6",
                "D": "lower priority: only one perceptual hash matched <= 6",
            }
        }, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print()
    print("=" * 80)
    print("REVIEW PAGE CREATED")
    print("=" * 80)
    print("Candidates :", len(enriched))
    print("Buckets    :", bucket_counts)
    print("Failures   :", len(failures))
    print("Open:")
    print(out / "review.html")


if __name__ == "__main__":
    main()
