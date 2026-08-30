import hashlib
import tarfile
import unittest
import zipfile
from pathlib import Path


class PortableRuntimeArtifactTests(unittest.TestCase):
    REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
    RUNTIME_ARTIFACTS = {
        "windows-x86_64-python.zip": {
            "bytes": 11_133_606,
            "sha256": "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3",
            "entrypoint": "python.exe",
        },
        "macos-arm64-python.tar.gz": {
            "bytes": 24_970_238,
            "sha256": "8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6",
            "entrypoint": "python/bin/python3",
        },
    }
    TOTAL_RUNTIME_BYTES = 36_103_844
    MODEL_BYTES = 88_123_029
    MODEL_SHA256 = "e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69"
    MODEL_ARTIFACT_SUFFIXES = {
        ".bin",
        ".ckpt",
        ".engine",
        ".onnx",
        ".pb",
        ".pt",
        ".pth",
        ".safetensors",
        ".tflite",
    }

    @staticmethod
    def _sha256(path):
        digest = hashlib.sha256()
        with path.open("rb") as artifact:
            for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def test_portable_runtime_artifacts_match_expected_identity(self):
        runtime_dir = self.REPOSITORY_ROOT / "web_demo" / "runtimes"
        total_bytes = 0

        for filename, expected in self.RUNTIME_ARTIFACTS.items():
            with self.subTest(filename=filename):
                artifact_path = runtime_dir / filename
                self.assertTrue(artifact_path.is_file(), f"missing runtime artifact: {filename}")
                self.assertEqual(expected["bytes"], artifact_path.stat().st_size)
                self.assertEqual(expected["sha256"], self._sha256(artifact_path))

                if filename.endswith(".zip"):
                    with zipfile.ZipFile(artifact_path) as archive:
                        members = archive.namelist()
                else:
                    with tarfile.open(artifact_path, "r:gz") as archive:
                        members = archive.getnames()

                self.assertIn(expected["entrypoint"], members)
                total_bytes += artifact_path.stat().st_size

        self.assertEqual(self.TOTAL_RUNTIME_BYTES, total_bytes)

    def test_baseline_model_matches_expected_identity(self):
        model_path = self.REPOSITORY_ROOT / "web_demo" / "models" / "baseline2_njr_fp32.onnx"
        self.assertEqual(self.MODEL_BYTES, model_path.stat().st_size)
        self.assertEqual(self.MODEL_SHA256, self._sha256(model_path))

    def test_models_do_not_include_quantized_variants(self):
        model_dir = self.REPOSITORY_ROOT / "web_demo" / "models"
        forbidden_tokens = ("fp16", "int8", "quant")
        unexpected = sorted(
            path.relative_to(model_dir).as_posix()
            for path in model_dir.rglob("*")
            if path.is_file()
            and path.suffix.lower() in self.MODEL_ARTIFACT_SUFFIXES
            and any(token in path.name.lower() for token in forbidden_tokens)
        )
        self.assertEqual([], unexpected)


if __name__ == "__main__":
    unittest.main()
