import hashlib
import json
import unittest
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from web_demo.tools.verify_distribution import (
    FROZEN_CONTRACT,
    FROZEN_ORT_RUNTIME,
    FROZEN_ORT_RUNTIME_MJS,
    FrozenContract,
    FrozenOrtRuntime,
    verify_distribution,
)


TEST_MODEL = b"small deterministic ONNX stand-in\n"
TEST_MODEL_FILE = "tiny_fp32.onnx"
TEST_ORT_RUNTIME = b"small deterministic ORT runtime stand-in\n"
TEST_ORT_RUNTIME_PATH = "assets/ort-wasm-simd-threaded.asyncify.wasm"
TEST_ORT_RUNTIME_MJS = b"small deterministic ORT worker entrypoint stand-in\n"
TEST_ORT_RUNTIME_MJS_PATH = "assets/ort-wasm-simd-threaded.asyncify.mjs"


def _contract_for(
    model: bytes = TEST_MODEL,
    *,
    sha256: str | None = None,
    byte_count: int | None = None,
) -> FrozenContract:
    return FrozenContract(
        model_file=TEST_MODEL_FILE,
        model_bytes=len(model) if byte_count is None else byte_count,
        model_sha256=hashlib.sha256(model).hexdigest() if sha256 is None else sha256,
    )


def _runtime_contract_for(
    runtime: bytes = TEST_ORT_RUNTIME,
    *,
    sha256: str | None = None,
    byte_count: int | None = None,
) -> FrozenOrtRuntime:
    return FrozenOrtRuntime(
        path=TEST_ORT_RUNTIME_PATH,
        bytes=len(runtime) if byte_count is None else byte_count,
        sha256=hashlib.sha256(runtime).hexdigest() if sha256 is None else sha256,
    )


