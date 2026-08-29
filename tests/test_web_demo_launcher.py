import contextlib
import ctypes
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SOURCE_WEB_DEMO = REPOSITORY_ROOT / "web_demo"


def _find_sh() -> str | None:
    on_path = shutil.which("sh")
    if on_path is not None:
        return on_path
    if os.name != "nt":
        return None
    for candidate in (
        Path(r"C:\Program Files\Git\bin\sh.exe"),
        Path(r"C:\Program Files\Git\usr\bin\sh.exe"),
        Path(r"C:\Program Files (x86)\Git\bin\sh.exe"),
    ):
        if candidate.is_file():
            return str(candidate)
    return None


SH_EXECUTABLE = _find_sh()


@contextlib.contextmanager
def _suppress_windows_error_dialogs():
    if os.name != "nt":
        yield
        return

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    previous_mode = kernel32.SetErrorMode(0x0001 | 0x0002)
    try:
        yield
    finally:
        kernel32.SetErrorMode(previous_mode)


FAKE_SERVER = r'''"""Tiny launcher-only server stand-in with artifact validation."""

import hashlib
import json
import os
import sys
from pathlib import Path


def validate_fixture(root: Path) -> None:
    manifest = json.loads((root / "models" / "manifest.json").read_text(encoding="utf-8"))
    model = manifest["model"]
    model_bytes = (root / "models" / model["file"]).read_bytes()
    if len(model_bytes) != model["bytes"]:
        raise RuntimeError("fake model byte count mismatch")
    if hashlib.sha256(model_bytes).hexdigest() != model["sha256"]:
        raise RuntimeError("fake model SHA-256 mismatch")

    integrity = json.loads((root / "dist" / "integrity.json").read_text(encoding="utf-8"))
    for entry in integrity["files"]:
        content = (root / "dist" / entry["path"]).read_bytes()
        if len(content) != entry["bytes"]:
            raise RuntimeError(f"fake dist byte count mismatch: {entry['path']}")
        if hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise RuntimeError(f"fake dist SHA-256 mismatch: {entry['path']}")


root = Path(__file__).resolve().parents[1]
validate_fixture(root)
record = {
    "argv": sys.argv[1:],
    "cwd": os.getcwd(),
    "executable": sys.executable,
}
with Path(os.environ["LAUNCH_SERVER_LOG"]).open("a", encoding="utf-8") as output:
    output.write(json.dumps(record, ensure_ascii=False) + "\n")
raise SystemExit(int(os.environ.get("FAKE_SERVER_EXIT", "0")))
'''


REAL_SERVER_VERIFY_STUB = r'''"""Test-only tiny verifier imported by the real server CLI."""

import hashlib
import json
import os
from pathlib import Path


def verify_distribution(repository_root: Path) -> list[str]:
    root = Path(repository_root).resolve()
    errors: list[str] = []

    try:
        manifest = json.loads(
            (root / "web_demo" / "models" / "manifest.json").read_text(encoding="utf-8")
        )
        model = manifest["model"]
        model_bytes = (root / "web_demo" / "models" / model["file"]).read_bytes()
        if len(model_bytes) != model["bytes"]:
            errors.append("tiny model byte count mismatch")
        if hashlib.sha256(model_bytes).hexdigest() != model["sha256"]:
            errors.append("tiny model SHA-256 mismatch")
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"could not validate tiny model fixture: {error}")

    try:
        dist = root / "web_demo" / "dist"
        integrity = json.loads((dist / "integrity.json").read_text(encoding="utf-8"))
        for entry in integrity["files"]:
            content = (dist / entry["path"]).read_bytes()
            if len(content) != entry["bytes"]:
                errors.append(f"tiny dist byte count mismatch: {entry['path']}")
            if hashlib.sha256(content).hexdigest() != entry["sha256"]:
                errors.append(f"tiny dist SHA-256 mismatch: {entry['path']}")
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"could not validate tiny dist fixture: {error}")

    record = {
        "root": str(root),
        "cwd": os.getcwd(),
        "validated": not errors,
        "errors": errors,
    }
    Path(os.environ["REAL_SERVER_VERIFY_LOG"]).write_text(
        json.dumps(record, ensure_ascii=False),
        encoding="utf-8",
    )
    return errors
'''


