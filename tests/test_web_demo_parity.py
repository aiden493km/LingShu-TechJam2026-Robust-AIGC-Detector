import hashlib
import json
import math
import shutil
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np

import inference
from web_demo.tools.generate_parity_references import (
    EXPECTED_TENSOR_BYTES,
    EXPECTED_TENSOR_FLOATS,
    EXPECTED_TENSOR_SHAPE,
    _validated_output_path,
    collect_parity_inputs,
    generate_parity_references,
    stable_sigmoid,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SOURCES = [
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
]


class DeterministicFakeRunner:
    def __init__(self) -> None:
        self.calls: list[np.ndarray] = []

    def run(self, tensor: np.ndarray) -> float:
        self.calls.append(tensor)
        return float(np.mean(tensor, dtype=np.float64))


class FailingRunner:
    def run(self, tensor: np.ndarray) -> float:
        raise RuntimeError("intentional inference failure")


def _relative_sources(paths: list[Path]) -> list[str]:
    return [path.relative_to(REPOSITORY_ROOT).as_posix() for path in paths]


def _tree_snapshot(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file())
    }


def _create_tiny_parity_repository(root: Path) -> Path:
    source = root / "demo_images" / "f1.png"
    source.parent.mkdir(parents=True)
    shutil.copyfile(REPOSITORY_ROOT / EXPECTED_SOURCES[0], source)

    model_bytes = b"deterministic fake ONNX bytes for generator tests\n"
    model_directory = root / "web_demo" / "models"
    model_directory.mkdir(parents=True)
    (model_directory / "tiny_fp32.onnx").write_bytes(model_bytes)
    (model_directory / "manifest.json").write_text(
        json.dumps(
            {
                "model": {
                    "file": "tiny_fp32.onnx",
                    "bytes": len(model_bytes),
                    "sha256": hashlib.sha256(model_bytes).hexdigest(),
                    "input": {
                        "name": "input",
                        "dtype": "float32",
                        "shape": [1, 3, 384, 384],
                    },
                    "output": {
                        "name": "logits",
                        "dtype": "float32",
                        "shape": [1, 1],
                    },
                },
                "threshold": {"aigc": 0.55657113},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return source


class ParityReferenceUnitTests(unittest.TestCase):
    def test_collects_all_fifteen_inputs_in_stable_repo_relative_order(self):
        paths = collect_parity_inputs(REPOSITORY_ROOT)

        self.assertEqual(_relative_sources(paths), EXPECTED_SOURCES)

    def test_stable_sigmoid_handles_extreme_logits_without_overflow(self):
        self.assertEqual(stable_sigmoid(-1000.0), 0.0)
        self.assertEqual(stable_sigmoid(1000.0), 1.0)
        self.assertEqual(stable_sigmoid(0.0), 0.5)

    def test_writes_little_endian_chw_tensors_and_complete_metadata(self):
        runner = DeterministicFakeRunner()
        real_preprocess = inference.preprocess_image
        preprocess_calls: list[Path] = []

        def tracked_preprocess(path: Path):
            preprocess_calls.append(path)
            return real_preprocess(path)

        with TemporaryDirectory() as temporary_directory, patch.object(
            inference,
            "preprocess_image",
            side_effect=tracked_preprocess,
        ), patch.object(
            inference,
            "load_model",
            side_effect=AssertionError("the PyTorch checkpoint must not be loaded"),
        ):
            output = Path(temporary_directory) / "parity"
            manifest = generate_parity_references(
                REPOSITORY_ROOT,
                output,
                runner=runner,
            )

            on_disk = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(on_disk, manifest)
            self.assertEqual(manifest["schema_version"], 1)
            self.assertEqual(manifest["tensor"]["shape"], list(EXPECTED_TENSOR_SHAPE))
            self.assertEqual(manifest["tensor"]["dtype"], "float32")
            self.assertEqual(manifest["tensor"]["byte_order"], "little-endian")
            self.assertEqual(manifest["tensor"]["layout"], "NCHW")
            self.assertEqual(manifest["model"]["input_name"], "input")
            self.assertEqual(manifest["model"]["output_name"], "logits")
            self.assertEqual(
                manifest["model"]["sha256"],
                "e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69",
            )
            self.assertEqual(manifest["threshold"], 0.55657113)
            self.assertEqual(len(manifest["images"]), 15)
            self.assertEqual([row["source"] for row in manifest["images"]], EXPECTED_SOURCES)
            self.assertEqual(_relative_sources(preprocess_calls), EXPECTED_SOURCES)
            self.assertEqual(len(runner.calls), 15)

            for row, observed_tensor in zip(manifest["images"], runner.calls):
                reference_path = output / row["reference"]
                reference_bytes = reference_path.read_bytes()
                self.assertEqual(row["tensor"]["shape"], list(EXPECTED_TENSOR_SHAPE))
                self.assertEqual(row["tensor"]["float_count"], EXPECTED_TENSOR_FLOATS)
                self.assertEqual(row["tensor"]["bytes"], EXPECTED_TENSOR_BYTES)
                self.assertEqual(len(reference_bytes), EXPECTED_TENSOR_BYTES)
                self.assertEqual(
                    row["tensor"]["sha256"],
                    hashlib.sha256(reference_bytes).hexdigest(),
                )
                self.assertEqual(observed_tensor.shape, EXPECTED_TENSOR_SHAPE)
                self.assertEqual(observed_tensor.dtype, np.dtype("<f4"))
                reconstructed = np.frombuffer(reference_bytes, dtype="<f4")
                self.assertEqual(reconstructed.size, EXPECTED_TENSOR_FLOATS)
                self.assertTrue(np.array_equal(reconstructed, observed_tensor.reshape(-1)))
                self.assertTrue(math.isfinite(row["logit"]))
                self.assertGreaterEqual(row["probability"], 0.0)
                self.assertLessEqual(row["probability"], 1.0)
                self.assertEqual(
                    row["label"],
                    "AIGC" if row["probability"] >= manifest["threshold"] else "Real",
                )

            exif_row = next(
                row for row in manifest["images"] if row["source"].endswith("exif-orientation-6.jpg")
            )
            self.assertEqual(exif_row["original_dimensions"], {"width": 120, "height": 80})
            self.assertEqual(exif_row["oriented_dimensions"], {"width": 80, "height": 120})

    def test_generating_twice_is_byte_identical(self):
        with TemporaryDirectory() as temporary_directory:
            repository = Path(temporary_directory) / "repo"
            source = _create_tiny_parity_repository(repository)
            output = repository / "web_demo" / ".generated-tests" / "parity"

            generate_parity_references(
                repository,
                output,
                source_paths=[source],
                runner=DeterministicFakeRunner(),
            )
            first_snapshot = _tree_snapshot(output)
            generate_parity_references(
                repository,
                output,
                source_paths=[source],
                runner=DeterministicFakeRunner(),
            )

            self.assertEqual(first_snapshot, _tree_snapshot(output))

    def test_stage_creation_does_not_use_restricted_tempfile_mkdtemp(self):
        source = REPOSITORY_ROOT / EXPECTED_SOURCES[0]
        with TemporaryDirectory() as temporary_directory, patch.object(
            tempfile,
            "mkdtemp",
            side_effect=AssertionError("restricted tempfile directory ACL must not be published"),
        ):
            output = Path(temporary_directory) / "parity"

            manifest = generate_parity_references(
                REPOSITORY_ROOT,
                output,
                source_paths=[source],
                runner=DeterministicFakeRunner(),
            )

            self.assertEqual(len(manifest["images"]), 1)
            self.assertTrue((output / "manifest.json").is_file())

    def test_creates_missing_output_parent_directories(self):
        source = REPOSITORY_ROOT / EXPECTED_SOURCES[0]
        with TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "new" / "nested" / "parity"

            manifest = generate_parity_references(
                REPOSITORY_ROOT,
                output,
                source_paths=[source],
                runner=DeterministicFakeRunner(),
            )

            self.assertEqual(len(manifest["images"]), 1)
            self.assertTrue((output / "manifest.json").is_file())

    def test_rejects_an_existing_tracked_repository_directory_as_output(self):
        tracked_directory = REPOSITORY_ROOT / "web_demo" / "src"

        with self.assertRaisesRegex(ValueError, "strictly below.*[.]generated-tests"):
            _validated_output_path(REPOSITORY_ROOT, tracked_directory, [])

        self.assertTrue((tracked_directory / "App.tsx").is_file())

    def test_rejects_the_generated_tests_container_itself_as_output(self):
        generated_tests = REPOSITORY_ROOT / "web_demo" / ".generated-tests"

        with self.assertRaisesRegex(ValueError, "strictly below.*[.]generated-tests"):
            _validated_output_path(REPOSITORY_ROOT, generated_tests, [])

    def test_allows_a_descendant_of_the_generated_tests_container(self):
        output = REPOSITORY_ROOT / "web_demo" / ".generated-tests" / "parity-safe-child"

        self.assertEqual(
            _validated_output_path(REPOSITORY_ROOT, output, []),
            output.resolve(strict=False),
        )

    def test_rejects_a_repository_symlink_parent_that_escapes_generated_tests(self):
        with TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository = temporary_root / "repo"
            generated_tests = repository / "web_demo" / ".generated-tests"
            generated_tests.mkdir(parents=True)
            outside = temporary_root / "outside"
            outside.mkdir()
            linked_parent = generated_tests / "linked-parent"

            try:
                linked_parent.symlink_to(outside, target_is_directory=True)
            except OSError:
                real_resolve = Path.resolve

                def simulate_parent_symlink(path: Path, strict: bool = False) -> Path:
                    if path == linked_parent:
                        return outside
                    return real_resolve(path, strict=strict)

                symlink_context = patch.object(Path, "resolve", simulate_parent_symlink)
            else:
                symlink_context = nullcontext()

            with symlink_context, self.assertRaisesRegex(ValueError, "symlink.*escapes"):
                _validated_output_path(repository.resolve(), linked_parent / "parity", [])

    def test_rejects_a_generated_tests_root_redirected_to_a_tracked_directory(self):
        with TemporaryDirectory() as temporary_directory:
            repository = (Path(temporary_directory) / "repo").resolve()
            tracked_directory = repository / "web_demo" / "src"
            tracked_directory.mkdir(parents=True)
            generated_tests = repository / "web_demo" / ".generated-tests"

            try:
                generated_tests.symlink_to(tracked_directory, target_is_directory=True)
            except OSError:
                real_resolve = Path.resolve

                def simulate_redirected_root(path: Path, strict: bool = False) -> Path:
                    if path == generated_tests:
                        return tracked_directory
                    return real_resolve(path, strict=strict)

                redirect_context = patch.object(Path, "resolve", simulate_redirected_root)
            else:
                redirect_context = nullcontext()

            with redirect_context, self.assertRaisesRegex(
                ValueError,
                "[.]generated-tests.*redirected",
            ):
                _validated_output_path(repository, generated_tests / "parity", [])

    def test_rejects_a_generated_tests_junction_even_without_resolve_drift(self):
        with TemporaryDirectory() as temporary_directory:
            repository = (Path(temporary_directory) / "repo").resolve()
            generated_tests = repository / "web_demo" / ".generated-tests"
            generated_tests.mkdir(parents=True)
            real_is_junction = Path.is_junction

            def mark_generated_tests_as_junction(path: Path) -> bool:
                return path == generated_tests or real_is_junction(path)

            with patch.object(Path, "is_junction", mark_generated_tests_as_junction), self.assertRaisesRegex(
                ValueError,
                "[.]generated-tests.*redirected",
            ):
                _validated_output_path(repository, generated_tests / "parity", [])

    def test_rejects_an_external_output_that_contains_a_protected_file(self):
        with TemporaryDirectory() as temporary_directory:
            repository = Path(temporary_directory) / "repo"
            output = repository / "web_demo" / ".generated-tests" / "output"
            protected = output / "deployed-model.onnx"
            protected.parent.mkdir(parents=True)
            protected.write_bytes(b"protected")

            with self.assertRaisesRegex(ValueError, "source/model files"):
                _validated_output_path(repository, output, [protected])

    def test_rejects_an_existing_external_directory_and_preserves_its_contents(self):
        source = REPOSITORY_ROOT / EXPECTED_SOURCES[0]
        with TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "external-output"
            output.mkdir()
            important = output / "important.txt"
            important.write_bytes(b"must survive\n")

            with self.assertRaisesRegex(ValueError, "external output.*must not already exist"):
                generate_parity_references(
                    REPOSITORY_ROOT,
                    output,
                    source_paths=[source],
                    runner=DeterministicFakeRunner(),
                )

            self.assertEqual(_tree_snapshot(output), {"important.txt": b"must survive\n"})

    def test_rejects_an_existing_external_file_and_preserves_it(self):
        source = REPOSITORY_ROOT / EXPECTED_SOURCES[0]
        with TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "important.txt"
            output.write_bytes(b"must survive\n")

            with self.assertRaisesRegex(ValueError, "external output.*must not already exist"):
                generate_parity_references(
                    REPOSITORY_ROOT,
                    output,
                    source_paths=[source],
                    runner=DeterministicFakeRunner(),
                )

            self.assertEqual(output.read_bytes(), b"must survive\n")

    def test_rejects_a_source_path_that_escapes_the_repository(self):
        with TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            outside = temporary_root / "outside.png"
            outside.write_bytes(b"not read because containment validation runs first")

            with self.assertRaisesRegex(ValueError, "escapes repository root"):
                generate_parity_references(
                    REPOSITORY_ROOT,
                    temporary_root / "output",
                    source_paths=[outside],
                    runner=DeterministicFakeRunner(),
                )

    def test_rejects_duplicate_source_ids_before_writing(self):
        source = REPOSITORY_ROOT / EXPECTED_SOURCES[0]
        with TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "output"

            with self.assertRaisesRegex(ValueError, "duplicate parity source id"):
                generate_parity_references(
                    REPOSITORY_ROOT,
                    output,
                    source_paths=[source, source],
                    runner=DeterministicFakeRunner(),
                )

            self.assertFalse(output.exists())

    def test_failed_generation_does_not_publish_a_partial_manifest(self):
        source = REPOSITORY_ROOT / EXPECTED_SOURCES[0]
        with TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "output"

            with self.assertRaisesRegex(RuntimeError, "intentional inference failure"):
                generate_parity_references(
                    REPOSITORY_ROOT,
                    output,
                    source_paths=[source],
                    runner=FailingRunner(),
                )

            self.assertFalse(output.exists())
            self.assertEqual(list(Path(temporary_directory).glob(".output.stage-*")), [])


class ParityReferenceOnnxIntegrationTests(unittest.TestCase):
    def test_deployed_onnx_generates_fifteen_scores_including_near_threshold_case(self):
        model = REPOSITORY_ROOT / "web_demo" / "models" / "baseline2_njr_fp32.onnx"
        self.assertTrue(model.is_file(), f"deployed ONNX model is missing: {model}")

        with TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "parity"
            manifest = generate_parity_references(REPOSITORY_ROOT, output)

            self.assertEqual(len(manifest["images"]), 15)
            self.assertEqual([row["source"] for row in manifest["images"]], EXPECTED_SOURCES)
            for row in manifest["images"]:
                self.assertTrue(math.isfinite(row["logit"]))
                self.assertGreaterEqual(row["probability"], 0.0)
                self.assertLessEqual(row["probability"], 1.0)

            near_threshold = next(
                row
                for row in manifest["images"]
                if row["source"].endswith("near-threshold-synthetic.png")
            )
            self.assertLessEqual(
                abs(near_threshold["probability"] - manifest["threshold"]),
                0.05,
            )
            self.assertEqual(
                near_threshold["label"],
                "AIGC" if near_threshold["probability"] >= manifest["threshold"] else "Real",
            )


if __name__ == "__main__":
    unittest.main()
