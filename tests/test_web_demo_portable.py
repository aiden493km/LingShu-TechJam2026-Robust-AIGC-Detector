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

    def test_macos_bootstrap_uses_compatible_kernel_lock_command(self):
        bootstrap = self.REPOSITORY_ROOT / "web_demo" / "tools" / "bootstrap_macos.sh"
        content = bootstrap.read_text(encoding="utf-8")

        for fragment in (
            '/usr/bin/env "LINGSHU_MACOS_CACHE_TOKEN=$cache_phase_token"',
            '/usr/bin/lockf -s -t 8 -k "$lock_path"',
            '"$bootstrap_script" --internal-cache-phase "$cache_phase_token"',
            'if [ "${1-}" = \'--internal-cache-phase\' ] && [ -n "${LINGSHU_MACOS_CACHE_TOKEN-}" ]; then',
            '64|69|70|71|73)',
            'Could not acquire/use the macOS runtime cache lock: $lock_path (lockf status $cache_phase_status).',
        ):
            self.assertIn(fragment, content)
        for forbidden in (
            "exec 9",
            "/usr/bin/lockf -s -t 8 9",
            ".owner",
            ".stale-",
            "owner_pid",
            "lock_token",
            '/bin/kill -0',
            '/bin/mv "$lock_path"',
        ):
            self.assertNotIn(forbidden, content)

    def test_macos_bootstrap_normalizes_kernel_lock_diagnostics(self):
        bootstrap = self.REPOSITORY_ROOT / "web_demo" / "tools" / "bootstrap_macos.sh"
        content = bootstrap.read_text(encoding="utf-8")

        for fragment in (
            "lock_error_file=''",
            'lock_error_file=$(/usr/bin/mktemp "$cache_root/$CACHE_NAME.lock-error.XXXXXXXX")',
            '2>"$lock_error_file"',
            '/bin/cat "$lock_error_file" >&2',
            '/bin/rm -f "$lock_error_file"',
            "Internal macOS runtime cache phase failed without diagnostics",
        ):
            self.assertIn(fragment, content)

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


