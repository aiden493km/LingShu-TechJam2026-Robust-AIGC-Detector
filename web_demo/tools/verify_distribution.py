"""Verify the frozen browser model and committed static distribution."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Sequence


HASH_CHUNK_BYTES = 1024 * 1024
LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class FrozenContract:
    """Expected identity of the only model allowed in the distribution."""

    model_file: str
    model_bytes: int
    model_sha256: str


FROZEN_CONTRACT = FrozenContract(
    model_file="baseline2_njr_fp32.onnx",
    model_bytes=88123029,
    model_sha256="e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69",
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(HASH_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_within(
    candidate: Path,
    container: Path,
    label: str,
    errors: list[str],
) -> Path | None:
    resolved_container = container.resolve()
    resolved_candidate = candidate.resolve()
    try:
        resolved_candidate.relative_to(resolved_container)
    except ValueError:
        errors.append(
            f'{label} escapes {container.name or container}: resolved to "{resolved_candidate}"'
        )
        return None
    return resolved_candidate


def _load_json(path: Path, label: str, errors: list[str]) -> Any | None:
    if not path.is_file():
        errors.append(f"{label} is missing")
        return None
    try:
        with path.open("r", encoding="utf-8") as file_handle:
            return json.load(file_handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        errors.append(f"{label} is not valid JSON: {error}")
        return None


def _validate_manifest(
    manifest: Any,
    contract: FrozenContract,
    errors: list[str],
) -> None:
    if not isinstance(manifest, dict):
        errors.append("models/manifest.json must contain a JSON object")
        return

    if type(manifest.get("schema_version")) is not int or manifest.get("schema_version") != 1:
        errors.append("models/manifest.json schema_version must equal 1")

    model = manifest.get("model")
    if not isinstance(model, dict):
        errors.append("models/manifest.json model must be a JSON object")
        return

    expected_fields: tuple[tuple[str, object], ...] = (
        ("file", contract.model_file),
        ("bytes", contract.model_bytes),
        ("sha256", contract.model_sha256),
    )
    for field, expected in expected_fields:
        actual = model.get(field)
        if actual != expected or type(actual) is not type(expected):
            errors.append(
                f"models/manifest.json model.{field} must equal {expected!r}; found {actual!r}"
            )

    sha256 = model.get("sha256")
    if not isinstance(sha256, str) or SHA256_PATTERN.fullmatch(sha256) is None:
        errors.append(
            "models/manifest.json model.sha256 must be a lowercase 64-character SHA-256 digest"
        )


def _verify_model(
    root: Path,
    contract: FrozenContract,
    errors: list[str],
) -> None:
    models_directory = root / "web_demo" / "models"
    resolved_models = _resolve_within(
        models_directory,
        root,
        "web_demo/models",
        errors,
    )
    if resolved_models is None:
        return
    if not models_directory.is_dir():
        errors.append("web_demo/models is missing or is not a directory")
        return

    onnx_files = sorted(
        (
            candidate
            for candidate in models_directory.rglob("*")
            if candidate.suffix.lower() == ".onnx"
            and (candidate.is_file() or candidate.is_symlink())
        ),
        key=lambda path: path.as_posix(),
    )
    if len(onnx_files) != 1:
        names = ", ".join(
            path.relative_to(models_directory).as_posix() for path in onnx_files
        ) or "none"
        errors.append(
            "web_demo/models must contain exactly one .onnx file "
            f"({contract.model_file}); found {len(onnx_files)}: {names}"
        )

    manifest_path = models_directory / "manifest.json"
    if manifest_path.is_symlink():
        errors.append("models/manifest.json must be a regular file, not a symlink")
    elif (
        _resolve_within(
            manifest_path,
            resolved_models,
            "models/manifest.json",
            errors,
        )
        is not None
    ):
        manifest = _load_json(manifest_path, "models/manifest.json", errors)
        if manifest is not None:
            _validate_manifest(manifest, contract, errors)

    model_path = models_directory / contract.model_file
    resolved_model = _resolve_within(
        model_path,
        resolved_models,
        f"model path {contract.model_file!r}",
        errors,
    )
    if resolved_model is None:
        return
    if model_path.is_symlink():
        errors.append(f"model {contract.model_file} must be a regular file, not a symlink")
        return
    if not model_path.is_file():
        errors.append(f"frozen model is missing: web_demo/models/{contract.model_file}")
        return

    try:
        with model_path.open("rb") as file_handle:
            prefix = file_handle.read(len(LFS_POINTER_PREFIX))
        if prefix == LFS_POINTER_PREFIX:
            errors.append(
                f"model {contract.model_file} is a Git LFS pointer, not model data; "
                "this is an incomplete clone"
            )

        actual_bytes = model_path.stat().st_size
        if actual_bytes != contract.model_bytes:
            errors.append(
                "model byte count mismatch: "
                f"expected {contract.model_bytes}, found {actual_bytes} "
                f"for {contract.model_file}"
            )

        actual_sha256 = _sha256_file(model_path)
        if actual_sha256 != contract.model_sha256:
            errors.append(
                "model SHA-256 mismatch: "
                f"expected {contract.model_sha256}, found {actual_sha256} "
                f"for {contract.model_file}"
            )
    except OSError as error:
        errors.append(f"could not read model {contract.model_file}: {error}")


def _parse_integrity_entries(
    integrity: Any,
    dist_directory: Path,
    errors: list[str],
) -> dict[str, tuple[int, str]]:
    if not isinstance(integrity, dict):
        errors.append("dist/integrity.json must contain a JSON object")
        return {}
    if type(integrity.get("schema_version")) is not int or integrity.get("schema_version") != 1:
        errors.append("dist/integrity.json schema_version must equal 1")

    raw_files = integrity.get("files")
    if not isinstance(raw_files, list):
        errors.append("dist/integrity.json files must be a JSON array")
        return {}

    entries: dict[str, tuple[int, str]] = {}
    resolved_dist = dist_directory.resolve()
    for index, raw_entry in enumerate(raw_files):
        label = f"dist/integrity.json files[{index}]"
        if not isinstance(raw_entry, dict):
            errors.append(f"{label} must be an object")
            continue
        unexpected_fields = sorted(set(raw_entry) - {"path", "bytes", "sha256"})
        missing_fields = sorted({"path", "bytes", "sha256"} - set(raw_entry))
        if missing_fields:
            errors.append(f"{label} is missing fields: {', '.join(missing_fields)}")
            continue
        if unexpected_fields:
            errors.append(f"{label} has unexpected fields: {', '.join(unexpected_fields)}")
            continue

        relative_path = raw_entry.get("path")
        byte_count = raw_entry.get("bytes")
        sha256 = raw_entry.get("sha256")
        valid_entry = True

        if not isinstance(relative_path, str) or not relative_path:
            errors.append(f"{label}.path must be a non-empty string")
            valid_entry = False
        else:
            pure_path = PurePosixPath(relative_path)
            path_is_normalized = not (
                "\\" in relative_path
                or pure_path.is_absolute()
                or relative_path != pure_path.as_posix()
                or any(part in {"", ".", ".."} for part in pure_path.parts)
                or (pure_path.parts and ":" in pure_path.parts[0])
            )
            candidate = dist_directory.joinpath(*pure_path.parts)
            resolved_candidate = _resolve_within(
                candidate,
                resolved_dist,
                f'dist integrity path "{relative_path}"',
                errors,
            )
            if not path_is_normalized:
                valid_entry = False
                if resolved_candidate is not None:
                    errors.append(
                        f'{label}.path must be a normalized relative path; found "{relative_path}"'
                    )
            if resolved_candidate is None:
                valid_entry = False

        if type(byte_count) is not int or byte_count < 0:
            errors.append(f"{label}.bytes must be a non-negative integer")
            valid_entry = False
        if not isinstance(sha256, str) or SHA256_PATTERN.fullmatch(sha256) is None:
            errors.append(f"{label}.sha256 must be a lowercase 64-character SHA-256 digest")
            valid_entry = False

        if isinstance(relative_path, str) and relative_path in entries:
            errors.append(f'dist/integrity.json has duplicate path "{relative_path}"')
            valid_entry = False
        if valid_entry:
            entries[relative_path] = (byte_count, sha256)

    return entries


def _enumerate_dist_files(
    dist_directory: Path,
    errors: list[str],
) -> dict[str, Path]:
    files: dict[str, Path] = {}
    resolved_dist = dist_directory.resolve()
    for candidate in sorted(dist_directory.rglob("*"), key=lambda path: path.as_posix()):
        relative_path = candidate.relative_to(dist_directory).as_posix()
        if relative_path == "integrity.json":
            continue
        if candidate.is_symlink():
            errors.append(f"dist entry {relative_path} must not be a symlink")
            continue
        if not candidate.is_file():
            continue
        if (
            _resolve_within(
                candidate,
                resolved_dist,
                f"dist entry {relative_path}",
                errors,
            )
            is not None
        ):
            files[relative_path] = candidate
    return files


def _verify_dist(root: Path, errors: list[str]) -> None:
    dist_directory = root / "web_demo" / "dist"
    resolved_dist = _resolve_within(dist_directory, root, "web_demo/dist", errors)
    if resolved_dist is None:
        return
    if not dist_directory.is_dir():
        errors.append("web_demo/dist is missing or is not a directory")

    integrity_path = dist_directory / "integrity.json"
    if integrity_path.is_symlink():
        errors.append("dist/integrity.json must be a regular file, not a symlink")
        return
    if (
        _resolve_within(
            integrity_path,
            resolved_dist,
            "dist/integrity.json",
            errors,
        )
        is None
    ):
        return

    integrity = _load_json(integrity_path, "dist/integrity.json", errors)
    if integrity is None:
        return
    entries = _parse_integrity_entries(integrity, dist_directory, errors)
    actual_files = _enumerate_dist_files(dist_directory, errors)

    missing_entries = sorted(set(actual_files) - set(entries))
    if missing_entries:
        errors.append(
            "dist/integrity.json is missing entries for: " + ", ".join(missing_entries)
        )
    missing_files = sorted(set(entries) - set(actual_files))
    if missing_files:
        errors.append(
            "dist/integrity.json lists files absent from dist: " + ", ".join(missing_files)
        )

    for relative_path in sorted(set(actual_files) & set(entries)):
        path = actual_files[relative_path]
        expected_bytes, expected_sha256 = entries[relative_path]
        try:
            actual_bytes = path.stat().st_size
            if actual_bytes != expected_bytes:
                errors.append(
                    f"dist entry {relative_path} byte count mismatch: "
                    f"expected {expected_bytes}, found {actual_bytes}"
                )
            actual_sha256 = _sha256_file(path)
            if actual_sha256 != expected_sha256:
                errors.append(
                    f"dist entry {relative_path} SHA-256 mismatch: "
                    f"expected {expected_sha256}, found {actual_sha256}"
                )
        except OSError as error:
            errors.append(f"could not read dist entry {relative_path}: {error}")


def verify_distribution(
    root: Path,
    *,
    contract: FrozenContract = FROZEN_CONTRACT,
) -> list[str]:
    """Return every frozen-model or static-distribution validation error."""

    resolved_root = Path(root).resolve()
    errors: list[str] = []
    _verify_model(resolved_root, contract, errors)
    _verify_dist(resolved_root, errors)
    return errors


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments:
        print(
            "verify_distribution.py accepts no arguments; the production contract cannot be overridden",
            file=sys.stderr,
        )
        return 1

    repository_root = Path(__file__).resolve().parents[2]
    errors = verify_distribution(repository_root)
    if errors:
        print("Distribution verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Distribution verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
