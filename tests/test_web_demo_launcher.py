import contextlib
import ctypes
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import time
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
    "isolated_environment": {
        name: value
        for name, value in os.environ.items()
        if name.upper().startswith("PYTHON")
        or name.upper().startswith("DYLD_")
        or name.upper()
        in {"VIRTUAL_ENV", "CONDA_PREFIX", "__PYVENV_LAUNCHER__"}
    },
}
with Path(os.environ["LAUNCH_SERVER_LOG"]).open("a", encoding="utf-8") as output:
    output.write(json.dumps(record, ensure_ascii=False) + "\n")
raise SystemExit(int(os.environ.get("FAKE_SERVER_EXIT", "0")))
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


def _copy_windows_launcher_tree(destination_root: Path) -> Path:
    web_demo = _copy_launcher_tree(destination_root)
    bootstrap = SOURCE_WEB_DEMO / "tools" / "bootstrap_windows.ps1"
    if not bootstrap.is_file():
        raise AssertionError(f"bootstrap is missing: {bootstrap}")
    shutil.copy2(bootstrap, web_demo / "tools" / bootstrap.name)

    archive = SOURCE_WEB_DEMO / "runtimes" / "windows-x86_64-python.zip"
    runtime_dir = web_demo / "runtimes"
    runtime_dir.mkdir()
    shutil.copy2(archive, runtime_dir / archive.name)
    return web_demo