def _runtime_mjs_contract_for(
    runtime: bytes = TEST_ORT_RUNTIME_MJS,
    *,
    sha256: str | None = None,
    byte_count: int | None = None,
) -> FrozenOrtRuntime:
    return FrozenOrtRuntime(
        path=TEST_ORT_RUNTIME_MJS_PATH,
        bytes=len(runtime) if byte_count is None else byte_count,
        sha256=hashlib.sha256(runtime).hexdigest() if sha256 is None else sha256,
    )


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _dist_entries(dist: Path) -> list[dict[str, object]]:
    entries = []
    for path in sorted(
        candidate
        for candidate in dist.rglob("*")
        if candidate.is_file() and candidate.name != "integrity.json"
    ):
        content = path.read_bytes()
        entries.append(
            {
                "path": path.relative_to(dist).as_posix(),
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    return entries


def _write_valid_tree(
    root: Path,
    *,
    contract: FrozenContract | None = None,
    model: bytes = TEST_MODEL,
    runtime_contract: FrozenOrtRuntime | None = None,
    runtime: bytes = TEST_ORT_RUNTIME,
    runtime_mjs_contract: FrozenOrtRuntime | None = None,
    runtime_mjs: bytes = TEST_ORT_RUNTIME_MJS,
) -> FrozenContract:
    selected_contract = _contract_for(model) if contract is None else contract
    selected_runtime = (
        _runtime_contract_for(runtime) if runtime_contract is None else runtime_contract
    )
    selected_runtime_mjs = (
        _runtime_mjs_contract_for(runtime_mjs)
        if runtime_mjs_contract is None
        else runtime_mjs_contract
    )
    models = root / "web_demo" / "models"
    dist = root / "web_demo" / "dist"
    models.mkdir(parents=True)
    (dist / "assets").mkdir(parents=True)

    (models / selected_contract.model_file).write_bytes(model)
    _write_json(
        models / "manifest.json",
        {
            "schema_version": 1,
            "model": {
                "file": selected_contract.model_file,
                "bytes": selected_contract.model_bytes,
                "sha256": selected_contract.model_sha256,
            },
        },
    )
    (dist / "index.html").write_bytes(b"<!doctype html><title>demo</title>\n")
    (dist / "assets" / "app.js").write_bytes(b"console.log('demo');\n")
    runtime_path = dist.joinpath(*selected_runtime.path.split("/"))
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_path.write_bytes(runtime)
    runtime_mjs_path = dist.joinpath(*selected_runtime_mjs.path.split("/"))
    runtime_mjs_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_mjs_path.write_bytes(runtime_mjs)
    _write_json(
        dist / "integrity.json",
        {"schema_version": 1, "files": _dist_entries(dist)},
    )
    return selected_contract


def _verify_test_tree(
    root: Path,
    contract: FrozenContract,
    *,
    runtime_contract: FrozenOrtRuntime | None = None,
    runtime_mjs_contract: FrozenOrtRuntime | None = None,
) -> list[str]:
    return verify_distribution(
        root,
        contract=contract,
        runtime_contract=(
            _runtime_contract_for() if runtime_contract is None else runtime_contract
        ),
        runtime_mjs_contract=(
            _runtime_mjs_contract_for()
            if runtime_mjs_contract is None
            else runtime_mjs_contract
        ),
    )


class FrozenContractTests(unittest.TestCase):
    def test_default_contract_is_the_formal_deployed_model(self):
        self.assertEqual(FROZEN_CONTRACT.model_file, "baseline2_njr_fp32.onnx")
        self.assertEqual(FROZEN_CONTRACT.model_bytes, 88123029)
        self.assertEqual(
            FROZEN_CONTRACT.model_sha256,
            "e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69",
        )
        self.assertEqual(
            FROZEN_ORT_RUNTIME.path,
            "assets/ort-wasm-simd-threaded.asyncify.wasm",
        )
        self.assertEqual(FROZEN_ORT_RUNTIME.bytes, 25749873)
        self.assertEqual(
            FROZEN_ORT_RUNTIME.sha256,
            "503d17cb7411b79781b9fad1cf0978f03cf06b050c7d399c730e914f473bf549",
        )
        self.assertEqual(
            FROZEN_ORT_RUNTIME_MJS.path,
            "assets/ort-wasm-simd-threaded.asyncify.mjs",
        )
        self.assertEqual(FROZEN_ORT_RUNTIME_MJS.bytes, 51407)
        self.assertEqual(
            FROZEN_ORT_RUNTIME_MJS.sha256,
            "5d25483158d53d8f34d0e9c06a654d56c8dca4ebdf370ea0982ef11315a00e0e",
        )


class VerifyDistributionTests(unittest.TestCase):
    def test_accepts_a_small_self_consistent_distribution(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)

            self.assertEqual(_verify_test_tree(root, contract), [])

    def test_reports_wrong_model_byte_count(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _contract_for(byte_count=len(TEST_MODEL) + 1)
            _write_valid_tree(root, contract=contract)

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("model byte count" in error and str(len(TEST_MODEL) + 1) in error for error in errors),
            errors,
        )

    def test_reports_wrong_model_sha256(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _contract_for(sha256="0" * 64)
            _write_valid_tree(root, contract=contract)

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("model SHA-256" in error and "0" * 64 in error for error in errors),
            errors,
        )

    def test_reports_an_extra_onnx_file(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            (root / "web_demo" / "models" / "alternate.onnx").write_bytes(b"alternate")

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("exactly one .onnx" in error and "alternate.onnx" in error for error in errors),
            errors,
        )

    def test_identifies_a_git_lfs_pointer_as_an_incomplete_clone(self):
        pointer = (
            b"version https://git-lfs.github.com/spec/v1\n"
            b"oid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n"
            b"size 88123029\n"
        )
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _contract_for(pointer)
            _write_valid_tree(root, contract=contract, model=pointer)

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("Git LFS pointer" in error and "incomplete clone" in error for error in errors),
            errors,
        )

    def test_reports_missing_dist_integrity_json(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            (root / "web_demo" / "dist" / "integrity.json").unlink()

            errors = _verify_test_tree(root, contract)

        self.assertTrue(any("dist/integrity.json is missing" in error for error in errors), errors)

    def test_reports_a_mismatched_dist_entry(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            (root / "web_demo" / "dist" / "index.html").write_bytes(b"changed after hashing")

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("dist entry index.html" in error and "byte count" in error for error in errors),
            errors,
        )
        self.assertTrue(
            any("dist entry index.html" in error and "SHA-256" in error for error in errors),
            errors,
        )

    def test_reports_invalid_manifest_json_without_raising(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            (root / "web_demo" / "models" / "manifest.json").write_text(
                "{not valid JSON",
                encoding="utf-8",
            )

            errors = _verify_test_tree(root, contract)

        self.assertTrue(any("manifest.json is not valid JSON" in error for error in errors), errors)

    def test_rejects_integrity_paths_that_escape_dist(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            dist = root / "web_demo" / "dist"
            integrity = json.loads((dist / "integrity.json").read_text(encoding="utf-8"))
            integrity["files"].append(
                {"path": "../outside.js", "bytes": 0, "sha256": "0" * 64}
            )
            _write_json(dist / "integrity.json", integrity)

            errors = _verify_test_tree(root, contract)

        self.assertTrue(any("../outside.js" in error and "escapes" in error for error in errors), errors)

    def test_rejects_non_normalized_integrity_paths_that_stay_within_dist(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            dist = root / "web_demo" / "dist"
            integrity = json.loads((dist / "integrity.json").read_text(encoding="utf-8"))
            integrity["files"].append(
                {"path": "assets/../ghost.js", "bytes": 0, "sha256": "0" * 64}
            )
            _write_json(dist / "integrity.json", integrity)

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any(
                "assets/../ghost.js" in error and "normalized relative path" in error
                for error in errors
            ),
            errors,
        )

    def test_reports_an_extra_jsep_ort_runtime_even_when_integrity_is_current(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            dist = root / "web_demo" / "dist"
            (dist / "assets" / "ort-wasm-simd-threaded.jsep.wasm").write_bytes(b"duplicate")
            _write_json(
                dist / "integrity.json",
                {"schema_version": 1, "files": _dist_entries(dist)},
            )

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("approved ORT runtime" in error and "jsep.wasm" in error for error in errors),
            errors,
        )

    def test_reports_a_missing_ort_worker_entrypoint_even_when_integrity_is_current(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            dist = root / "web_demo" / "dist"
            (dist / "assets" / "ort-wasm-simd-threaded.asyncify.mjs").unlink()
            _write_json(
                dist / "integrity.json",
                {"schema_version": 1, "files": _dist_entries(dist)},
            )

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("ORT runtime" in error and "asyncify.mjs" in error and "missing" in error for error in errors),
            errors,
        )

    def test_reports_a_tampered_ort_worker_entrypoint_even_when_integrity_is_current(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            dist = root / "web_demo" / "dist"
            (dist / "assets" / "ort-wasm-simd-threaded.asyncify.mjs").write_bytes(
                b"tampered worker"
            )
            _write_json(
                dist / "integrity.json",
                {"schema_version": 1, "files": _dist_entries(dist)},
            )

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("ORT runtime byte count" in error and "asyncify.mjs" in error for error in errors),
            errors,
        )
        self.assertTrue(
            any("ORT runtime SHA-256" in error and "asyncify.mjs" in error for error in errors),
            errors,
        )

    def test_reports_an_unexpected_ort_mjs_variant_even_when_integrity_is_current(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            dist = root / "web_demo" / "dist"
            (dist / "assets" / "ort-wasm-simd-threaded.jsep.mjs").write_bytes(b"duplicate")
            _write_json(
                dist / "integrity.json",
                {"schema_version": 1, "files": _dist_entries(dist)},
            )

            errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("approved ORT runtime" in error and "jsep.mjs" in error for error in errors),
            errors,
        )

    def test_reports_wrong_ort_runtime_byte_count(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            runtime_contract = _runtime_contract_for(
                byte_count=len(TEST_ORT_RUNTIME) + 1,
            )

            errors = _verify_test_tree(
                root,
                contract,
                runtime_contract=runtime_contract,
            )

        self.assertTrue(
            any("ORT runtime byte count" in error for error in errors),
            errors,
        )

    def test_reports_wrong_ort_runtime_sha256(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            runtime_contract = _runtime_contract_for(sha256="0" * 64)

            errors = _verify_test_tree(
                root,
                contract,
                runtime_contract=runtime_contract,
            )

        self.assertTrue(
            any("ORT runtime SHA-256" in error and "0" * 64 in error for error in errors),
            errors,
        )

    def test_rejects_a_symlinked_ort_runtime(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            dist = root / "web_demo" / "dist"
            runtime_path = dist.joinpath(*TEST_ORT_RUNTIME_PATH.split("/"))
            outside = root / "outside-runtime.wasm"
            outside.write_bytes(TEST_ORT_RUNTIME)
            runtime_path.unlink()
            try:
                runtime_path.symlink_to(outside)
            except (NotImplementedError, OSError):
                runtime_path.write_bytes(TEST_ORT_RUNTIME)
                real_is_symlink = Path.is_symlink

                def filesystem_marks_runtime_as_symlink(path: Path) -> bool:
                    return path == runtime_path or real_is_symlink(path)

                symlink_context = patch.object(
                    Path,
                    "is_symlink",
                    filesystem_marks_runtime_as_symlink,
                )
            else:
                symlink_context = nullcontext()
            _write_json(
                dist / "integrity.json",
                {"schema_version": 1, "files": _dist_entries(dist)},
            )

            with symlink_context:
                errors = _verify_test_tree(root, contract)

        self.assertTrue(
            any("ORT runtime" in error and "symlink" in error for error in errors),
            errors,
        )


if __name__ == "__main__":
    unittest.main()