def _write_text(path: Path, content: str, *, newline: str = "\n") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline=newline) as output:
        output.write(content)


def _write_json(path: Path, value: object) -> None:
    _write_text(path, json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def _write_tiny_artifacts(web_demo: Path) -> None:
    model = b"tiny deterministic launcher model\n"
    model_path = web_demo / "models" / "tiny_fp32.onnx"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_bytes(model)
    _write_json(
        web_demo / "models" / "manifest.json",
        {
            "schema_version": 1,
            "model": {
                "file": model_path.name,
                "bytes": len(model),
                "sha256": hashlib.sha256(model).hexdigest(),
            },
        },
    )

    index = b"<!doctype html><title>launcher fixture</title>\n"
    index_path = web_demo / "dist" / "index.html"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_bytes(index)
    _write_json(
        web_demo / "dist" / "integrity.json",
        {
            "schema_version": 1,
            "files": [
                {
                    "path": "index.html",
                    "bytes": len(index),
                    "sha256": hashlib.sha256(index).hexdigest(),
                }
            ],
        },
    )


def _copy_launcher_tree(destination_root: Path) -> Path:
    web_demo = destination_root / "web_demo"
    tools = web_demo / "tools"
    tools.mkdir(parents=True)
    for launcher_name in ("start-demo.bat", "start-demo.sh"):
        source = SOURCE_WEB_DEMO / launcher_name
        if not source.is_file():
            raise AssertionError(f"launcher is missing: {source}")
        shutil.copy2(source, web_demo / launcher_name)
    _write_text(tools / "serve_demo.py", FAKE_SERVER)
    _write_tiny_artifacts(web_demo)
    return web_demo


def _server_records(log_path: Path) -> list[dict[str, object]]:
    if not log_path.exists():
        return []
    return [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]


def _runtime_events(log_path: Path) -> list[str]:
    if not log_path.exists():
        return []
    return log_path.read_text(encoding="utf-8").splitlines()


@unittest.skipUnless(os.name == "nt", "Windows launcher integration")
class WindowsLauncherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory(prefix="LingShu 测试 路径 ")
        self.root = Path(self.temporary_directory.name) / "仓库 副本"
        self.web_demo = _copy_launcher_tree(self.root)
        self.fake_bin = self.root / "伪运行时 bin"
        self.fake_bin.mkdir(parents=True)
        self.server_log = self.root / "服务器 参数.jsonl"
        self.runtime_log = self.root / "解释器 选择.log"
        self.unrelated_cwd = self.root / "调用者 工作目录"
        self.unrelated_cwd.mkdir()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _base_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        environment["PATH"] = os.pathsep.join(
            (str(self.fake_bin), str(system_root / "System32"), str(system_root))
        )
        environment["LAUNCH_SERVER_LOG"] = str(self.server_log)
        environment["LAUNCH_RUNTIME_LOG"] = str(self.runtime_log)
        return environment

    def _write_python_wrapper(self, name: str, *, failing_probe: bool = False) -> None:
        if name not in {"py", "python"}:
            raise ValueError(name)
        real_python = str(Path(sys.executable).resolve())
        if name == "py":
            probe_failure = "if \"%~2\"==\"-c\" exit /b 41\n" if failing_probe else ""
            content = f'''@echo off
setlocal DisableDelayedExpansion
if "%~1"=="-3" goto :accepted
exit /b 40
:accepted
if "%~2"=="-c" >>"%LAUNCH_RUNTIME_LOG%" echo py-probe
if not "%~2"=="-c" >>"%LAUNCH_RUNTIME_LOG%" echo py-server
{probe_failure}shift
"{real_python}" %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
'''
        else:
            content = f'''@echo off
setlocal DisableDelayedExpansion
if "%~1"=="-c" >>"%LAUNCH_RUNTIME_LOG%" echo python-probe
if not "%~1"=="-c" >>"%LAUNCH_RUNTIME_LOG%" echo python-server
"{real_python}" %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%
'''
        _write_text(self.fake_bin / f"{name}.cmd", content, newline="\r\n")

    def _install_repository_venv_python(self) -> Path:
        venv_root = self.root / ".venv"
        with _suppress_windows_error_dialogs():
            result = subprocess.run(
                [sys.executable, "-m", "venv", "--without-pip", str(venv_root)],
                cwd=self.root,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        executable = venv_root / "Scripts" / "python.exe"
        self.assertTrue(executable.is_file(), executable)
        self.assertTrue((venv_root / "pyvenv.cfg").is_file(), venv_root / "pyvenv.cfg")
        return executable

    def _install_real_server_with_tiny_verifier(self) -> Path:
        tools = self.web_demo / "tools"
        shutil.copy2(SOURCE_WEB_DEMO / "tools" / "serve_demo.py", tools / "serve_demo.py")
        _write_text(tools / "verify_distribution.py", REAL_SERVER_VERIFY_STUB)
        return self.root / "real-server-verifier.json"

    def _run(self, *arguments: str, environment: dict[str, str] | None = None):
        batch_command = "call " + subprocess.list2cmdline(
            [str(self.web_demo / "start-demo.bat"), *arguments]
        )
        command = (
            subprocess.list2cmdline(
                [os.environ.get("ComSpec", r"C:\Windows\System32\cmd.exe")]
            )
            + " /d /c "
            + batch_command
        )
        with _suppress_windows_error_dialogs():
            return subprocess.run(
                command,
                cwd=self.unrelated_cwd,
                env=self._base_environment() if environment is None else environment,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )

    def test_repository_venv_is_first_and_preserves_unicode_space_and_arguments(self):
        venv_python = self._install_repository_venv_python()
        self._write_python_wrapper("py")
        self._write_python_wrapper("python")
        arguments = ("--check", "--port", "43210", "--label", "参数 路径 !bang!")

        result = self._run(*arguments)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(_runtime_events(self.runtime_log), [])
        records = _server_records(self.server_log)
        self.assertEqual(len(records), 1, records)
        self.assertEqual(records[0]["argv"], list(arguments))
        self.assertEqual(Path(str(records[0]["cwd"])).resolve(), self.web_demo.resolve())
        self.assertIn("仓库 副本", str(records[0]["cwd"]))
        self.assertEqual(
            os.path.normcase(str(Path(str(records[0]["executable"])).resolve())),
            os.path.normcase(str(venv_python.resolve())),
        )

    def test_successful_py_dash_three_runs_server_without_python_fallback(self):
        self._write_python_wrapper("py")
        self._write_python_wrapper("python")

        result = self._run("--check", "--port", "45678")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(_runtime_events(self.runtime_log), ["py-probe", "py-server"])
        self.assertEqual(_server_records(self.server_log)[0]["argv"], ["--check", "--port", "45678"])

    def test_check_runs_real_server_cli_and_tiny_distribution_verifier(self):
        self._write_python_wrapper("py")
        self._write_python_wrapper("python")
        verifier_log = self._install_real_server_with_tiny_verifier()
        environment = self._base_environment()
        environment["REAL_SERVER_VERIFY_LOG"] = str(verifier_log)

        result = self._run("--check", "--port", "43123", environment=environment)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Distribution verification passed.", result.stdout)
        self.assertEqual(_runtime_events(self.runtime_log), ["py-probe", "py-server"])
        self.assertEqual(_server_records(self.server_log), [])
        verification = json.loads(verifier_log.read_text(encoding="utf-8"))
        self.assertEqual(Path(verification["root"]).resolve(), self.root.resolve())
        self.assertEqual(Path(verification["cwd"]).resolve(), self.web_demo.resolve())
        self.assertTrue(verification["validated"])

    def test_probe_failing_py_falls_back_to_successful_python(self):
        self._write_python_wrapper("py", failing_probe=True)
        self._write_python_wrapper("python")

        result = self._run("--check")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            _runtime_events(self.runtime_log),
            ["py-probe", "python-probe", "python-server"],
        )
        self.assertEqual(len(_server_records(self.server_log)), 1)

    def test_missing_all_runtimes_is_clear_nonzero_and_check_never_pauses(self):
        result = self._run("--check")

        combined_output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, combined_output)
        self.assertIn("Python 3.11+", combined_output)
        self.assertIn("python web_demo\\tools\\serve_demo.py", combined_output)
        self.assertNotIn("Press any key", combined_output)
        self.assertEqual(_runtime_events(self.runtime_log), [])
        self.assertEqual(_server_records(self.server_log), [])

    def test_successful_probe_returns_server_failure_without_later_fallback(self):
        self._write_python_wrapper("py")
        self._write_python_wrapper("python")
        environment = self._base_environment()
        environment["FAKE_SERVER_EXIT"] = "37"

        result = self._run("--check", environment=environment)

        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        self.assertEqual(_runtime_events(self.runtime_log), ["py-probe", "py-server"])
        self.assertEqual(len(_server_records(self.server_log)), 1)


