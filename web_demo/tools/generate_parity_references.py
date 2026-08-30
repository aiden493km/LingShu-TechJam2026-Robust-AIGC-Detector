"""Generate deterministic Python/ONNX parity references for the browser demo."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import sys
import uuid
from pathlib import Path, PurePosixPath
from typing import Protocol, Sequence

import numpy as np
from PIL import Image, ImageOps


DEFAULT_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(DEFAULT_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(DEFAULT_REPOSITORY_ROOT))

import inference  # noqa: E402  (repository root is made importable above)


EXPECTED_TENSOR_SHAPE = (1, 3, 384, 384)
EXPECTED_TENSOR_FLOATS = 1 * 3 * 384 * 384
EXPECTED_TENSOR_BYTES = EXPECTED_TENSOR_FLOATS * np.dtype("<f4").itemsize
HASH_CHUNK_BYTES = 1024 * 1024
PARITY_SOURCE_PATHS = (
    "demo_images/f1.png",
    "demo_images/f2.png",
    "demo_images/f3.png",
    "demo_images/f4.png",
    "demo_images/f5.png",
    "demo_images/r1.png",
    "demo_images/r2.png",
    "demo_images/r3.png",
    "demo_images/r4.png",
    "demo_images/r5.png",
    "web_demo/tests/fixtures/exif-orientation-6.jpg",
    "web_demo/tests/fixtures/grayscale.png",
    "web_demo/tests/fixtures/near-threshold-synthetic.png",
    "web_demo/tests/fixtures/non-square.png",
    "web_demo/tests/fixtures/rgba-hidden-rgb.png",
)


class LogitRunner(Protocol):
    """Minimal inference interface used by production ONNX and unit fakes."""

    def run(self, tensor: np.ndarray) -> float:
        """Return the scalar logit for one NCHW float32 tensor."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(HASH_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_sigmoid(logit: float) -> float:
    """Compute a scalar sigmoid without overflowing for large logits."""

    if logit >= 0.0:
        return 1.0 / (1.0 + math.exp(-logit))
    exponential = math.exp(logit)
    return exponential / (1.0 + exponential)


def collect_parity_inputs(repository_root: Path) -> list[Path]:
    """Return the frozen 10 demo images and five parity fixtures in order."""

    root = Path(repository_root).resolve(strict=True)
    paths = [root.joinpath(*PurePosixPath(relative).parts) for relative in PARITY_SOURCE_PATHS]
    missing = [path for path in paths if not path.is_file()]
    if missing:
        formatted = ", ".join(str(path) for path in missing)
        raise FileNotFoundError(f"parity source image(s) missing: {formatted}")
    return paths


