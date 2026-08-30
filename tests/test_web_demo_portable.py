import hashlib
import re
import subprocess
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
    MODEL_ARTIFACTS = {"baseline2_njr_fp32.onnx"}
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
    ORIGINAL_POSIX_SUFFIX = br'''
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "$SCRIPT_DIR" ]; then
  printf '%s\n' 'ERROR: Could not resolve the WebDemo directory.' >&2
  exit 1
fi

cd "$SCRIPT_DIR" || {
  printf '%s\n' "ERROR: Could not open the WebDemo directory: $SCRIPT_DIR" >&2
  exit 1
}

if python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' >/dev/null 2>&1; then
  exec python3 tools/serve_demo.py "$@"
  exit $?
fi

if python -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' >/dev/null 2>&1; then
  exec python tools/serve_demo.py "$@"
  exit $?
fi

printf '%s\n' \
  'ERROR: Python 3.11+ is required to launch the LingShu WebDemo.' \
  'Install Python 3.11 or newer, then try start-demo.sh again.' \
  'Manual command from the repository root:' \
  '  python web_demo/tools/serve_demo.py' >&2
exit 1
'''

    def test_windows_batch_is_exact_thin_bootstrap_wrapper(self):
        launcher = self.REPOSITORY_ROOT / "web_demo" / "start-demo.bat"
        expected = "\n".join(
            (
                "@echo off",
                "setlocal DisableDelayedExpansion",
                'set "BOOTSTRAP=%~dp0tools\\bootstrap_windows.ps1"',
                '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%BOOTSTRAP%" %*',
                'set "DEMO_EXIT=%ERRORLEVEL%"',
                'if not "%DEMO_EXIT%"=="0" if "%~1"=="" pause',
                "endlocal & exit /b %DEMO_EXIT%",
                "",
            )
        )
        content = launcher.read_text(encoding="utf-8")

        self.assertEqual(content, expected)
        self.assertIsNone(
            re.search(r"(?<![A-Za-z0-9_-])(?:py|python|pip)(?:\.exe)?(?![A-Za-z0-9_-])", content, re.I)
        )
        self.assertNotRegex(content, r"(?i)download|invoke-webrequest|curl|wget")

    def test_windows_bootstrap_pins_runtime_artifact(self):
        bootstrap = self.REPOSITORY_ROOT / "web_demo" / "tools" / "bootstrap_windows.ps1"
        self.assertTrue(bootstrap.is_file(), bootstrap)
        content = bootstrap.read_text(encoding="utf-8")
        expected_pins = (
            '$ArchiveName = "windows-x86_64-python.zip"',
            "$ExpectedBytes = 11133606",
            '$ExpectedSha256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"',
            '$CacheName = "windows-x86_64-4acbed6dd1c7"',
            '$Entrypoint = "python.exe"',
        )
        self.assertEqual(content.splitlines()[:5], list(expected_pins))

    def test_macos_launchers_are_lf_only_and_git_executable(self):
        relative_paths = (
            "web_demo/start-demo.sh",
            "web_demo/start-demo.command",
            "web_demo/tools/bootstrap_macos.sh",
        )
        for relative_path in relative_paths:
            with self.subTest(path=relative_path):
                path = self.REPOSITORY_ROOT / relative_path
                self.assertTrue(path.is_file(), path)
                content = path.read_bytes()
                self.assertNotIn(b"\r", content)
                self.assertTrue(content.endswith(b"\n"))

                result = subprocess.run(
                    ["git", "ls-files", "--stage", "--", relative_path],
                    cwd=self.REPOSITORY_ROOT,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertRegex(
                    result.stdout,
                    rf"^100755 [0-9a-f]+ 0\s+{re.escape(relative_path)}\s*$",
                )

    def test_macos_command_is_exact_thin_bootstrap_wrapper(self):
        launcher = self.REPOSITORY_ROOT / "web_demo" / "start-demo.command"
        self.assertTrue(launcher.is_file(), launcher)
        expected = """#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd) || exit 1
"$SCRIPT_DIR/tools/bootstrap_macos.sh" "$@"
status=$?
if [ "$status" -ne 0 ] && [ "$#" -eq 0 ]; then
  printf '%s' 'Press Return to close this window...'
  IFS= read -r _
fi
exit "$status"
"""

        self.assertEqual(launcher.read_text(encoding="utf-8"), expected)

    def test_macos_bootstrap_pins_runtime_and_uses_only_stock_tools(self):
        bootstrap = self.REPOSITORY_ROOT / "web_demo" / "tools" / "bootstrap_macos.sh"
        self.assertTrue(bootstrap.is_file(), bootstrap)
        content = bootstrap.read_text(encoding="utf-8")
        expected_pins = (
            "ARCHIVE_NAME='macos-arm64-python.tar.gz'",
            "EXPECTED_BYTES='24970238'",
            "EXPECTED_SHA256='8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6'",
            "CACHE_NAME='macos-arm64-8b0f1fa71eab'",
            "ENTRYPOINT='python/bin/python3'",
        )
        self.assertEqual(content.splitlines()[1:6], list(expected_pins))
        self.assertEqual(content.splitlines()[0], "#!/bin/sh")

        self.assertIsNone(
            re.search(r"(?i)(?:\bcurl\b|\bwget\b|\bpip3?\b|\bsudo\b|\bxattr\b|https?://|download)", content)
        )
        self.assertIsNone(
            re.search(r"(?m)^[ \t]*(?:command[ \t]+-v[ \t]+)?(?:/usr/bin/)?python(?:3(?:\.\d+)*)?[ \t]", content)
        )
        self.assertIsNone(re.search(r"(?m)(?<![>&])&[ \t]*(?:#.*)?$", content))
        for tool in (
            "/usr/bin/uname",
            "/usr/sbin/sysctl",
            "/usr/bin/stat",
            "/usr/bin/shasum",
            "/usr/bin/tar",
            "/bin/mv",
        ):
            self.assertIn(tool, content)

    def test_macos_bootstrap_uses_kernel_lock_file_descriptor(self):
        bootstrap = self.REPOSITORY_ROOT / "web_demo" / "tools" / "bootstrap_macos.sh"
        content = bootstrap.read_text(encoding="utf-8")

        for fragment in (
            'exec 9>>"$lock_path"',
            '/usr/bin/lockf -s -t 8 9',
            'exec 9>&-',
        ):
            self.assertIn(fragment, content)
        for forbidden in (
            ".owner",
            ".stale-",
            "owner_pid",
            "lock_token",
            '/bin/kill -0',
            '/bin/mv "$lock_path"',
        ):
            self.assertNotIn(forbidden, content)

    def test_posix_launcher_only_adds_exact_darwin_preamble(self):
        launcher = self.REPOSITORY_ROOT / "web_demo" / "start-demo.sh"
        preamble = b'''\
if [ "$(/usr/bin/uname -s 2>/dev/null)" = "Darwin" ]; then
  SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd) || exit 1
  exec "$SCRIPT_DIR/tools/bootstrap_macos.sh" "$@"
fi
'''
        expected = b"#!/bin/sh\n" + preamble + self.ORIGINAL_POSIX_SUFFIX

        self.assertEqual(launcher.read_bytes(), expected)

    @staticmethod
    def _sha256(path):
        digest = hashlib.sha256()
        with path.open("rb") as artifact:
            for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def test_portable_runtime_artifacts_match_expected_identity(self):
        runtime_dir = self.REPOSITORY_ROOT / "web_demo" / "runtimes"
        actual_artifacts = {
            path.relative_to(runtime_dir).as_posix()
            for path in runtime_dir.rglob("*")
            if path.is_file()
        }
        self.assertEqual(set(self.RUNTIME_ARTIFACTS), actual_artifacts)
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

    def test_models_only_include_expected_artifacts(self):
        model_dir = self.REPOSITORY_ROOT / "web_demo" / "models"
        actual_artifacts = {
            path.relative_to(model_dir).as_posix()
            for path in model_dir.rglob("*")
            if path.is_file()
            and path.suffix.lower() in self.MODEL_ARTIFACT_SUFFIXES
        }
        self.assertEqual(self.MODEL_ARTIFACTS, actual_artifacts)


if __name__ == "__main__":
    unittest.main()