class PortableDocumentationAndWorkflowTests(unittest.TestCase):
    REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
    TASK4_COMMIT = "3036c0cad46934aa83ac4fe0574b99e6cd99a1fa"
    GIT_ATTRIBUTES = (
        "web_demo/models/baseline2_njr_fp32.onnx binary -diff -merge",
        "web_demo/dist/** -text",
        "web_demo/dist/assets/ort-wasm-simd-threaded.asyncify.mjs binary -diff -merge",
        "web_demo/dist/assets/ort-wasm-simd-threaded.asyncify.wasm binary -diff -merge",
        "web_demo/runtimes/windows-x86_64-python.zip binary -diff -merge",
        "web_demo/runtimes/macos-arm64-python.tar.gz binary -diff -merge",
        "web_demo/start-demo.bat text eol=crlf",
        "web_demo/start-demo.sh text eol=lf",
        "web_demo/start-demo.command text eol=lf",
        "web_demo/tools/bootstrap_macos.sh text eol=lf",
    )

    @classmethod
    def setUpClass(cls):
        cls.root_readme = (cls.REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")
        cls.web_readme = (cls.REPOSITORY_ROOT / "web_demo" / "README.md").read_text(
            encoding="utf-8"
        )

    @staticmethod
    def _single_line(text):
        return re.sub(r"\s+", " ", text).strip()

    def assertDocumentsRegex(self, pattern, message):
        for name, content in (
            ("README.md", self.root_readme),
            ("web_demo/README.md", self.web_readme),
        ):
            with self.subTest(readme=name, requirement=message):
                self.assertRegex(self._single_line(content), pattern, message)

    def test_judge_quick_starts_are_ordered_and_portable(self):
        for name, content in (
            ("README.md", self.root_readme),
            ("web_demo/README.md", self.web_readme),
        ):
            with self.subTest(readme=name):
                normalized = self._single_line(content)
                self.assertIn("start-demo.bat", normalized)
                self.assertIn("start-demo.command", normalized)
                self.assertRegex(
                    normalized,
                    r"(?i)clone.*double-click.*READY.*(?:choose|select).*image",
                )

        self.assertDocumentsRegex(r"(?i)bundled", "the bundled runtime must be explicit")
        self.assertDocumentsRegex(r"(?i)offline", "the offline launch must be explicit")
        self.assertDocumentsRegex(
            r"(?i)(?:do not|does not|no)[^.]{0,100}(?:install|installation)[^.]{0,100}Python",
            "judges must not be told to install Python",
        )
        self.assertDocumentsRegex(
            r"(?i)(?:do not|does not|no)[^.]{0,120}(?:Node(?:\.js)?|npm|packages?)",
            "judges must not be told to install Node or packages",
        )
        self.assertDocumentsRegex(
            r"(?i)(?:do not|does not|no)[^.]{0,120}(?:inference )?server",
            "judges must not be told to provision an inference server",
        )
        self.assertDocumentsRegex(r"(?i)Windows[^.]{0,80}x86-64", "Windows architecture is bounded")
        self.assertDocumentsRegex(
            r"(?i)(?:Apple Silicon|macOS[^.]{0,80}(?:arm64|ARM64))",
            "the packaged macOS architecture is bounded",
        )
        self.assertDocumentsRegex(
            r"(?i)Intel macOS[^.]{0,120}(?:not (?:bundled|packaged)|no bundled runtime)",
            "Intel macOS must be identified as outside this portable slice",
        )

    def test_judge_docs_describe_the_frozen_local_contract(self):
        self.assertDocumentsRegex(r"baseline2_njr_fp32\.onnx", "the exact FP32 model is named")
        self.assertDocumentsRegex(r"0\.55657113", "the frozen threshold is named")
        self.assertDocumentsRegex(
            r"(?i)web_demo/\.runtime-cache/",
            "the repository-local runtime cache path is documented",
        )
        self.assertDocumentsRegex(
            r"(?i)(?:first|initial).{0,120}(?:create|extract|populate).{0,120}cache",
            "first-launch cache creation is explained",
        )
        self.assertDocumentsRegex(
            r"(?i)(?:later|subsequent|next)[^.]{0,120}(?:reuse|reuses|reused)[^.]{0,120}cache",
            "later cache reuse is explained",
        )
        self.assertDocumentsRegex(
            r"8765[^.]{0,40}8784[^.]{0,120}(?:ephemeral|operating system)",
            "automatic loopback port fallback is documented",
        )
        self.assertDocumentsRegex(
            r"(?i)(?:127\.0\.0\.1|loopback-only|loopback only).{0,200}(?:private|privacy|upload|external)",
            "loopback-only privacy is documented",
        )
        self.assertDocumentsRegex(r"Ctrl\+C", "the keyboard stop path is documented")
        self.assertDocumentsRegex(
            r"(?i)(?:close|closing)[^.]{0,80}(?:launcher )?window[^.]{0,80}stop",
            "the window stop path is documented",
        )
        self.assertDocumentsRegex(r"--check", "the integrity-only mode is documented")
        self.assertDocumentsRegex(r"--no-browser", "the no-browser mode is documented")

    def test_macos_gatekeeper_guidance_uses_supported_ui_flow(self):
        normalized = self._single_line(self.web_readme)
        self.assertRegex(
            normalized,
            r"(?i)System Settings[^.]{0,80}Privacy\s*(?:&|and)\s*Security[^.]{0,80}Open Anyway",
        )
        self.assertRegex(normalized, r"(?i)bundled interpreter")
        gatekeeper_start = normalized.lower().find("gatekeeper")
        self.assertGreaterEqual(gatekeeper_start, 0)
        gatekeeper_guidance = normalized[gatekeeper_start : gatekeeper_start + 800]
        self.assertNotRegex(gatekeeper_guidance, r"(?i)\bsudo\b|\bxattr\b")

    def test_package_measurements_are_labeled_with_their_scope(self):
        normalized = self._single_line(self.web_readme)
        for value in (
            self.TASK4_COMMIT,
            "166,912,403 bytes",
            "159.180072 MiB",
            "36,103,844 bytes",
            "34.431309 MiB",
        ):
            self.assertIn(value, normalized)
        self.assertRegex(
            normalized,
            r"(?i)tracked Git blob size.{0,240}not.{0,120}(?:checkout|history|clone transfer)",
        )

    def test_git_attributes_freeze_portable_files_without_git_lfs(self):
        attributes_path = self.REPOSITORY_ROOT / ".gitattributes"
        content = attributes_path.read_text(encoding="utf-8")

        self.assertEqual(content.strip().splitlines(), list(self.GIT_ATTRIBUTES))
        self.assertNotRegex(content, r"(?i)filter\s*=\s*lfs")

    def test_portable_workflow_has_both_required_smoke_jobs(self):
        workflow = self.REPOSITORY_ROOT / ".github" / "workflows" / "web-demo-portable.yml"
        self.assertTrue(workflow.is_file(), workflow)
        content = workflow.read_text(encoding="utf-8")

        self.assertRegex(content, r"(?m)^name: WebDemo portable launchers$")
        for trigger in ("push:", "pull_request:"):
            self.assertIn(trigger, content)
        for watched_path in (
            "web_demo/**",
            "tests/test_web_demo_*.py",
            ".github/workflows/web-demo-portable.yml",
            "README.md",
            ".gitattributes",
        ):
            self.assertEqual(content.count(watched_path), 2)

        self.assertRegex(content, r"(?m)^  windows:$")
        self.assertRegex(content, r"(?m)^    runs-on: windows-latest$")
        self.assertRegex(content, r"(?m)^  apple-silicon:$")
        self.assertRegex(content, r"(?m)^    runs-on: macos-15$")
        self.assertEqual(content.count("uses: actions/checkout@v4"), 2)
        self.assertEqual(content.count("uses: actions/setup-python@v5"), 2)
        self.assertEqual(content.count('python-version: "3.12"'), 2)
        unittest_command = (
            "python -B -m unittest tests.test_web_demo_server "
            "tests.test_web_demo_launcher tests.test_web_demo_portable -v"
        )
        self.assertEqual(content.count(unittest_command), 2)
        self.assertIn(r"cmd.exe /d /c web_demo\start-demo.bat --check", content)
        self.assertIn("/bin/sh web_demo/start-demo.command --check", content)

        self.assertDocumentsRegex(
            r"(?i)CI smoke.{0,240}(?:not|does not).{0,160}(?:Finder|real browser inference)",
            "docs must bound what the CI smoke proves",
        )


if __name__ == "__main__":
    unittest.main()