def _load_model_contract(repository_root: Path) -> dict[str, object]:
    manifest_path = repository_root / "web_demo" / "models" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"browser model manifest is missing: {manifest_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"browser model manifest is not valid JSON: {manifest_path}") from exc

    try:
        model = manifest["model"]
        threshold = float(manifest["threshold"]["aigc"])
        model_file = str(model["file"])
        model_bytes = int(model["bytes"])
        model_sha256 = str(model["sha256"]).lower()
        input_contract = model["input"]
        output_contract = model["output"]
        input_name = str(input_contract["name"])
        output_name = str(output_contract["name"])
        input_shape = tuple(int(value) for value in input_contract["shape"])
        input_dtype = str(input_contract["dtype"])
        output_dtype = str(output_contract["dtype"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"browser model manifest has an invalid inference contract: {manifest_path}") from exc

    model_relative = PurePosixPath("web_demo/models") / model_file
    if model_relative.is_absolute() or ".." in model_relative.parts:
        raise ValueError(f"browser model path escapes its model directory: {model_file}")
    model_path = repository_root.joinpath(*model_relative.parts).resolve(strict=True)
    model_directory = (repository_root / "web_demo" / "models").resolve(strict=True)
    try:
        model_path.relative_to(model_directory)
    except ValueError as exc:
        raise ValueError(f"browser model path escapes its model directory: {model_file}") from exc

    if input_shape != EXPECTED_TENSOR_SHAPE:
        raise ValueError(
            f"browser model input shape is {input_shape}, expected {EXPECTED_TENSOR_SHAPE}"
        )
    if input_dtype != "float32" or output_dtype != "float32":
        raise ValueError("browser model input and output must both be float32")
    if not math.isfinite(threshold) or not 0.0 <= threshold <= 1.0:
        raise ValueError(f"browser model threshold is invalid: {threshold!r}")
    if model_path.stat().st_size != model_bytes:
        raise ValueError(
            f"browser model byte count mismatch: expected {model_bytes}, got {model_path.stat().st_size}"
        )
    observed_sha256 = _sha256_file(model_path)
    if observed_sha256 != model_sha256:
        raise ValueError(
            f"browser model SHA-256 mismatch: expected {model_sha256}, got {observed_sha256}"
        )

    return {
        "path": model_path,
        "source": model_relative.as_posix(),
        "file": model_file,
        "bytes": model_bytes,
        "sha256": model_sha256,
        "input_name": input_name,
        "output_name": output_name,
        "threshold": threshold,
    }


def _validated_sources(repository_root: Path, source_paths: Sequence[Path]) -> list[tuple[str, str, Path]]:
    validated: list[tuple[str, str, Path]] = []
    seen_ids: set[str] = set()

    for source_path in source_paths:
        candidate = Path(source_path)
        if not candidate.is_absolute():
            candidate = repository_root / candidate
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError as exc:
            raise FileNotFoundError(f"parity source image is missing: {candidate}") from exc
        if not resolved.is_file():
            raise ValueError(f"parity source is not a file: {resolved}")
        try:
            relative = resolved.relative_to(repository_root)
        except ValueError as exc:
            raise ValueError(f"parity source escapes repository root: {resolved}") from exc

        source = relative.as_posix()
        source_id = "__".join(PurePosixPath(source).with_suffix("").parts)
        if not source_id or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for character in source_id):
            raise ValueError(f"parity source id contains unsupported characters: {source_id!r}")
        if source_id in seen_ids:
            raise ValueError(f"duplicate parity source id: {source_id}")
        seen_ids.add(source_id)
        validated.append((source_id, source, resolved))

    return validated


def _validated_output_path(
    repository_root: Path,
    output_directory: Path,
    protected_paths: Sequence[Path],
) -> Path:
    resolved_repository = Path(repository_root).resolve(strict=True)
    candidate = Path(output_directory)
    if not candidate.is_absolute():
        candidate = resolved_repository / candidate
    candidate = Path(os.path.abspath(candidate))
    if candidate.is_symlink():
        raise ValueError(f"output directory must not be a symlink: {candidate}")

    lexical_is_in_repository = candidate.is_relative_to(resolved_repository)
    resolved_generated_tests: Path | None = None
    if lexical_is_in_repository:
        lexical_generated_tests = (
            resolved_repository / "web_demo" / ".generated-tests"
        )
        resolved_generated_tests = lexical_generated_tests.resolve(strict=False)
        is_junction = getattr(lexical_generated_tests, "is_junction", None)
        generated_tests_is_junction = bool(is_junction and is_junction())
        if (
            lexical_generated_tests.is_symlink()
            or generated_tests_is_junction
            or resolved_generated_tests != lexical_generated_tests
        ):
            raise ValueError(
                "web_demo/.generated-tests output root is redirected by a symlink or junction: "
                f"{lexical_generated_tests} -> {resolved_generated_tests}"
            )

    candidate_parent = candidate.parent.resolve(strict=False)
    resolved = candidate_parent / candidate.name
    resolved_is_in_repository = resolved.is_relative_to(resolved_repository)
    if lexical_is_in_repository != resolved_is_in_repository:
        raise ValueError(
            f"output directory symlink path escapes the repository boundary: {candidate} -> {resolved}"
        )

    if resolved == resolved_repository or resolved_repository.is_relative_to(resolved):
        raise ValueError(f"output directory must not contain the repository: {resolved}")
    if resolved_is_in_repository:
        if resolved_generated_tests is None:
            raise ValueError(f"output directory resolves unexpectedly inside repository: {resolved}")
        if resolved == resolved_generated_tests or not resolved.is_relative_to(
            resolved_generated_tests
        ):
            raise ValueError(
                "repository output must be strictly below web_demo/.generated-tests: "
                f"{resolved}"
            )
    elif resolved.exists():
        raise ValueError(
            "external output destination must not already exist; "
            f"choose a new path: {resolved}"
        )
    for protected in protected_paths:
        protected_resolved = protected.resolve(strict=True)
        if protected_resolved == resolved or protected_resolved.is_relative_to(resolved):
            raise ValueError(f"output directory must not contain source/model files: {resolved}")
    if resolved.exists() and not resolved.is_dir():
        raise ValueError(f"output path exists but is not a directory: {resolved}")
    return resolved


