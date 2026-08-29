import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from web_demo.tools.verify_distribution import (
    FROZEN_CONTRACT,
    FrozenContract,
    verify_distribution,
)


TEST_MODEL = b"small deterministic ONNX stand-in\n"
TEST_MODEL_FILE = "tiny_fp32.onnx"


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
) -> FrozenContract:
    selected_contract = _contract_for(model) if contract is None else contract
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
    _write_json(
        dist / "integrity.json",
        {"schema_version": 1, "files": _dist_entries(dist)},
    )
    return selected_contract


class FrozenContractTests(unittest.TestCase):
    def test_default_contract_is_the_formal_deployed_model(self):
        self.assertEqual(FROZEN_CONTRACT.model_file, "baseline2_njr_fp32.onnx")
        self.assertEqual(FROZEN_CONTRACT.model_bytes, 88123029)
        self.assertEqual(
            FROZEN_CONTRACT.model_sha256,
            "e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69",
        )


class VerifyDistributionTests(unittest.TestCase):
    def test_accepts_a_small_self_consistent_distribution(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)

            self.assertEqual(verify_distribution(root, contract=contract), [])

    def test_reports_wrong_model_byte_count(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _contract_for(byte_count=len(TEST_MODEL) + 1)
            _write_valid_tree(root, contract=contract)

            errors = verify_distribution(root, contract=contract)

        self.assertTrue(
            any("model byte count" in error and str(len(TEST_MODEL) + 1) in error for error in errors),
            errors,
        )

    def test_reports_wrong_model_sha256(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _contract_for(sha256="0" * 64)
            _write_valid_tree(root, contract=contract)

            errors = verify_distribution(root, contract=contract)

        self.assertTrue(
            any("model SHA-256" in error and "0" * 64 in error for error in errors),
            errors,
        )

    def test_reports_an_extra_onnx_file(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            (root / "web_demo" / "models" / "alternate.onnx").write_bytes(b"alternate")

            errors = verify_distribution(root, contract=contract)

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

            errors = verify_distribution(root, contract=contract)

        self.assertTrue(
            any("Git LFS pointer" in error and "incomplete clone" in error for error in errors),
            errors,
        )

    def test_reports_missing_dist_integrity_json(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            (root / "web_demo" / "dist" / "integrity.json").unlink()

            errors = verify_distribution(root, contract=contract)

        self.assertTrue(any("dist/integrity.json is missing" in error for error in errors), errors)

    def test_reports_a_mismatched_dist_entry(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            contract = _write_valid_tree(root)
            (root / "web_demo" / "dist" / "index.html").write_bytes(b"changed after hashing")

            errors = verify_distribution(root, contract=contract)

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

            errors = verify_distribution(root, contract=contract)

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

            errors = verify_distribution(root, contract=contract)

        self.assertTrue(any("../outside.js" in error and "escapes" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