class PosixLauncherTests(unittest.TestCase):
    def test_shell_launcher_has_lf_endings_and_git_executable_mode(self):
        launcher = SOURCE_WEB_DEMO / "start-demo.sh"
        self.assertTrue(launcher.is_file(), launcher)
        content = launcher.read_bytes()
        self.assertNotIn(b"\r", content)
        self.assertTrue(content.endswith(b"\n"))

        result = subprocess.run(
            ["git", "ls-files", "--stage", "--", "web_demo/start-demo.sh"],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"^100755 [0-9a-f]+ 0\s+web_demo/start-demo\.sh\s*$")

    @unittest.skipUnless(SH_EXECUTABLE, "POSIX sh is unavailable")
    def test_shell_check_resolves_its_directory_and_returns_server_exit(self):
        sh = SH_EXECUTABLE
        assert sh is not None
        with TemporaryDirectory(prefix="LingShu shell 测试 ") as temporary_directory:
            root = Path(temporary_directory) / "仓库 副本"
            web_demo = _copy_launcher_tree(root)
            fake_bin = root / "伪运行时 bin"
            fake_bin.mkdir(parents=True)
            runtime_log = fake_bin / "runtime.log"
            server_log = root / "服务器 参数.jsonl"
            wrapper = fake_bin / "python3"
            _write_text(
                wrapper,
                '''#!/bin/sh
if [ "$1" = "-c" ]; then
  printf '%s\n' python3-probe >> "$(dirname -- "$0")/runtime.log"
else
  printf '%s\n' python3-server >> "$(dirname -- "$0")/runtime.log"
fi
exec "$REAL_PYTHON" "$@"
''',
            )
            wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            unrelated_cwd = root / "调用者 工作目录"
            unrelated_cwd.mkdir()
            environment = os.environ.copy()
            environment["PATH"] = str(fake_bin) + os.pathsep + environment.get("PATH", "")
            environment["REAL_PYTHON"] = str(Path(sys.executable).resolve())
            environment["LAUNCH_SERVER_LOG"] = str(server_log)
            environment["FAKE_SERVER_EXIT"] = "29"

            result = subprocess.run(
                [sh, str(web_demo / "start-demo.sh"), "--check", "--port", "41000"],
                cwd=unrelated_cwd,
                env=environment,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
                check=False,
            )

            self.assertEqual(result.returncode, 29, result.stdout + result.stderr)
            self.assertEqual(_runtime_events(runtime_log), ["python3-probe", "python3-server"])
            records = _server_records(server_log)
            self.assertEqual(len(records), 1, records)
            self.assertEqual(records[0]["argv"], ["--check", "--port", "41000"])
            self.assertEqual(Path(str(records[0]["cwd"])).resolve(), web_demo.resolve())


if __name__ == "__main__":
    unittest.main()