def _image_dimensions(path: Path) -> tuple[dict[str, int], dict[str, int]]:
    with Image.open(path) as image:
        original = {"width": image.width, "height": image.height}
        oriented_image = ImageOps.exif_transpose(image)
        oriented = {"width": oriented_image.width, "height": oriented_image.height}
        if oriented_image is not image:
            oriented_image.close()
    return original, oriented


def _preprocess_tensor(path: Path) -> np.ndarray:
    # This is intentionally the only preprocessing implementation used here.
    # It keeps browser parity anchored to the formal evaluator's real semantics.
    torch_tensor = inference.preprocess_image(path)
    tensor = np.asarray(torch_tensor.detach().cpu().numpy(), dtype="<f4", order="C")
    if tensor.shape == EXPECTED_TENSOR_SHAPE[1:]:
        tensor = tensor[np.newaxis, ...]
    tensor = np.ascontiguousarray(tensor, dtype="<f4")
    if tensor.shape != EXPECTED_TENSOR_SHAPE:
        raise ValueError(
            f"preprocessed tensor for {path} has shape {tensor.shape}, expected {EXPECTED_TENSOR_SHAPE}"
        )
    if tensor.size != EXPECTED_TENSOR_FLOATS or tensor.nbytes != EXPECTED_TENSOR_BYTES:
        raise ValueError(f"preprocessed tensor for {path} has an unexpected byte layout")
    if not np.isfinite(tensor).all():
        raise ValueError(f"preprocessed tensor for {path} contains non-finite values")
    return tensor


class OnnxCpuRunner:
    """Run the deployed scalar-logit ONNX model with CPUExecutionProvider."""

    def __init__(self, model_path: Path, input_name: str, output_name: str) -> None:
        import onnxruntime as ort

        self._input_name = input_name
        self._output_name = output_name
        self._session = ort.InferenceSession(
            str(model_path),
            providers=["CPUExecutionProvider"],
        )
        available_inputs = {value.name for value in self._session.get_inputs()}
        available_outputs = {value.name for value in self._session.get_outputs()}
        if input_name not in available_inputs:
            raise ValueError(
                f"deployed ONNX input {input_name!r} not found; available: {sorted(available_inputs)}"
            )
        if output_name not in available_outputs:
            raise ValueError(
                f"deployed ONNX output {output_name!r} not found; available: {sorted(available_outputs)}"
            )

    def run(self, tensor: np.ndarray) -> float:
        native_tensor = np.asarray(tensor, dtype=np.float32, order="C")
        output = self._session.run(
            [self._output_name],
            {self._input_name: native_tensor},
        )[0]
        logits = np.asarray(output, dtype=np.float32).reshape(-1)
        if logits.size != 1:
            raise ValueError(f"deployed ONNX returned {logits.size} logits, expected exactly one")
        logit = float(logits[0])
        if not math.isfinite(logit):
            raise ValueError(f"deployed ONNX returned a non-finite logit: {logit!r}")
        return logit


def _publish_staged_directory(stage: Path, output: Path) -> None:
    if not output.exists():
        os.replace(stage, output)
        return

    backup = output.parent / f".{output.name}.backup-{uuid.uuid4().hex}"
    os.replace(output, backup)
    try:
        os.replace(stage, output)
    except BaseException:
        os.replace(backup, output)
        raise
    else:
        shutil.rmtree(backup)


def _create_stage_directory(output: Path) -> Path:
    """Atomically reserve an inheritable sibling directory for staged output."""

    for _ in range(16):
        stage = output.parent / f".{output.name}.stage-{uuid.uuid4().hex}"
        try:
            # tempfile.mkdtemp uses mode 0o700. Python 3.12 maps that mode to a
            # restrictive Windows DACL which must not be inherited by the
            # published directory. A normal mkdir inherits the accessible
            # output parent's permissions while still reserving the name
            # atomically.
            stage.mkdir(mode=0o777)
        except FileExistsError:
            continue
        return stage
    raise FileExistsError(f"could not reserve a unique staging directory beside {output}")