def _copy_macos_launcher_tree(destination_root: Path) -> Path:
    web_demo = _copy_launcher_tree(destination_root)
    for relative_path in (
        Path("start-demo.command"),
        Path("tools") / "bootstrap_macos.sh",
    ):
        source = SOURCE_WEB_DEMO / relative_path
        if not source.is_file():
            raise AssertionError(f"launcher is missing: {source}")
        shutil.copy2(source, web_demo / relative_path)

    archive = SOURCE_WEB_DEMO / "runtimes" / "macos-arm64-python.tar.gz"
    runtime_dir = web_demo / "runtimes"
    runtime_dir.mkdir()
    shutil.copy2(archive, runtime_dir / archive.name)
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
        self.web_demo = _copy_windows_launcher_tree(self.root)
        self.server_log = self.root / "服务器 参数.jsonl"
        self.unrelated_cwd = self.root / "调用者 工作目录"
        self.unrelated_cwd.mkdir()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _base_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        environment["PATH"] = str(system_root / "System32")
        environment["LAUNCH_SERVER_LOG"] = str(self.server_log)
        environment["PYTHONHOME"] = str(self.root / "hostile python home")
        environment["PYTHONPATH"] = str(self.root / "hostile python path")
        environment["PYTHONSTARTUP"] = str(self.root / "hostile startup.py")
        environment["PYTHONDEBUG"] = "1"
        environment["VIRTUAL_ENV"] = str(self.root / "hostile venv")
        environment["CONDA_PREFIX"] = str(self.root / "hostile conda")
        environment["__PYVENV_LAUNCHER__"] = str(self.root / "hostile launcher")
        return environment

    def _run(self, *arguments: str, environment: dict[str, str] | None = None):
        system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        cmd_executable = str(system_root / "System32" / "cmd.exe")
        batch_command = "call " + subprocess.list2cmdline(
            [str(self.web_demo / "start-demo.bat"), *arguments]
        )
        command = subprocess.list2cmdline([cmd_executable]) + " /d /c " + batch_command
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
                timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )

    def test_real_cmd_uses_bundled_runtime_and_reuses_cache(self):
        first = self._run("--check")
        second = self._run("--check")

        for result in (first, second):
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(
                "RUNTIME bundled CPython 3.12.10 (Windows x86_64)",
                result.stdout,
            )
        self.assertIn("CACHE reused", second.stdout)

        records = _server_records(self.server_log)
        self.assertEqual(len(records), 2, records)
        expected_python = (
            self.web_demo
            / ".runtime-cache"
            / "windows-x86_64-4acbed6dd1c7"
            / "python.exe"
        )
        for record in records:
            self.assertEqual(record["argv"], ["--check"])
            self.assertEqual(Path(str(record["cwd"])).resolve(), self.web_demo.resolve())
            self.assertEqual(
                os.path.normcase(str(Path(str(record["executable"])).resolve())),
                os.path.normcase(str(expected_python.resolve())),
            )
            self.assertEqual(record["isolated_environment"], {})

    def test_original_unicode_space_arguments_reach_child_unchanged(self):
        arguments = ("--check", "--port", "43210", "--label", "参数 路径 中文")

        result = self._run(*arguments)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        records = _server_records(self.server_log)
        self.assertEqual(len(records), 1, records)
        self.assertEqual(records[0]["argv"], list(arguments))

    def test_child_exit_code_becomes_batch_exit_code(self):
        environment = self._base_environment()
        environment["FAKE_SERVER_EXIT"] = "37"

        result = self._run("--check", environment=environment)

        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
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
            launcher_pid_log = fake_bin / "launcher.pid"
            server_pid_log = fake_bin / "server.pid"
            server_log = root / "服务器 参数.jsonl"
            wrapper = fake_bin / "python3"
            _write_text(
                wrapper,
                '''#!/bin/sh
if [ "$1" = "-c" ]; then
  printf '%s\n' python3-probe >> "$(dirname -- "$0")/runtime.log"
  printf '%s\n' "$PPID" > "$SH_LAUNCHER_PID_LOG"
else
  printf '%s\n' python3-server >> "$(dirname -- "$0")/runtime.log"
  printf '%s\n' "$$" > "$SH_SERVER_PID_LOG"
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
            environment["SH_LAUNCHER_PID_LOG"] = str(launcher_pid_log)
            environment["SH_SERVER_PID_LOG"] = str(server_pid_log)

            result = subprocess.run(
                [
                    sh,
                    str(web_demo / "start-demo.sh"),
                    "--check",
                    "--port",
                    "41000",
                ],
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
            self.assertEqual(
                server_pid_log.read_text(encoding="utf-8").strip(),
                launcher_pid_log.read_text(encoding="utf-8").strip(),
            )
            records = _server_records(server_log)
            self.assertEqual(len(records), 1, records)
            self.assertEqual(records[0]["argv"], ["--check", "--port", "41000"])
            self.assertEqual(Path(str(records[0]["cwd"])).resolve(), web_demo.resolve())


@unittest.skipUnless(sys.platform == "darwin", "requires macOS")
class MacOSLauncherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory(prefix="LingShu macOS 测试 ")
        self.root = Path(self.temporary_directory.name) / "仓库 副本"
        self.web_demo = _copy_macos_launcher_tree(self.root)
        self.server_log = self.root / "服务器 参数.jsonl"

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _base_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        environment["LAUNCH_SERVER_LOG"] = str(self.server_log)
        environment["PYTHONHOME"] = str(self.root / "hostile python home")
        environment["PYTHONPATH"] = str(self.root / "hostile python path")
        environment["PYTHONUSERBASE"] = str(self.root / "hostile user base")
        environment["PYTHONSTARTUP"] = str(self.root / "hostile startup.py")
        environment["PYTHONDEBUG"] = "1"
        environment["VIRTUAL_ENV"] = str(self.root / "hostile venv")
        environment["CONDA_PREFIX"] = str(self.root / "hostile conda")
        environment["__PYVENV_LAUNCHER__"] = str(self.root / "hostile launcher")
        environment["DYLD_TEST_HOSTILE"] = "must be removed"
        return environment

    def _run(self, *arguments: str, environment: dict[str, str] | None = None):
        return subprocess.run(
            ["./start-demo.command", *arguments],
            cwd=self.web_demo,
            env=self._base_environment() if environment is None else environment,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )

    def _create_runtime_lock(self, *, owner_pid: int, created: int, token: str):
        cache_root = self.web_demo / ".runtime-cache"
        lock_path = cache_root / "macos-arm64-8b0f1fa71eab.lock"
        lock_path.mkdir(parents=True)
        metadata = f"{owner_pid}\n{created}\n{token}\n"
        _write_text(lock_path / ".owner", metadata)
        return lock_path, metadata

    def test_real_command_uses_bundled_runtime_and_reuses_cache(self):
        first = self._run("--check")
        second = self._run("--check")

        for result in (first, second):
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(
                "RUNTIME bundled CPython 3.12.14 (macOS arm64)",
                result.stdout,
            )
        self.assertIn("CACHE reused", second.stdout)

        records = _server_records(self.server_log)
        self.assertEqual(len(records), 2, records)
        expected_python = (
            self.web_demo
            / ".runtime-cache"
            / "macos-arm64-8b0f1fa71eab"
            / "python"
            / "bin"
            / "python3"
        )
        for record in records:
            self.assertEqual(record["argv"], ["--check"])
            self.assertEqual(Path(str(record["cwd"])).resolve(), self.web_demo.resolve())
            self.assertEqual(
                Path(str(record["executable"])).resolve(),
                expected_python.resolve(),
            )
            self.assertEqual(record["isolated_environment"], {})

    def test_real_command_propagates_arguments_and_child_exit(self):
        environment = self._base_environment()
        environment["FAKE_SERVER_EXIT"] = "37"

        result = self._run(
            "--check",
            "--label",
            "参数 路径 中文",
            environment=environment,
        )

        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        records = _server_records(self.server_log)
        self.assertEqual(len(records), 1, records)
        self.assertEqual(
            records[0]["argv"],
            ["--check", "--label", "参数 路径 中文"],
        )

    def test_real_command_recovers_stale_dead_owner_lock(self):
        lock_path, _ = self._create_runtime_lock(
            owner_pid=99_999_999,
            created=int(time.time()) - 60,
            token="00000000-0000-4000-8000-000000000001",
        )

        result = self._run("--check")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(lock_path.exists(), lock_path)
        self.assertEqual(
            list(lock_path.parent.glob(f"{lock_path.name}.stale-*")),
            [],
        )

    def test_real_command_preserves_live_owner_lock_and_times_out_cleanly(self):
        lock_path, metadata = self._create_runtime_lock(
            owner_pid=os.getpid(),
            created=int(time.time()) - 60,
            token="00000000-0000-4000-8000-000000000002",
        )
        started = time.monotonic()

        result = self._run("--check")

        elapsed = time.monotonic() - started
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertLess(elapsed, 12, elapsed)
        self.assertEqual(result.stdout, "")
        error_lines = result.stderr.splitlines()
        self.assertEqual(len(error_lines), 1, result.stderr)
        self.assertTrue(error_lines[0].startswith("ERROR: "), result.stderr)
        self.assertNotIn("trace", result.stderr.lower())
        self.assertTrue(lock_path.is_dir(), lock_path)
        self.assertEqual(
            (lock_path / ".owner").read_text(encoding="utf-8"),
            metadata,
        )
        self.assertEqual(
            list(lock_path.parent.glob(f"{lock_path.name}.stale-*")),
            [],
        )


if __name__ == "__main__":
    unittest.main()