def generate_parity_references(
    repository_root: Path = DEFAULT_REPOSITORY_ROOT,
    output_directory: Path | None = None,
    *,
    source_paths: Sequence[Path] | None = None,
    runner: LogitRunner | None = None,
) -> dict[str, object]:
    """Generate tensor binaries and deterministic metadata, then publish together."""

    root = Path(repository_root).resolve(strict=True)
    contract = _load_model_contract(root)
    selected_sources = collect_parity_inputs(root) if source_paths is None else list(source_paths)
    sources = _validated_sources(root, selected_sources)
    if not sources:
        raise ValueError("at least one parity source image is required")

    output_value = (
        root / "web_demo" / ".generated-tests" / "parity"
        if output_directory is None
        else Path(output_directory)
    )
    output = _validated_output_path(
        root,
        output_value,
        [Path(contract["path"]), *(path for _, _, path in sources)],
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    selected_runner = runner or OnnxCpuRunner(
        Path(contract["path"]),
        str(contract["input_name"]),
        str(contract["output_name"]),
    )
    stage = _create_stage_directory(output)

    try:
        tensor_directory = stage / "tensors"
        tensor_directory.mkdir()
        image_rows: list[dict[str, object]] = []

        for source_id, source, source_path in sources:
            original_dimensions, oriented_dimensions = _image_dimensions(source_path)
            tensor = _preprocess_tensor(source_path)
            reference = f"tensors/{source_id}.f32"
            reference_path = stage.joinpath(*PurePosixPath(reference).parts)
            tensor_bytes = tensor.tobytes(order="C")
            reference_path.write_bytes(tensor_bytes)

            logit = float(selected_runner.run(tensor))
            if not math.isfinite(logit):
                raise ValueError(f"inference runner returned a non-finite logit for {source}: {logit!r}")
            probability = stable_sigmoid(logit)
            threshold = float(contract["threshold"])
            image_rows.append(
                {
                    "id": source_id,
                    "source": source,
                    "reference": reference,
                    "original_dimensions": original_dimensions,
                    "oriented_dimensions": oriented_dimensions,
                    "tensor": {
                        "shape": list(EXPECTED_TENSOR_SHAPE),
                        "float_count": EXPECTED_TENSOR_FLOATS,
                        "bytes": len(tensor_bytes),
                        "sha256": hashlib.sha256(tensor_bytes).hexdigest(),
                    },
                    "logit": logit,
                    "probability": probability,
                    "label": "AIGC" if probability >= threshold else "Real",
                }
            )

        manifest: dict[str, object] = {
            "schema_version": 1,
            "preprocessing": "inference.preprocess_image",
            "tensor": {
                "shape": list(EXPECTED_TENSOR_SHAPE),
                "dtype": "float32",
                "byte_order": "little-endian",
                "layout": "NCHW",
                "float_count": EXPECTED_TENSOR_FLOATS,
                "bytes": EXPECTED_TENSOR_BYTES,
            },
            "model": {
                "source": contract["source"],
                "file": contract["file"],
                "bytes": contract["bytes"],
                "sha256": contract["sha256"],
                "input_name": contract["input_name"],
                "output_name": contract["output_name"],
            },
            "threshold": contract["threshold"],
            "images": image_rows,
        }
        encoded_manifest = (
            json.dumps(
                manifest,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
                allow_nan=False,
            )
            + "\n"
        ).encode("utf-8")
        (stage / "manifest.json").write_bytes(encoded_manifest)
        _publish_staged_directory(stage, output)
        return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate deterministic Pillow/FP32 ONNX browser parity references.",
    )
    parser.add_argument(
        "--repository-root",
        type=Path,
        default=DEFAULT_REPOSITORY_ROOT,
        help="Repository root. Defaults to the generator's repository.",
    )
    parser.add_argument(
        "--output",
        "--output-directory",
        dest="output_directory",
        type=Path,
        default=Path("web_demo/.generated-tests/parity"),
        help="Output directory, relative to the repository root by default.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    manifest = generate_parity_references(
        repository_root=args.repository_root,
        output_directory=args.output_directory,
    )
    output = args.output_directory
    if not output.is_absolute():
        output = args.repository_root / output
    print(f"Generated {len(manifest['images'])} parity references in {output.resolve()}")
    print(f"Model SHA-256: {manifest['model']['sha256']}")
    print(f"Threshold: {manifest['threshold']:.8f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
