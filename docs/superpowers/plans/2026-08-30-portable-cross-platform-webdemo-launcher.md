# Portable Cross-Platform WebDemo Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an offline, repository-bundled Python launcher that lets a judge double-click the existing FP32 WebDemo on Windows x86-64 or Apple Silicon macOS without installing Python, Node.js, packages, or a server.

**Architecture:** Keep browser inference, the 88,123,029-byte FP32 ONNX model, and the loopback static server unchanged in purpose. Thin BAT/COMMAND/SH entry points delegate to native Windows PowerShell or POSIX-shell bootstraps, which select one pinned runtime, verify its manifest/bytes/SHA-256, create or reuse an atomic repository-local cache, sanitize the child environment, and execute the server in the foreground. A Python release-gate utility audits all committed archives, while platform-native black-box tests prove that the bootstraps do not depend on that utility at judge launch time.

**Tech Stack:** Windows batch, Windows PowerShell 5.1/.NET, POSIX `/bin/sh`, CPython 3.12 standard library, Python `unittest`, Node.js/Vitest for acceptance tooling, existing React/Vite/ONNX Runtime Web build.

---

## Execution boundaries

- Work in the user-requested checkout on branch `feat/web-demo`; do not create another worktree.
- The approved design is `docs/superpowers/specs/2026-08-30-portable-cross-platform-webdemo-launcher-design.md`.
- Use strict red-green-refactor: add the named failing test, run it and observe the intended failure, add only the production behavior required for green, rerun, then commit.
- Use Conventional Commits exactly as listed. Do not push unless the user asks.
- Do not touch `web_demo/src/` or redesign the page in this plan. Impeccable is reserved for the later visual phase.
- Do not regenerate, compress, quantize, or replace `web_demo/models/baseline2_njr_fp32.onnx`.
- A Windows or Git-for-Windows shell test is not macOS evidence. Finder, Gatekeeper, Mach-O execution, APFS behavior, Safari, Rosetta, and Terminal-window shutdown require the physical Apple Silicon Mac in Task 12.
- Do not call a runtime, browser, or platform formally supported until the corresponding exact-commit evidence exists.

## File map

```text
.gitattributes                                  # binary runtime and exact launcher EOL policy
.gitignore                                      # both repository-local runtime cache roots
AGENTS.md                                       # contributor-facing portable launcher rules
README.md                                       # judge-facing cross-platform quick start/support truth
THIRD_PARTY_NOTICES.md                          # bundled CPython provenance and retained notices

.github/workflows/
└── web-demo-portable-runtime.yml               # archive audit plus Windows/macOS smoke gates

tests/
├── _portable_runtime_fixtures.py              # synthetic manifest/archive/runtime builders
├── test_web_demo_runtime_distribution.py      # release manifest/hash/member audit
├── test_web_demo_bootstrap.py                 # native bootstrap/cache/isolation black boxes
├── test_web_demo_launcher.py                  # thin-entry, EOL, mode, quoting contracts
└── test_web_demo_server.py                    # import, port, browser, output/error contracts

web_demo/
├── README.md                                   # judge quick start, troubleshooting, measured footprint
├── package.json                                # parity/manual/formal-evidence commands
├── start-demo.bat                             # thin Windows double-click wrapper
├── start-demo.command                         # thin Finder double-click wrapper
├── start-demo.sh                              # terminal entry; macOS delegation/Linux system mode
├── runtimes/
│   ├── runtime-manifest.tsv                   # only runtime registry
│   ├── windows-x86_64-python.zip              # pinned CPython 3.12.10 embeddable
│   ├── macos-arm64-python.tar.gz              # pinned CPython 3.12.14 standalone
│   └── macos-x86_64-python.tar.gz             # pinned CPython 3.12.14 standalone
└── tools/
    ├── bootstrap_windows.ps1                  # Windows select/verify/cache/isolate/exec
    ├── bootstrap_macos.sh                     # executable macOS main and absolute library load
    ├── bootstrap_posix_lib.sh                  # source-only POSIX helper library
    ├── runtime_distribution.py                # release-only manifest/archive verifier
    ├── serve_demo.py                          # anchored verifier import and portable browser policy
    ├── acceptance_platforms.mjs               # formal evidence destination/platform contracts
    ├── export_parity_transfer.mjs             # sealed Windows-to-Mac parity reference transfer
    ├── run_browser_acceptance.mjs             # platform-aware runner; Windows schema preserved
    ├── record_macos_manual_observations.mjs    # explicit Finder/Gatekeeper/shutdown inputs
    └── record_macos_acceptance_evidence.mjs   # Apple Silicon-only evidence writer

web_demo/tests/unit/
├── acceptance-platforms.test.mjs              # output isolation and Intel/Rosetta claim gates
├── parity-transfer.test.mjs                   # sealed reference export/import validation
├── browser-acceptance.test.mjs                # Windows v1 preservation and Mac sealed-input route
├── acceptance-evidence-recorder.test.mjs      # exact evidence schemas/commit relationships
└── build-packaging.test.ts                    # docs, packaging, model, and footprint contract

web_demo/.generated-tests/macos-acceptance/
├── manual-observations.json                    # ignored, explicit physical observations
└── audit-context.sh                            # ignored mode-0600 cwd/env recovery after Terminal restart

results/web_demo_acceptance/
├── README.md                                  # evidence scope and reproduction entry points
├── latest.json                                # existing/refreshed Windows evidence only
└── macos-apple-silicon/
    ├── README.md                              # exact physical-run method and limitations
    └── latest.json                            # created only by a passing physical Mac run

../LingShu-Mac-Transfer/                       # external, untracked, exact-commit handoff directory
├── parity-I/                                  # transfer.json plus manifest.json and 15 tensors
├── lingshu-webdemo-W.bundle                   # verified Windows-to-Mac Git bundle
├── handoff-receipt.json                       # independently digested I/W/bundle/parity receipt
└── lingshu-mac-M.bundle                       # verified Mac-to-Windows evidence return bundle
```

`web_demo/.runtime-cache/` is derived state and never tracked. The final cache name is the runtime ID, a hyphen, and the first twelve SHA-256 characters; its marker stores the full SHA-256.

## Preflight baseline (no commit)

- [ ] Confirm `git branch --show-current` is `feat/web-demo`, `git status --short` is empty, and the approved design plus this plan are present.
- [ ] Freeze the exact starting commit in a local-only ref with `git update-ref refs/lingshu/portable-launcher-base HEAD`, then verify `git rev-parse refs/lingshu/portable-launcher-base`; Task 10 uses that ref to prove this launcher plan never touched `web_demo/src/`.
- [ ] Run `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server tests.test_web_demo_launcher tests.test_web_demo_distribution -v` and expect the current suite to pass before changing behavior.
- [ ] From `web_demo/`, run `npm.cmd test -- --run tests/unit/browser-acceptance.test.mjs tests/unit/acceptance-evidence-recorder.test.mjs` and expect the current acceptance-tool unit suite to pass.
- [ ] Record the current model byte count and SHA-256; require 88,123,029 and `e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69` at every later full gate.
- [ ] Return to repository root and recheck the clean tree. Test-generated ignored files may remain only under the already ignored paths.

### Task 1: Harden the server contract before bundled Python uses it

**Files:**
- Modify: `tests/test_web_demo_server.py`
- Modify: `web_demo/tools/serve_demo.py`

- [ ] **Step 1: Write failing tests for anchored sibling import**

Add a test that copies `serve_demo.py` and the real current `verify_distribution.py` into a temporary `web_demo/tools/`, places a decoy module with the same name first on `sys.path`, loads the copied server with `importlib.util.spec_from_file_location`, and asserts that the loaded verifier's `__module__`/`__file__` point to the good sibling and never the decoy. The real verifier is required because its dataclasses exercise module registration during `exec_module()`.

```python
SERVE_DEMO_PATH = REPOSITORY_ROOT / "web_demo" / "tools" / "serve_demo.py"
VERIFY_DISTRIBUTION_PATH = REPOSITORY_ROOT / "web_demo" / "tools" / "verify_distribution.py"


def _copy_real_server_and_verifier_with_decoy(root: Path) -> tuple[Path, Path]:
    tools = root / "web_demo" / "tools"
    decoy = root / "decoy"
    tools.mkdir(parents=True)
    decoy.mkdir()
    shutil.copy2(SERVE_DEMO_PATH, tools / "serve_demo.py")
    shutil.copy2(VERIFY_DISTRIBUTION_PATH, tools / "verify_distribution.py")
    (decoy / "verify_distribution.py").write_text(
        "from pathlib import Path\n"
        "Path(__file__).with_name('decoy-imported.txt').write_text('bad')\n"
        "def verify_distribution(root): return []\n",
        encoding="utf-8",
    )
    return tools, decoy


def _load_server_from_path(server_path: Path, *, sys_path_first: Path):
    name = f"_lingshu_server_test_{id(server_path)}"
    specification = importlib.util.spec_from_file_location(name, server_path)
    if specification is None or specification.loader is None:
        raise AssertionError(server_path)
    module = importlib.util.module_from_spec(specification)
    old_path = list(sys.path)
    sys.path.insert(0, str(sys_path_first))
    sys.modules[name] = module
    try:
        specification.loader.exec_module(module)
    finally:
        sys.path[:] = old_path
        sys.modules.pop(name, None)
    return module
```

```python
def test_direct_script_loads_only_its_absolute_sibling_verifier(self):
    copied_tools, decoy = _copy_real_server_and_verifier_with_decoy(self.root)
    module = _load_server_from_path(copied_tools / "serve_demo.py", sys_path_first=decoy)
    verifier = module._load_distribution_verifier()
    verifier_file = Path(verifier.__globals__["__file__"]).resolve()
    self.assertEqual(verifier_file, (copied_tools / "verify_distribution.py").resolve())
    self.assertFalse((decoy / "decoy-imported.txt").exists())
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server.RuntimeAndCliTests.test_direct_script_loads_only_its_absolute_sibling_verifier -v`

Expected: FAIL because direct-script mode currently uses `from verify_distribution import verify_distribution` and can resolve the decoy or fail under a restricted `._pth` path.

- [ ] **Step 3: Replace the import with a path-anchored loader**

Add `import importlib.util` and use the exact sibling path. Loading must be lazy so a missing/corrupt verifier is converted to `E201` inside `validate_runtime()` instead of raising a module-import traceback. Keep a module-level wrapper function named `verify_distribution` so existing mocks remain valid.

```python
def _load_distribution_verifier():
    verifier_path = Path(__file__).resolve().with_name("verify_distribution.py")
    specification = importlib.util.spec_from_file_location(
        "_lingshu_verify_distribution",
        verifier_path,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError(f"E201: Could not load distribution verifier: {verifier_path}")
    module = importlib.util.module_from_spec(specification)
    sys.modules[specification.name] = module
    try:
        specification.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(specification.name, None)
        raise
    verifier = getattr(module, "verify_distribution", None)
    if not callable(verifier):
        raise RuntimeError(f"E201: Invalid distribution verifier: {verifier_path}")
    return verifier


def verify_distribution(repository_root: Path) -> list[str]:
    try:
        verifier = _load_distribution_verifier()
        return verifier(repository_root)
    except Exception as error:
        if isinstance(error, RuntimeError) and str(error).startswith("E201:"):
            raise
        raise RuntimeError(
            f"E201: Could not load distribution verifier beside {Path(__file__).resolve()}: {error}"
        ) from None
```

- [ ] **Step 4: Write failing tests for port and error semantics**

Add tests that prove user port zero is rejected before verification/binding, explicit bind failure contains `E301`, validation failure contains `E201`, automatic fallback may still use internal port zero, and a foreign port holder remains usable. At the `main()` boundary, the argparse-zero, validation, and binding failure cases must each assert that stderr contains `No online repair was attempted.` exactly once, contains no traceback, and exits nonzero; `E401` is deliberately excluded because it is a nonfatal warning. For the full-range test, bind twenty OS-assigned holder ports, patch `DEFAULT_PORTS` to those twenty values, and assert automatic mode obtains a different nonzero ephemeral port without closing any holder; this avoids depending on the developer machine's real 8765–8784 availability while exercising the same branch.

```python
def test_cli_rejects_port_zero_before_validation_or_binding(self):
    stderr = io.StringIO()
    with (
        mock.patch.object(serve_demo_module, "validate_runtime") as validate,
        mock.patch.object(serve_demo_module, "bind_server") as binder,
        contextlib.redirect_stderr(stderr),
        self.assertRaises(SystemExit) as raised,
    ):
        main(["--port", "0"], repository_root=self.root)
    self.assertEqual(raised.exception.code, 2)
    self.assertIn("E301", stderr.getvalue())
    self.assertEqual(stderr.getvalue().count("No online repair was attempted."), 1)
    self.assertNotIn("Traceback", stderr.getvalue())
    validate.assert_not_called()
    binder.assert_not_called()

def test_explicit_port_failure_uses_e301_and_keeps_owner_alive(self):
    holder = ExclusiveThreadingHTTPServer(
        ("127.0.0.1", 0), DemoRequestHandler, repository_root=self.root
    )
    thread = threading.Thread(target=holder.serve_forever, daemon=True)
    thread.start()
    try:
        port = holder.server_address[1]
        with self.assertRaisesRegex(RuntimeError, rf"E301.*127\.0\.0\.1:{port}"):
            bind_server(self.root, port=port)
        status, _, _ = _request(port, "/")
        self.assertEqual(status, 200)
    finally:
        holder.shutdown()
        holder.server_close()
        thread.join(timeout=5)
```

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server.BindingTests tests.test_web_demo_server.RuntimeAndCliTests -v`

Expected: FAIL because explicit zero is currently accepted and errors have no stable codes.

- [ ] **Step 5: Implement `1..65535`, `E201`, and `E301`**

Use this exact split: public explicit ports exclude zero; only `bind_server(..., port=None)` may call `_new_server(root, 0)` after 8765 through 8784 are exhausted.

```python
def _port_argument(value: str) -> int:
    try:
        port = int(value, 10)
    except ValueError as error:
        raise argparse.ArgumentTypeError("E301: port must be an integer from 1 through 65535") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("E301: port must be from 1 through 65535")
    return port
```

Change the explicit validation in `bind_server` to `1 <= port <= 65535`; prefix both explicit and automatic bind exceptions with `E301:`. `validate_runtime()` must call the wrapper above and turn a non-empty verifier error list into exactly one `E201:` exception without adding a second prefix. Route all fatal server errors through one printer and override argparse's error boundary so every `E201`/`E301` path emits the offline-repair sentence exactly once and no traceback:

```python
NO_ONLINE_REPAIR = "No online repair was attempted."


def _print_fatal(error: BaseException) -> None:
    print(error, file=sys.stderr)
    print(NO_ONLINE_REPAIR, file=sys.stderr)


class DemoArgumentParser(argparse.ArgumentParser):
    def error(self, message: str):
        self.print_usage(sys.stderr)
        print(f"{self.prog}: error: {message}", file=sys.stderr)
        print(NO_ONLINE_REPAIR, file=sys.stderr)
        raise SystemExit(2)
```

Use `DemoArgumentParser` for CLI construction. Catch only the expected coded runtime failures at `main()`'s public boundary, call `_print_fatal()` once, and return a nonzero status; unexpected programmer errors must remain visible to the test/developer rather than being mislabeled. The script entry point exits with `SystemExit(main())`. Do not append the sentence inside lower-level validators/binders, which would duplicate it.

- [ ] **Step 6: Write failing tests for macOS browser order and nonfatal `E401`**

Inject the platform and subprocess runner into a new `open_browser()` helper. Assert the exact calls `/usr/bin/open -a "Google Chrome"`, `/usr/bin/open -a "Microsoft Edge"`, then `/usr/bin/open URL`; assert Windows still uses `webbrowser.open`. When all attempts fail, `main()` must print `READY`, print an `E401` warning, call `serve_forever`, and return zero after `KeyboardInterrupt`.

```python
def test_macos_browser_order_uses_absolute_open(self):
    attempts = []
    def run(command, **options):
        attempts.append(command)
        return subprocess.CompletedProcess(command, 1 if len(attempts) < 3 else 0)

    self.assertTrue(open_browser("http://127.0.0.1:8765/", platform="darwin", runner=run))
    self.assertEqual(attempts, [
        ["/usr/bin/open", "-a", "Google Chrome", "http://127.0.0.1:8765/"],
        ["/usr/bin/open", "-a", "Microsoft Edge", "http://127.0.0.1:8765/"],
        ["/usr/bin/open", "http://127.0.0.1:8765/"],
    ])
```

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server.RuntimeAndCliTests -v`

Expected: FAIL because the server currently calls `webbrowser.open` directly and ignores a false return.

- [ ] **Step 7: Implement browser/output policy and return to GREEN**

Add `import subprocess`. `open_browser()` must suppress tool stdout/stderr, return a boolean, and never raise for ordinary open failures. After successful validation print `VERIFIED FP32 model and WebDemo distribution`; before serving print `READY ...` and `STOP Press Ctrl+C in this window to stop the local server.` If opening returns false, print `E401: Browser did not auto-open; copy the READY URL manually.` and continue serving. Preserve `Distribution verification passed.` in `--check` mode for the existing acceptance parser while also emitting the stable `VERIFIED` line.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server -v`

Expected: all server tests pass; the existing internal ephemeral fallback test remains green.

- [ ] **Step 8: Commit the server contract**

```powershell
git add web_demo/tools/serve_demo.py tests/test_web_demo_server.py
git commit -m "fix(web): harden portable server startup contract"
```

### Task 2: Define the only runtime manifest and strict release parser

**Files:**
- Create: `web_demo/runtimes/runtime-manifest.tsv`
- Create: `web_demo/tools/runtime_distribution.py`
- Create: `tests/_portable_runtime_fixtures.py`
- Create: `tests/test_web_demo_runtime_distribution.py`

- [ ] **Step 1: Add reusable synthetic builders**

`tests/_portable_runtime_fixtures.py` must expose these concrete helpers: `write_manifest(path, rows)`, `write_zip(path, members)`, `write_tar_gz(path, members)`, `write_tiny_distribution(web_demo)`, and `copy_portable_launcher_tree(destination)`. Members are dictionaries with `name`, `kind`, `data`, and optional `linkname`; every helper writes only below its caller-owned `TemporaryDirectory`.

```python
import io
import hashlib
import json
import shutil
import stat
import tarfile
import zipfile
from pathlib import Path
from typing import Literal, NotRequired, Sequence, TypedDict

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SOURCE_WEB_DEMO = REPOSITORY_ROOT / "web_demo"
RUNTIME_HEADER = (
    "runtime_id", "os", "arch", "target_triple", "runtime_min_os",
    "python_version", "archive", "archive_format", "bytes", "sha256",
    "entrypoint", "source_url",
)


class ArchiveMember(TypedDict):
    name: str
    kind: Literal["file", "dir", "symlink", "hardlink", "fifo", "char", "block", "socket"]
    data: NotRequired[bytes]
    linkname: NotRequired[str]


def write_manifest(path: Path, rows: Sequence[Sequence[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(RUNTIME_HEADER)]
    lines.extend("\t".join(row) for row in rows)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def write_zip(path: Path, members: Sequence[ArchiveMember]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for member in members:
            name = member["name"]
            kind = member["kind"]
            information = zipfile.ZipInfo(name)
            information.create_system = 3
            if kind == "dir":
                information.external_attr = (stat.S_IFDIR | 0o755) << 16
                archive.writestr(information, b"")
            elif kind == "file":
                information.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(information, member.get("data", b""))
            elif kind == "symlink":
                information.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(information, member["linkname"].encode("utf-8"))
            else:
                raise ValueError(f"ZIP fixture cannot encode {kind}")


def write_tar_gz(path: Path, members: Sequence[ArchiveMember]) -> None:
    type_map = {
        "dir": tarfile.DIRTYPE,
        "file": tarfile.REGTYPE,
        "symlink": tarfile.SYMTYPE,
        "hardlink": tarfile.LNKTYPE,
        "fifo": tarfile.FIFOTYPE,
        "char": tarfile.CHRTYPE,
        "block": tarfile.BLKTYPE,
        "socket": b"s",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for member in members:
            information = tarfile.TarInfo(member["name"])
            information.type = type_map[member["kind"]]
            information.linkname = member.get("linkname", "")
            data = member.get("data", b"") if member["kind"] == "file" else b""
            information.size = len(data)
            information.mode = 0o755 if member["kind"] == "dir" else 0o644
            if member["kind"] in {"char", "block"}:
                information.devmajor = 1
                information.devminor = 3
            archive.addfile(information, io.BytesIO(data) if data else None)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8", newline="\n")


def write_tiny_distribution(web_demo: Path) -> None:
    model = b"tiny launcher model\n"
    model_path = web_demo / "models" / "tiny_fp32.onnx"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_bytes(model)
    _write_json(web_demo / "models" / "manifest.json", {
        "schema_version": 1,
        "model": {
            "file": model_path.name,
            "bytes": len(model),
            "sha256": hashlib.sha256(model).hexdigest(),
        },
    })
    index = b"<!doctype html><title>fixture</title>\n"
    index_path = web_demo / "dist" / "index.html"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_bytes(index)
    _write_json(web_demo / "dist" / "integrity.json", {
        "schema_version": 1,
        "files": [{
            "path": "index.html",
            "bytes": len(index),
            "sha256": hashlib.sha256(index).hexdigest(),
        }],
    })


def copy_portable_launcher_tree(destination: Path) -> Path:
    web_demo = destination / "web_demo"
    (web_demo / "tools").mkdir(parents=True)
    (web_demo / "runtimes").mkdir()
    for relative in (
        "start-demo.bat", "start-demo.sh", "start-demo.command",
        "tools/bootstrap_windows.ps1", "tools/bootstrap_macos.sh",
        "tools/serve_demo.py", "tools/verify_distribution.py",
    ):
        source = SOURCE_WEB_DEMO / Path(relative)
        if source.exists():
            target = web_demo / Path(relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    write_tiny_distribution(web_demo)
    return web_demo
```

- [ ] **Step 2: Write failing manifest tests**

Test the exact header, three exact records, twelve non-empty fields, quoted fields containing an embedded tab or newline, other ASCII control characters, duplicate `(os, arch)`, unknown format, non-decimal or non-positive bytes, uppercase/short SHA, malformed target/minimum OS, absolute paths, backslashes, `..`, and non-HTTPS source URLs. Because `csv.reader` can legally parse quoted embedded newlines, each parsed string must receive an explicit `"\t" not in value`, `"\r" not in value`, `"\n" not in value`, and control-character validation.

```python
def test_production_manifest_has_three_exact_records(self):
    records = parse_runtime_manifest(RUNTIMES / "runtime-manifest.tsv")
    self.assertEqual([record.runtime_id for record in records], [
        "windows-x86_64", "macos-arm64", "macos-x86_64"
    ])
    self.assertEqual(sum(record.bytes for record in records), 60_787_627)
    self.assertEqual(records[0].sha256, "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3")
    self.assertEqual(records[1].sha256, "8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6")
    self.assertEqual(records[2].sha256, "bd486eadd20259ad1fece28c800205baac0113c3b9cc663ddae495c19ba9db38")
```

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_runtime_distribution.ManifestTests -v`

Expected: FAIL because the manifest and parser do not exist.

- [ ] **Step 3: Add the frozen TSV**

Write these four lines with literal tab delimiters and LF line endings:

```text
runtime_id	os	arch	target_triple	runtime_min_os	python_version	archive	archive_format	bytes	sha256	entrypoint	source_url
windows-x86_64	windows	x86_64	x86_64-pc-windows-msvc	Windows 8.1	3.12.10	windows-x86_64-python.zip	zip	11133606	4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3	python.exe	https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip
macos-arm64	macos	arm64	aarch64-apple-darwin	macOS 11.0	3.12.14	macos-arm64-python.tar.gz	tar.gz	24970238	8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6	python/bin/python3	https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-aarch64-apple-darwin-install_only_stripped.tar.gz
macos-x86_64	macos	x86_64	x86_64-apple-darwin	macOS 10.15	3.12.14	macos-x86_64-python.tar.gz	tar.gz	24683783	bd486eadd20259ad1fece28c800205baac0113c3b9cc663ddae495c19ba9db38	python/bin/python3	https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-x86_64-apple-darwin-install_only_stripped.tar.gz
```

- [ ] **Step 4: Implement the parser API**

`runtime_distribution.py` must define immutable `RuntimeRecord`, `RuntimeDistributionError`, `parse_runtime_manifest(path)`, and later `verify_runtime_distribution(web_demo_root)`. Parsing returns a tuple and raises one actionable exception beginning with `E103:`.

```python
@dataclass(frozen=True)
class RuntimeRecord:
    runtime_id: str
    os: str
    arch: str
    target_triple: str
    runtime_min_os: str
    python_version: str
    archive: str
    archive_format: str
    bytes: int
    sha256: str
    entrypoint: str
    source_url: str


def _relative_posix(value: str, label: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or path.is_absolute()
        or path.as_posix() != value
        or any(part in {"", ".", ".."} for part in path.parts)
        or (path.parts and ":" in path.parts[0])
    ):
        raise RuntimeDistributionError(f"E103: {label} must be a normalized relative path: {value!r}")
    return path
```

Validate the header by exact tuple equality, use `csv.reader(..., delimiter="\t", strict=True)`, reject any row length other than 12 or any empty field, and maintain a set of `(os, arch)` pairs. Accept only the three approved target triples/OS/architecture combinations, `zip` or `tar.gz`, lowercase `[0-9a-f]{64}`, positive base-10 bytes, `https://`, and version strings that match the approved row family.

- [ ] **Step 5: Run the manifest tests and commit**

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_runtime_distribution.ManifestTests -v`

Expected: all manifest tests pass without reading or requiring the three archives.

```powershell
git add web_demo/runtimes/runtime-manifest.tsv web_demo/tools/runtime_distribution.py tests/_portable_runtime_fixtures.py tests/test_web_demo_runtime_distribution.py
git commit -m "feat(web): define pinned portable runtime manifest"
```

### Task 3: Audit archive members before accepting any frozen bytes

**Files:**
- Modify: `web_demo/tools/runtime_distribution.py`
- Modify: `tests/test_web_demo_runtime_distribution.py`

- [ ] **Step 1: Write malicious ZIP and TAR tests first**

Create tiny fixtures for parent traversal, absolute POSIX path, Windows drive path, ADS (`file.txt:stream`), reserved devices (`CON`, `aux.txt`, `LPT1`), duplicate members, case-fold and NFC/NFD-equivalent collisions, FIFO, character/block device, socket, absolute link, escaping symlink, escaping hardlink, and chained link escape. Also include safe regular/directory/contained-relative-link archives. Standard `zipfile`/`tarfile` writers cannot reliably preserve a NUL in a member name, so call the canonical member-name validator directly with `"bad\0name"` for that case.

```python
def test_rejects_tar_parent_traversal(self):
    with TemporaryDirectory() as temporary:
        archive = Path(temporary) / "unsafe.tar.gz"
        write_tar_gz(archive, [{"name": "../outside", "kind": "file", "data": b"x"}])
        with self.assertRaisesRegex(RuntimeDistributionError, "E103.*traversal|E103.*escape"):
            audit_runtime_archive(archive, archive_format="tar.gz", target_os="macos", expected_root="python")
```

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_runtime_distribution.ArchiveAuditTests -v`

Expected: FAIL because the audit API is absent.

- [ ] **Step 2: Implement canonical member validation**

Add `import unicodedata` and `audit_runtime_archive(path, *, archive_format, target_os, expected_root)`. Normalize names with `PurePosixPath`; reject NUL/control characters, backslashes, absolute/drive paths, empty/dot/parent components, and entries outside the expected root. Use NFD-normalized, case-folded keys for macOS and NFC-normalized, case-folded keys for Windows collision detection. For every Windows-target component, reject colon, trailing dot/space, and the reserved basename set `CON`, `PRN`, `AUX`, `NUL`, `COM1..COM9`, and `LPT1..LPT9`, even when an extension is present.

```python
def _member_key(name: str, target_os: str) -> str:
    normalized = PurePosixPath(name).as_posix()
    if target_os == "macos":
        return unicodedata.normalize("NFD", normalized).casefold()
    if target_os == "windows":
        return unicodedata.normalize("NFC", normalized).casefold()
    return normalized


def _resolved_link(member: PurePosixPath, linkname: str, *, hardlink: bool) -> PurePosixPath:
    target = PurePosixPath(linkname)
    if target.is_absolute() or "\\" in linkname:
        raise RuntimeDistributionError(f"E103: archive link is absolute: {linkname!r}")
    combined = target if hardlink else member.parent / target
    stack: list[str] = []
    for part in combined.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if not stack:
                raise RuntimeDistributionError(f"E103: archive link escapes its root: {linkname!r}")
            stack.pop()
        else:
            stack.append(part)
    return PurePosixPath(*stack)
```

For ZIP, accept directories, Unix regular files/symlinks, and official CPython entries whose DOS metadata has no Unix mode but identifies an ordinary non-device file; read a Unix symlink payload as UTF-8. For TAR, accept only `isdir()`, `isreg()`, `issym()`, and `islnk()`. Resolve link chains with a finite visited set and reject cycles or any final target outside the expected root. Never extract in this release-gate function.

- [ ] **Step 3: Add outer identity and complete distribution verification**

Implement `verify_runtime_archive(record, runtimes_directory)` to resolve the archive beneath the runtime directory, reject symlink/containment escape, compare exact `stat().st_size`, stream SHA-256 in 1 MiB chunks, then invoke the member audit. Freeze the production root mapping: `windows-x86_64` has the archive root itself (`expected_root=None`), while `macos-arm64` and `macos-x86_64` must contain every entry beneath `python/` (`expected_root="python"`); reject any other runtime/root combination. `verify_runtime_distribution(web_demo_root, *, archives_directory=None)` always parses the fixed repository manifest and uses `web_demo/runtimes` unless a release-staging directory is explicitly supplied. Tests must reject a staging-directory symlink or resolved path outside its caller-supplied directory and prove that staging changes only archive lookup, never the manifest. CLI accepts only optional `--staging-directory PATH`; it cannot override the manifest, versions, sizes, hashes, URLs, or entrypoints. It prints every error without traceback and exits 0/1.

- [ ] **Step 4: Return synthetic audit tests to GREEN and commit**

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_runtime_distribution.ArchiveAuditTests -v`

Expected: all safe and malicious synthetic cases pass.

```powershell
git add web_demo/tools/runtime_distribution.py tests/_portable_runtime_fixtures.py tests/test_web_demo_runtime_distribution.py
git commit -m "feat(web): add runtime archive release verifier"
```

### Task 4: Add and independently verify the three real runtime archives

**Files:**
- Create: `web_demo/runtimes/windows-x86_64-python.zip`
- Create: `web_demo/runtimes/macos-arm64-python.tar.gz`
- Create: `web_demo/runtimes/macos-x86_64-python.tar.gz`
- Modify: `tests/test_web_demo_runtime_distribution.py`
- Modify: `.gitattributes`
- Modify: `.gitignore`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `.github/workflows/web-demo-portable-runtime.yml`

- [ ] **Step 1: Add a failing real-artifact identity test**

```python
def test_all_committed_runtime_archives_match_and_pass_member_audit(self):
    errors = verify_runtime_distribution(REPOSITORY_ROOT / "web_demo")
    self.assertEqual(errors, [])
    records = parse_runtime_manifest(REPOSITORY_ROOT / "web_demo" / "runtimes" / "runtime-manifest.tsv")
    self.assertEqual(sum((REPOSITORY_ROOT / "web_demo" / "runtimes" / r.archive).stat().st_size for r in records), 60_787_627)
```

On Windows, add a second integration test that extracts the official frozen embeddable ZIP into a temporary directory, resolves `SERVE_DEMO_PATH`, and executes `subprocess.run([str(extracted_python), "-E", "-s", "-B", "-X", "utf8", str(SERVE_DEMO_PATH.resolve()), "--check"], cwd=unrelated_directory, ...)`. Assert exit zero and `VERIFIED`; this is the direct-script restricted-`python312._pth` proof and must use the real sibling `verify_distribution.py`, not a stub.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_runtime_distribution.RealRuntimeArtifactsTests -v`

Expected: FAIL with `E102`/missing archive paths.

- [ ] **Step 2: Obtain exact immutable upstream bytes into a temporary directory**

Download only these exact immutable URLs:

```text
https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip
https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-aarch64-apple-darwin-install_only_stripped.tar.gz
https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-x86_64-apple-darwin-install_only_stripped.tar.gz
```

Before moving a file under `web_demo/runtimes/`, verify exact byte count and SHA-256 with two independent readers: PowerShell/.NET and `runtime_distribution.py`. The required pairs are `11,133,606 / 4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3`, `24,970,238 / 8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6`, and `24,683,783 / bd486eadd20259ad1fece28c800205baac0113c3b9cc663ddae495c19ba9db38`. A network/TLS failure is a download problem; do not disable certificate verification and do not substitute a newer release.

Run this as one PowerShell block from repository root; keep certificate verification enabled:

```powershell
$downloadRoot = Join-Path $env:TEMP ("lingshu-runtime-download-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $downloadRoot | Out-Null
$windowsArchive = Join-Path $downloadRoot "windows-x86_64-python.zip"
$armArchive = Join-Path $downloadRoot "macos-arm64-python.tar.gz"
$intelArchive = Join-Path $downloadRoot "macos-x86_64-python.tar.gz"

curl.exe --fail --location --proto "=https" --tlsv1.2 --output $windowsArchive "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
if ($LASTEXITCODE -ne 0) { throw "Windows runtime download failed" }
curl.exe --fail --location --proto "=https" --tlsv1.2 --output $armArchive "https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-aarch64-apple-darwin-install_only_stripped.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "Apple Silicon runtime download failed" }
curl.exe --fail --location --proto "=https" --tlsv1.2 --output $intelArchive "https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-x86_64-apple-darwin-install_only_stripped.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "Intel runtime download failed" }

$expected = @(
    @($windowsArchive, 11133606, "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"),
    @($armArchive, 24970238, "8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6"),
    @($intelArchive, 24683783, "bd486eadd20259ad1fece28c800205baac0113c3b9cc663ddae495c19ba9db38")
)
foreach ($item in $expected) {
    if ((Get-Item -LiteralPath $item[0]).Length -ne $item[1]) { throw "Runtime size mismatch: $($item[0])" }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $item[0]).Hash.ToLowerInvariant() -ne $item[2]) { throw "Runtime SHA-256 mismatch: $($item[0])" }
}
.\.venv\Scripts\python.exe web_demo\tools\runtime_distribution.py --staging-directory $downloadRoot
if ($LASTEXITCODE -ne 0) { throw "Runtime member audit failed" }

Move-Item -LiteralPath $windowsArchive -Destination "web_demo\runtimes\windows-x86_64-python.zip"
Move-Item -LiteralPath $armArchive -Destination "web_demo\runtimes\macos-arm64-python.tar.gz"
Move-Item -LiteralPath $intelArchive -Destination "web_demo\runtimes\macos-x86_64-python.tar.gz"

$resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$resolvedDownload = [IO.Path]::GetFullPath($downloadRoot)
if (-not $resolvedDownload.StartsWith($resolvedTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing unsafe temporary cleanup" }
Remove-Item -LiteralPath $resolvedDownload -Recurse -Force
```

- [ ] **Step 3: Freeze binary/EOL/cache attributes and notices**

Append exact path rules, not broad `*.zip` rules:

```gitattributes
web_demo/runtimes/windows-x86_64-python.zip binary -diff -merge
web_demo/runtimes/macos-arm64-python.tar.gz binary -diff -merge
web_demo/runtimes/macos-x86_64-python.tar.gz binary -diff -merge
web_demo/start-demo.bat text eol=crlf
web_demo/start-demo.sh text eol=lf
web_demo/start-demo.command text eol=lf
web_demo/tools/bootstrap_macos.sh text eol=lf
web_demo/tools/bootstrap_posix_lib.sh text eol=lf
results/web_demo_acceptance/latest.json text eol=lf
results/web_demo_acceptance/macos-apple-silicon/latest.json text eol=lf
```

Add both `web_demo/.runtime-cache/` and `web_demo/.runtime-cache-backups/` to `.gitignore`; the latter is an atomic, non-destructive holding area used only by regression/evidence runs that need a first-launch observation. Add a `Bundled CPython runtimes` section to `THIRD_PARTY_NOTICES.md` with exact versions, release URLs, archive names, bytes, SHA-256 values, PSF license identity for official CPython, python-build-standalone/Astral provenance, and retained license/notice locations inside each archive.

- [ ] **Step 4: Add the CI release-audit gate**

Create this path-filtered workflow now. It references only files present by Task 4; launcher jobs are added after their implementations exist in Task 7.

```yaml
name: WebDemo portable runtime

on:
  push:
    paths:
      - ".github/workflows/web-demo-portable-runtime.yml"
      - "tests/test_web_demo_*.py"
      - "tests/_portable_runtime_fixtures.py"
      - "web_demo/runtimes/**"
      - "web_demo/tools/runtime_distribution.py"
  pull_request:
    paths:
      - ".github/workflows/web-demo-portable-runtime.yml"
      - "tests/test_web_demo_*.py"
      - "tests/_portable_runtime_fixtures.py"
      - "web_demo/runtimes/**"
      - "web_demo/tools/runtime_distribution.py"

jobs:
  runtime-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -B -m unittest tests.test_web_demo_runtime_distribution -v
      - run: python -B web_demo/tools/runtime_distribution.py

```

- [ ] **Step 5: Verify attributes, hashes, member audit, CI syntax, and measured size**

Run:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_runtime_distribution -v
.\.venv\Scripts\python.exe web_demo\tools\runtime_distribution.py
git check-attr text diff merge -- web_demo/runtimes/windows-x86_64-python.zip web_demo/runtimes/macos-arm64-python.tar.gz web_demo/runtimes/macos-x86_64-python.tar.gz
```

Expected: all Python tests pass; CLI prints a passing three-runtime result; each archive reports `text: unset`, `diff: unset`, and `merge: unset`/binary-equivalent attributes; summed bytes equal 60,787,627.

- [ ] **Step 6: Commit the independently audited binaries**

```powershell
git add .gitattributes .gitignore THIRD_PARTY_NOTICES.md .github/workflows/web-demo-portable-runtime.yml web_demo/runtimes/runtime-manifest.tsv web_demo/runtimes/windows-x86_64-python.zip web_demo/runtimes/macos-arm64-python.tar.gz web_demo/runtimes/macos-x86_64-python.tar.gz tests/test_web_demo_runtime_distribution.py
git commit -m "build(web): bundle pinned portable Python runtimes"
```

### Task 5A: Validate the Windows host, manifest, and archive before extraction

**Files:**
- Create: `web_demo/tools/bootstrap_windows.ps1`
- Create: `tests/test_web_demo_bootstrap.py`
- Modify: `tests/_portable_runtime_fixtures.py`

- [ ] **Step 1: Add a controlled Windows runtime fixture**

Build a repository-shaped fixture beneath `TemporaryDirectory`, including a tiny ZIP whose manifest entrypoint is `python.cmd`. The wrapper records its absolute path, PID, complete argument vector, and selected environment variables as JSONL before forwarding to the absolute test interpreter. Overwrite the copied server in this fixture with a deterministic test server that supports `--check`, prints `READY` in foreground mode, and exits on a targeted console signal; Task 1 and Task 4 already cover the real server. The fixture manifest retains the production Windows target fields but substitutes only the test archive byte count, SHA-256, entrypoint, and current CPython patch version. No production code receives a manifest-path, host, cache-root, or timeout environment override.

Use this shared pollution list in the fixture and every platform assertion:

```python
POLLUTED_VARIABLES = (
    "PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONUSERBASE",
    "VIRTUAL_ENV", "CONDA_PREFIX", "PIP_CONFIG_FILE", "BASH_ENV", "ENV",
    "CDPATH", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH",
    "DYLD_INSERT_LIBRARIES", "LD_LIBRARY_PATH",
)
```

- [ ] **Step 2: Write and observe selector/manifest/archive RED**

Create `WindowsManifestSelectionTests`. Decorate it, and every later Windows bootstrap class in Tasks 5B–5D, with `@unittest.skipUnless(os.name == "nt", "requires native Windows")`; keep all Win32 `ctypes`, PowerShell, junction, and `CTRL_BREAK_EVENT` lookup inside guarded methods so the module still imports on Ubuntu/macOS CI. Dot-source the copied script and call pure functions with explicit observations to cover x86-64 success plus x86, ARM64, and empty/ambiguous hosts as `E101`. Black-box cases must cover missing archive (`E102`), exact header and twelve fields, embedded control characters, duplicate platform rows, malformed non-selected rows, path/symlink containment, wrong size, and wrong digest (`E103`). Hold both non-selected archive files open for the launch duration with `CreateFileW` and sharing mode zero; the selected Windows launch must still succeed, while any accidental open/hash of a non-selected archive would fail with a sharing violation. Retain executable sentinels inside those archives and assert none executes; do not use NTFS last-access timestamps as evidence.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.WindowsManifestSelectionTests -v`

Expected: FAIL because `bootstrap_windows.ps1` does not exist.

- [ ] **Step 3: Implement only selection and pre-extraction verification**

Make the script safe to dot-source. Freeze the cross-Task 5 function surface as `Fail-Demo`, `Read-RuntimeManifest`, `Select-WindowsRuntime`, `Test-StrictDescendant`, `Get-FileSha256`, `Enter-RuntimeLock`, `Initialize-BundledRuntime`, `Resolve-SystemPython`, and `Invoke-LingShuBootstrap`; tests dot-source and call the pure/controlled subset directly. Only invoke `Invoke-LingShuBootstrap` when `$MyInvocation.InvocationName -ne '.'`. Production main supplies `[Runtime.InteropServices.RuntimeInformation]::OSArchitecture` with `PROCESSOR_ARCHITEW6432` only as compatibility corroboration; tests pass observations directly to pure functions rather than through the environment.

Parse and validate the entire manifest before selection: exact header; exactly twelve non-empty/control-free fields; unique `(os, arch)`; only the three approved OS/architecture/triple/minimum-version families; positive decimal bytes; lowercase 64-hex SHA; normalized contained archive/entrypoint paths; and HTTPS source. Select exactly one `windows/x86_64` row. Resolve the archive with `[IO.Path]::GetFullPath`, require a separator-delimited descendant of `web_demo/runtimes`, compare `[IO.FileInfo].Length`, then stream SHA-256 with `[Security.Cryptography.SHA256]`. A malformed non-selected row is still `E103`.

Set `$ErrorActionPreference = "Stop"`. Internal helpers never call `exit`; they throw one coded internal error carrying only safe paths. `Invoke-LingShuBootstrap` owns one outer `try/catch/finally`; `finally` disposes its lock stream and removes only its exact owned lock, and the script-level catch calls `Fail-Demo` only after cleanup. All fatal output appends `No online repair was attempted.`, exits nonzero, and suppresses PowerShell stacks. Map host to `E101`, missing archive to `E102`, and manifest/archive identity to `E103`.

- [ ] **Step 4: Return the focused class to GREEN and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.WindowsManifestSelectionTests -v
git add web_demo/tools/bootstrap_windows.ps1 tests/_portable_runtime_fixtures.py tests/test_web_demo_bootstrap.py
git commit -m "feat(web): validate Windows bundled runtime"
```

### Task 5B: Build the Windows cache atomically and prove repair behavior

**Files:**
- Modify: `web_demo/tools/bootstrap_windows.ps1`
- Modify: `tests/test_web_demo_bootstrap.py`

- [ ] **Step 1: Write and observe cache/lock/self-test RED**

Create `WindowsRuntimeCacheTests` for first creation, reuse, wrong/short marker, missing entrypoint, failed CPython self-test, reparse-point/junction cache entry, two concurrent launches, live old lock, young dead lock, old dead lock, and timeout. Every destructive-canary path is outside `.runtime-cache` and must survive. For timeout, assert the fixture has exactly one `$LockWaitSeconds = 90` assignment and replace only that line with `$LockWaitSeconds = 1`; do not add a production environment seam.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.WindowsRuntimeCacheTests -v`

Expected: FAIL because the verified archive is not yet extracted or cached.

- [ ] **Step 2: Implement lock, extraction, marker, self-test, and atomic publish**

Use `$LockWaitSeconds = 90`, a final cache directory formed from runtime ID plus the first twelve digest characters, a same-key lock file beneath `.runtime-cache/.locks`, and a unique same-parent temporary directory. Acquire with `[IO.File]::Open(..., CreateNew, Write, None)`, record PID/UTC, wait at most 90 seconds, and recover only a lock older than 600 seconds after `[Diagnostics.Process]::GetProcessById()` proves its owner absent. Before any recursive removal, canonicalize both target and cache root, reject the cache root itself, and require a strict separator-delimited descendant using `StringComparison.OrdinalIgnoreCase`; use `Remove-Item -LiteralPath` only.

Load `System.IO.Compression.FileSystem` explicitly, extract only after byte/digest verification, and reject every extracted item carrying `FileAttributes.ReparsePoint`. Require the exact entrypoint. Execute the absolute interpreter with `-E -s -B -X utf8` for a self-test that proves CPython, exact manifest patch version, expected architecture, all server/verifier standard-library imports, and `runpy.run_path` of the exact absolute `verify_distribution.py` and `serve_demo.py` without invoking `main`. Normalize runtime-reported `AMD64`, `x86_64`, and `X64` to `x86_64`; normalize `ARM64`, `arm64`, and `aarch64` to `arm64`; reject every other or empty value before comparing to the manifest. Write the full digest to `.complete-sha256`, atomically publish with `[IO.Directory]::Move`, and release/delete the owned lock on every path. Rebuild a bad cache; never modify or download a bad repository archive. Map lock/extract/cache errors to `E104` and entrypoint/self-test errors to `E105`, including only safe canonical paths.

- [ ] **Step 3: Return cache tests to GREEN and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.WindowsRuntimeCacheTests -v
git add web_demo/tools/bootstrap_windows.ps1 tests/test_web_demo_bootstrap.py
git commit -m "feat(web): add atomic Windows runtime cache"
```

### Task 5C: Add explicit system mode and sanitize the Windows child environment

**Files:**
- Modify: `web_demo/tools/bootstrap_windows.ps1`
- Modify: `tests/test_web_demo_bootstrap.py`

- [ ] **Step 1: Write and observe environment/system-mode RED**

Create `WindowsBootstrapProcessTests`. In default mode, put sentinels named `python`, `python3`, `py`, `powershell`, `curl`, `wget`, `pip`, and `npm` first on `PATH`, create a broken `.venv`, set every `POLLUTED_VARIABLES` entry, and run `--check --port 43123 --label "参数 路径 ! % &"`. Require no sentinel hits, exact Python flags, exact argument boundaries, and exact output lines built from the fixture's computed digest/path:

```python
expected_cache = fixture.web_demo / ".runtime-cache" / (
    f"windows-x86_64-{fixture.archive_sha256[:12]}"
)
self.assertEqual(first.stdout.splitlines()[:3], [
    f"RUNTIME bundled CPython {fixture.python_version} (Windows x86_64)",
    f"CACHE created {expected_cache.resolve()}",
    "ISOLATION sanitized environment; user site disabled; offline bootstrap",
])
```

The second run must say `CACHE reused` with the same canonical path. Add explicit-system-mode tests that resolve applications only after `--system-python` opt-in, probe `py -3`, `python`, then `python3`, accept only isolated CPython 3.11+ with the required imports, preserve a winning `py.exe` `-3` prefix, print `RUNTIME system CPython 3.11.9 (explicit opt-in)` using the fixture's reported version, print no `CACHE` line, and return `E106` without bundled fallback when every probe fails. Parameterize `E101`, `E102`, `E103`, `E104`, `E105`, and `E106` to require one stable code, actionable text, `No online repair was attempted.` exactly once, nonzero exit, no traceback/PowerShell stack, and no extraction/server sentinel.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.WindowsBootstrapProcessTests -v`

Expected: FAIL because system opt-in, environment filtering, stable output, and foreground execution are incomplete.

- [ ] **Step 2: Implement only process selection, filtering, and foreground execution**

Remove every exact `--system-python` token before forwarding. In default mode never consult `PATH`; in explicit system mode resolve each candidate with `Get-Command -CommandType Application`, retain its absolute `.Source`, and validate it before selection. Release the runtime lock before the long-running server starts. Build a child environment with every polluted variable removed and a minimal `PATH` containing the selected runtime directory, `%SystemRoot%\System32`, and `%SystemRoot%`. Invoke the absolute executable with `-E -s -B -X utf8`, the absolute server path, and the untouched remaining argument array via `&`; do not use `Start-Process`. Print the golden lines, omit `CACHE` for system mode, and return the server's exact exit code.

- [ ] **Step 3: Return system/isolation tests to GREEN and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.WindowsBootstrapProcessTests -v
git add web_demo/tools/bootstrap_windows.ps1 tests/test_web_demo_bootstrap.py
git commit -m "feat(web): isolate Windows launcher environment"
```

### Task 5D: Prove Windows recovery, concurrency, and foreground shutdown

**Files:**
- Modify: `web_demo/tools/bootstrap_windows.ps1`
- Modify: `tests/test_web_demo_bootstrap.py`

- [ ] **Step 1: Write and observe recovery/lifecycle RED**

Create `WindowsBootstrapRecoveryLifecycleTests` for a wrong/short marker, missing cached entrypoint, failed cached self-test, two simultaneous first launches, live old lock, young dead lock, old dead lock, and a long-running first server followed by an immediate reused-cache `--check`. The foreground test reads `READY`, starts the child with `CREATE_NEW_PROCESS_GROUP`, sends `CTRL_BREAK_EVENT` only to that process group, waits with finite timeouts, rebinds the same port, and proves no launcher-owned descendant remains. Every `finally` block performs only targeted process cleanup. Re-run one existing cache test with a held server to prove the runtime lock was released before `serve_demo.py` began.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.WindowsBootstrapRecoveryLifecycleTests -v`

Expected: at least the concurrency or foreground case fails before the final lock/lifecycle behavior is complete.

- [ ] **Step 2: Implement only the failing recovery/lifecycle behavior**

Keep cache creation inside the owned lock, release it before foreground server execution, and preserve the server's exact return code. Stale-lock recovery must require both age greater than 600 seconds and a proven absent PID; a live owner is never removed. Two creators converge on one full-digest-marked final cache and no temporary directory survives. Do not add broad process termination or recursive cleanup outside the validated cache descendant.

- [ ] **Step 3: Run the full Windows bootstrap module and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap -v
git add web_demo/tools/bootstrap_windows.ps1 tests/test_web_demo_bootstrap.py
git commit -m "fix(web): harden Windows launcher lifecycle"
```

### Task 6: Reduce the BAT file to a robust double-click wrapper

**Files:**
- Modify: `web_demo/start-demo.bat`
- Modify: `tests/test_web_demo_launcher.py`

- [ ] **Step 1: Replace obsolete interpreter-selection tests with thin-wrapper RED tests**

Assert CRLF, `DisableDelayedExpansion`, code-page restoration, absolute `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, `-NoProfile`, process-scoped `-ExecutionPolicy Bypass`, absolute repository bootstrap path, exact exit-code propagation, no `.venv`/`py`/`python` probes, no detach, and no pause for `--check` automation failure. Retain the existing Unicode working-directory test and add parentheses, ampersand, percent, exclamation-mark, dollar, and bracket arguments where `cmd.exe` can preserve them.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher.WindowsLauncherTests -v`

Expected: FAIL against the old interpreter-selecting BAT.

- [ ] **Step 2: Implement the thin BAT wrapper**

The only child process is the absolute system PowerShell executable running `tools\bootstrap_windows.ps1` with `-NoProfile -ExecutionPolicy Bypass -File`. Preserve `%*` with delayed expansion disabled, restore the caller's code page, return the exact bootstrap exit, and keep the existing double-click-only pause detection on fatal startup. Do not call `powershell` through `PATH`.

- [ ] **Step 3: Normalize BAT bytes explicitly**

Do not rely on `core.autocrlf` or a future checkout. After editing, mechanically rewrite only this file as UTF-8 without BOM and CRLF, then renormalize its index entry:

```powershell
$batPath = (Resolve-Path "web_demo\start-demo.bat").Path
$batText = [IO.File]::ReadAllText($batPath, [Text.UTF8Encoding]::new($false))
$batText = $batText.Replace("`r`n", "`n").Replace("`r", "`n").Replace("`n", "`r`n")
[IO.File]::WriteAllText($batPath, $batText, [Text.UTF8Encoding]::new($false))
git add --renormalize web_demo/start-demo.bat
```

The raw-byte test must require no UTF-8 BOM, a final `\r\n`, and no bare `\n`; `git check-attr eol -- web_demo/start-demo.bat` must report `crlf`.

- [ ] **Step 4: Run BAT and bootstrap integration together**

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher tests.test_web_demo_bootstrap -v`

Expected: all Windows tests pass from an unrelated CWD and a Unicode/special-character temporary checkout.

- [ ] **Step 5: Commit the Windows judge entry**

```powershell
git add web_demo/start-demo.bat tests/test_web_demo_launcher.py
git commit -m "feat(web): route Windows one-click launch through bundled runtime"
```

### Task 7A: Parse and select the POSIX runtime through sourceable pure functions

**Files:**
- Create: `web_demo/tools/bootstrap_macos.sh`
- Create: `web_demo/tools/bootstrap_posix_lib.sh`
- Modify: `tests/test_web_demo_bootstrap.py`

- [ ] **Step 1: Write and observe POSIX selection/parser RED**

Create `PosixManifestSelectionTests`. Through Git for Windows `sh`, source `bootstrap_posix_lib.sh` and test `lingshu_select_macos_arch`, the full manifest parser, cache-key grammar, and argument-rotation helper with explicit observations. Cover `1 + x86_64 -> arm64` (Rosetta hardware detection), `0 + x86_64 -> x86_64`, empty/unsupported values as `E101`, malformed selected and non-selected rows as `E103`, and literal arguments containing Chinese/spaces plus `()`, `&`, `%`, `!`, `$`, and `[]`.

Run:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.PosixManifestSelectionTests -v
```

Expected: FAIL because `bootstrap_macos.sh` does not exist.

- [ ] **Step 2: Implement only the source library, executable main, architecture normalization, and manifest parsing**

Avoid the non-portable question of whether a POSIX script was sourced. `bootstrap_posix_lib.sh` is source-only and freezes the shared function surface as `lingshu_fail`, `lingshu_parse_manifest`, `lingshu_select_macos_arch`, `lingshu_is_strict_descendant`, `lingshu_lock_state`, `lingshu_prepare_runtime`, `lingshu_filter_system_flag`, `lingshu_run_system_python`, and `lingshu_macos_main`. `bootstrap_macos.sh` is always executable: it starts with `#!/bin/sh`, `set -u`, and `umask 077`, resolves its physical sibling directory, sources the absolute library, and unconditionally calls `lingshu_macos_main` with the resolved `web_demo` root plus `"$@"`. Pure functions accept already-observed values. Production obtains kernel/machine from `/usr/bin/uname` and Apple Silicon capability from `/usr/sbin/sysctl -n hw.optional.arm64`.

Read each TSV line with `IFS= read -r`. Compare the raw header to the exact literal-tab header. Do not assign twelve fields with tab-as-whitespace `IFS`, because consecutive tabs collapse; instead iteratively split the raw row around one literal tab, count exactly eleven delimiters, reject an empty/control-bearing field immediately, and require no remaining tab after field twelve. Validate the same complete three-row contract as the Python/PowerShell parsers before selecting one row.

Normalize `AMD64`, `x86_64`, and `X64` to `x86_64`; normalize `ARM64`, `arm64`, and `aarch64` to `arm64`; reject other/empty values. On Darwin select `macos/arm64` whenever the fixed sysctl returns `1`, even if the process machine says x86-64; otherwise require normalized x86-64. Resolve all repository paths from the script's own physical directory, not caller CWD.

- [ ] **Step 3: Return selection tests to GREEN and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.PosixManifestSelectionTests -v
git add --chmod=+x web_demo/tools/bootstrap_macos.sh
git add web_demo/tools/bootstrap_posix_lib.sh tests/test_web_demo_bootstrap.py
git commit -m "feat(web): select pinned macOS runtime"
```

### Task 7B: Build the macOS cache and shared POSIX system mode

**Files:**
- Modify: `web_demo/tools/bootstrap_macos.sh`
- Modify: `web_demo/tools/bootstrap_posix_lib.sh`
- Modify: `tests/test_web_demo_bootstrap.py`

- [ ] **Step 1: Write and observe cache/system/error RED**

Create `PosixCachePolicyTests` for strict resolved descendants, cache keys, lock-state decisions, argument rotation, and exact `E101`, `E102`, `E103`, `E104`, `E105`, `E106` output. Parameterize every fatal code to require actionable text, `No online repair was attempted.` exactly once, nonzero exit, no shell/Python trace, and no extraction/server sentinel. Put the suffix in the shared `lingshu_fail` boundary rather than individual helpers so it cannot duplicate; `E401` remains a server warning and is not part of this fatal table. Git-for-Windows tests source only the library and call post-verification/pure helpers with injected observed size, digest, and member data; they never attempt the full macOS path because Git Bash lacks BSD `/usr/bin/stat -f '%z'` and `/usr/bin/shasum`. Separately add generic native-macOS tests guarded by `sys.platform == "darwin"`, and Apple-Silicon-only cases guarded by both Darwin and `/usr/sbin/sysctl -n hw.optional.arm64 == 1`. Cover actual host selection, fixed-tool size/SHA, first/reused cache, polluted environment, hostile PATH, system probe order, special-character arguments, concurrency, stale locks, and foreground exit propagation. The Darwin cases are native-platform gates; Windows skips and macOS CI smoke are not formal evidence.

Run:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap.PosixCachePolicyTests -v
```

Expected: FAIL because cache extraction, system mode, and execution are absent.

- [ ] **Step 2: Implement verified archive/cache behavior**

In default mode require Darwin, then verify the selected archive is a strict descendant of `web_demo/runtimes`, compare `/usr/bin/stat -f '%z' "$archive"`, and compare `/usr/bin/shasum -a 256` before extraction. Acquire a same-key lock atomically with `/bin/mkdir`, record PID/epoch, wait via `/bin/sleep` at most 90 seconds, and recover only a lock older than 600 seconds whose `kill -0` owner check fails. Before every `/bin/rm -rf`, canonicalize the target, reject the cache root, and require a strict `.runtime-cache/` descendant.

Extract with `/usr/bin/tar` into a unique same-parent directory. Enumerate links with `/usr/bin/find`, reject absolute targets, resolve relative chains with `/usr/bin/readlink` plus physical-parent `cd -P`, reject cycles/escapes, and require the exact entrypoint. Run the same exact-version/import/runpy self-test as Windows and compare normalized runtime architecture to the manifest. Write the full digest marker, publish with atomic `/bin/mv`, release the lock before the server, and remove only owned temporary/lock paths on failure.

- [ ] **Step 3: Implement one shared POSIX system-Python function**

Filter every exact `--system-python` token with the argument-rotation loop tested in Step 1. `lingshu_run_system_python` in the source-only library accepts the already resolved `web_demo` root as its first internal argument, shifts it, then contains the only POSIX probe, absolute-executable resolution, CPython 3.11+ import check, environment sanitization, output policy, and foreground `exec`. Probe `python3`, then `python` only after explicit opt-in and never fall back to a bundle. Darwin default mode prints `RUNTIME bundled CPython 3.12.14 (macOS arm64)` or the x86-64 equivalent, `CACHE created`/`CACHE reused` plus its canonical path, and `ISOLATION sanitized environment; user site disabled; offline bootstrap`. System mode prints the detected version and no `CACHE` line. Unset the shared pollution list, set a fixed minimal PATH only after interpreter selection, and execute absolute Python with `-E -s -B -X utf8` plus the absolute server path; never background.

- [ ] **Step 4: Run available cache/system tests and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_bootstrap -v
git add web_demo/tools/bootstrap_macos.sh web_demo/tools/bootstrap_posix_lib.sh tests/test_web_demo_bootstrap.py
git commit -m "feat(web): add atomic macOS runtime cache"
```

### Task 7C: Add Finder/Linux entries, exact modes, and platform smoke CI

**Files:**
- Create: `web_demo/start-demo.command`
- Modify: `web_demo/start-demo.sh`
- Modify: `web_demo/tools/bootstrap_posix_lib.sh`
- Modify: `tests/test_web_demo_launcher.py`
- Modify: `tests/test_web_demo_bootstrap.py`
- Modify: `.github/workflows/web-demo-portable-runtime.yml`

- [ ] **Step 1: Write and observe wrapper/static/lifecycle RED**

Assert LF plus trailing newline for all four shell files; tracked mode `100755` for the three executable entries and `100644` for the source-only library; `/bin/sh`; fixed absolute system tools; and absence of `curl`, `wget`, `pip`, `npm`, `sudo`, `xattr`, AppleScript, `/usr/bin/open`, and any detached/background syntax. Browser opening remains solely in `serve_demo.py`. Assert `.command` resolves and invokes only its absolute sibling bootstrap and forwards `"$@"`.

Add native-macOS pseudo-terminal and foreground Ctrl+C/port-release tests guarded with `@unittest.skipUnless(sys.platform == "darwin", "requires native macOS")`; import `pty`, `termios`, and `fcntl` only inside guarded methods so Windows/Linux can import the module. A failed no-argument invocation with interactive stdin pauses once with `Press Return to close this window...`; any invocation with at least one argument, including `--check`, never pauses. State this honestly: Terminal cannot reliably distinguish Finder from a user manually running a no-argument `.command`. Add a Linux CI contract that default mode is `E101` while explicit system mode runs foreground.

Run: `.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher.PosixLauncherTests -v`

Expected: FAIL because the Finder entry and final Linux delegation are absent.

- [ ] **Step 2: Implement the wrappers without duplicated system logic**

`start-demo.command` resolves its physical directory with `/bin/sh`, invokes the absolute `tools/bootstrap_macos.sh`, forwards `"$@"`, preserves the exit code, applies the tested pause rule only after non-130 failure, and never changes Gatekeeper settings.

`start-demo.sh` resolves itself and branches on `/usr/bin/uname -s`. On Darwin it `exec`s the bootstrap. On Linux it sources the absolute `tools/bootstrap_posix_lib.sh`, rejects calls lacking `--system-python`, then calls `lingshu_run_system_python "$resolved_web_demo_root" "$@"`; other kernels return `E101`. Git Bash is not labeled Linux and cannot prove that branch.

- [ ] **Step 3: Set exact executable modes and extend both workflow path filters**

```powershell
git add --chmod=+x web_demo/start-demo.sh web_demo/start-demo.command web_demo/tools/bootstrap_macos.sh
```

Add these entries to both `push.paths` and `pull_request.paths`:

```yaml
      - "web_demo/start-demo.*"
      - "web_demo/tools/bootstrap_windows.ps1"
      - "web_demo/tools/bootstrap_macos.sh"
      - "web_demo/tools/bootstrap_posix_lib.sh"
      - "web_demo/tools/serve_demo.py"
      - "web_demo/tools/verify_distribution.py"
      - "web_demo/models/**"
      - "web_demo/dist/**"
      - ".gitattributes"
      - ".gitignore"
```

Append three jobs. Every job checks out the repository and installs only the developer Python used by `unittest`; each default BAT/macOS smoke itself must use the committed runtime:

```yaml
  windows-launcher-smoke:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -B -m unittest tests.test_web_demo_server tests.test_web_demo_launcher tests.test_web_demo_bootstrap -v
      - run: cmd /d /c web_demo\start-demo.bat --check

  linux-launcher-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -B -m unittest tests.test_web_demo_server tests.test_web_demo_launcher tests.test_web_demo_bootstrap -v
      - name: Reject bundled mode on Linux
        shell: bash
        run: |
          set +e
          output="$(/bin/sh web_demo/start-demo.sh --check 2>&1)"
          status=$?
          set -e
          test "$status" -ne 0
          printf '%s\n' "$output" | grep 'E101:'
      - run: /bin/sh web_demo/start-demo.sh --system-python --check

  macos-launcher-smoke:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -B -m unittest tests.test_web_demo_server tests.test_web_demo_launcher tests.test_web_demo_bootstrap -v
      - run: /bin/sh -n web_demo/start-demo.sh web_demo/start-demo.command web_demo/tools/bootstrap_macos.sh web_demo/tools/bootstrap_posix_lib.sh
      - run: /bin/sh web_demo/start-demo.sh --check
```

Keep an adjacent workflow comment that the macOS job validates only the native architecture supplied by that runner and is smoke coverage, not Finder, Gatekeeper, browser, or formal Apple Silicon evidence.

- [ ] **Step 4: Run all available launcher/bootstrap tests and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher tests.test_web_demo_bootstrap -v
git add .github/workflows/web-demo-portable-runtime.yml web_demo/start-demo.sh web_demo/start-demo.command web_demo/tools/bootstrap_macos.sh web_demo/tools/bootstrap_posix_lib.sh tests/test_web_demo_launcher.py tests/test_web_demo_bootstrap.py
git commit -m "feat(web): add portable macOS and Linux launchers"
```

### Task 8: Lock down packaging policy, documentation, and support claims

**Files:**
- Modify: `tests/test_web_demo_launcher.py`
- Modify: `web_demo/tests/unit/build-packaging.test.ts`
- Modify: `README.md`
- Modify: `web_demo/README.md`
- Modify: `AGENTS.md`
- Modify: `results/web_demo_acceptance/README.md`
- Create: `results/web_demo_acceptance/macos-apple-silicon/README.md`

- [ ] **Step 1: Write failing packaging/document contract tests**

In `tests/test_web_demo_launcher.py`, add exact assertions that:

- `web_demo/models` contains the single tracked ONNX path `baseline2_njr_fp32.onnx`, whose bytes/SHA are `88_123_029` and `e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69`; no filename contains `fp16`, `int8`, `quant`, `mock`, or `remote`;
- `.gitattributes` contains the three exact archive binary lines, every exact BAT/shell EOL line once each (including `web_demo/tools/bootstrap_posix_lib.sh text eol=lf` at mode `100644`), and exact LF rules for both Windows and Mac acceptance JSON paths so cross-platform SHA-256 checks address identical bytes;
- raw BAT bytes are UTF-8 without BOM and CRLF-only; raw shell bytes and each present acceptance JSON are UTF-8 without BOM and LF-only; and `git ls-files --stage` reports `100755` for `.sh`, `.command`, and the macOS bootstrap;
- case-insensitive tokenization of the launcher/bootstrap files finds none of `curl`, `wget`, `Invoke-WebRequest`, `pip install`, `npm install`, `sudo`, `xattr`, `Start-Process`, `nohup`, `disown`, or background `&` syntax (quoted argument test fixtures are excluded from this production-file scan);
- `git check-ignore` matches both runtime cache roots and `git ls-files` reports neither cache root tracked.

In `web_demo/tests/unit/build-packaging.test.ts`, assert both quick-start paths, `FP32`, threshold `0.55657113`, loopback/privacy wording, WebGPU-to-WASM fallback, bundled/offline extraction and cache, automatic/explicit port behavior, developer-only `--system-python`, every exact code `E101`, `E102`, `E103`, `E104`, `E105`, `E106`, `E201`, `E301`, and `E401`, Gatekeeper/Developer-ID truth, Git-clone preference, and native Intel's unverified label across the judge-facing docs. Make the Apple Silicon wording assertion evidence-aware from the start without importing the not-yet-created Task 9 module: when the formal Mac JSON is absent, require `pending`; when it exists, require exactly the Task 9A top-level keys below, 40-hex `testedCommit`/`implementationTreeCommit`, `relationships.implementationParentVerified == true`, and docs naming only recorded OS/browser/transport combinations. Task 9A must use this same frozen key list, so Task 12 can change docs without weakening or editing the packaging test.

```typescript
const MAC_EVIDENCE_KEYS = [
  'browsers', 'cache', 'checkoutTransport', 'diagnostics', 'generatedAt',
  'implementationTreeCommit', 'manualObservations', 'parityTransfer',
  'platform', 'ports', 'providers', 'relationships', 'result', 'runtime',
  'schemaVersion', 'shutdown', 'testedCommit', 'timings',
].sort();
```

Run:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher -v
npm.cmd --prefix web_demo test -- --run tests/unit/build-packaging.test.ts
```

Expected: FAIL until documentation and packaging assertions are aligned.

- [ ] **Step 2: Update judge-facing quick starts and troubleshooting**

Put Windows `web_demo/start-demo.bat` and macOS `web_demo/start-demo.command` side by side. Explain first-run verified extraction, subsequent cache reuse, no installed Python/Node/npm/pip/admin/network requirement after clone, loopback-only inference and no upload boundary, automatic 8765–8784/ephemeral selection, explicit port behavior, Ctrl+C/window shutdown, unchanged threshold `0.55657113`, and unchanged FP32 WebGPU→WASM inference/browser fallback.

Give one actionable section for `E101`, `E102`, `E103`, `E104`, `E105`, `E106`, `E201`, `E301`, and `E401`. State that Git clone is primary on macOS; Download ZIP is experimental; `chmod +x` restores only executable bits; the project has no Developer ID; approving the script may not approve the extracted Mach-O; managed Macs may remove Open Anyway; the launcher never uses `xattr -d` or `sudo`. Distinguish the embedded Windows runtime vendor floor (Windows 8.1) from this project's formally targeted judge platform (Windows 10 x86-64 or newer).

- [ ] **Step 3: Preserve evidence boundaries**

State that existing Windows `latest.json` proves only its recorded pre-portable commit until Task 11 refreshes it. Mark Apple Silicon acceptance pending until Task 12 creates exact-commit evidence. State that the Intel archive is bundled but unverified; Rosetta smoke evidence cannot establish native Intel compatibility or inferred full-project minimum macOS support.

- [ ] **Step 4: Measure the committed Task 7 tree instead of repeating the estimate**

Measure the already committed Task 7 `HEAD`, not the dirty documentation worktree, so the result is stable and non-self-referential:

```powershell
$measuredCommit = git rev-parse HEAD
$sizes = git ls-tree -r --format="%(objectsize)" HEAD
if ($LASTEXITCODE -ne 0) { throw "git ls-tree failed" }
$trackedBytes = [int64](($sizes | ForEach-Object { [int64]$_ } | Measure-Object -Sum).Sum)
$runtimePaths = @(
    "web_demo/runtimes/windows-x86_64-python.zip",
    "web_demo/runtimes/macos-arm64-python.tar.gz",
    "web_demo/runtimes/macos-x86_64-python.tar.gz"
)
$runtimeBytes = [int64]0
foreach ($runtimePath in $runtimePaths) {
    $runtimeBytes += [int64](git cat-file -s "HEAD:$runtimePath")
    if ($LASTEXITCODE -ne 0) { throw "Missing committed runtime: $runtimePath" }
}
if ($runtimeBytes -ne 60787627) { throw "Runtime total mismatch: $runtimeBytes" }
[PSCustomObject]@{
    measuredCommit = $measuredCommit
    trackedBytes = $trackedBytes
    trackedMiB = [Math]::Round($trackedBytes / 1MB, 2)
    runtimeBytes = $runtimeBytes
    runtimeMiB = [Math]::Round($runtimeBytes / 1MB, 2)
}
```

Write the result to `web_demo/README.md` under the literal heading `### Repository footprint (measured)` using exactly these labels: `Measurement kind: Task 7 launcher baseline`, `Measured commit:`, `Tracked Git blob bytes:`, `Tracked Git blob MiB:`, `Bundled runtime bytes:`, and `Bundled runtime MiB:`. The packaging test parses the six labels, accepts only the explicit Task 7 baseline or Task 9E final measurement-kind strings during this staged implementation, recomputes both totals from the stated commit, and requires exact equality. Label this Git blob total, not checkout allocation, compressed clone transfer, or history size; Task 8 documentation bytes are intentionally outside that frozen baseline. Task 9E replaces the baseline and tightens the test to require the final functional-implementation measurement. Do not repeat the earlier 182.61 MiB estimate as a measured result.

- [ ] **Step 5: Run documentation/packaging gates and commit**

Run:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_launcher tests.test_web_demo_runtime_distribution -v
npm.cmd --prefix web_demo test -- --run tests/unit/build-packaging.test.ts
```

Expected: all tests pass; no formal Apple Silicon claim exists yet.

```powershell
git add README.md web_demo/README.md AGENTS.md results/web_demo_acceptance/README.md results/web_demo_acceptance/macos-apple-silicon/README.md web_demo/tests/unit/build-packaging.test.ts tests/test_web_demo_launcher.py
git commit -m "docs(web): document portable offline launch workflow"
```

### Task 9A: Canonicalize formal platforms without changing Windows v1 evidence

**Files:**
- Create: `web_demo/tools/acceptance_platforms.mjs`
- Create: `web_demo/tests/unit/acceptance-platforms.test.mjs`
- Modify: `web_demo/tests/unit/browser-acceptance.test.mjs`
- Modify: `web_demo/tests/unit/acceptance-evidence-recorder.test.mjs`

- [ ] **Step 1: Write and observe architecture/destination RED**

Test `normalizeArchitecture()` mappings `x64|x86_64|amd64 -> x86_64` and `arm64|aarch64 -> arm64`, rejecting every other/empty value. Test hardware detection separately from Node process architecture: Darwin `arm64` is native Apple Silicon; Darwin `x64` plus `/usr/sbin/sysctl -n hw.optional.arm64 == 1` is Apple Silicon under Rosetta 2; Darwin `x64` plus `0` is Intel. Production hardware detection must invoke that fixed sysctl path rather than infer from `os.arch()`.

```javascript
expect(formalEvidencePath({ platform: 'win32', hardwareArch: 'x86_64' }))
  .toBe('results/web_demo_acceptance/latest.json');
expect(formalEvidencePath({ platform: 'darwin', hardwareArch: 'arm64' }))
  .toBe('results/web_demo_acceptance/macos-apple-silicon/latest.json');
expect(() => formalEvidencePath({ platform: 'darwin', hardwareArch: 'x86_64' }))
  .toThrow(/Intel.*unverified/iu);
```

Add an exact Windows-v1 canary: validate a fixture with raw `platform.arch: "x64"`, assert its sorted keys and nested keys remain unchanged, assert no `runtimeSource` field appears, and assert the formal output remains `results/web_demo_acceptance/latest.json`.

Run: `npm.cmd --prefix web_demo test -- --run tests/unit/acceptance-platforms.test.mjs tests/unit/browser-acceptance.test.mjs tests/unit/acceptance-evidence-recorder.test.mjs`

Expected: FAIL because canonical platform routing does not exist.

- [ ] **Step 2: Implement platform normalization and strict Mac schema keys**

Keep the Windows v1 validator/report byte contract intact. Define a separate Mac schema with exactly these top-level keys:

```text
schemaVersion, testedCommit, implementationTreeCommit, generatedAt,
checkoutTransport, platform, runtime, browsers, providers, parityTransfer,
cache, ports, shutdown, manualObservations, timings, result, diagnostics,
relationships
```

`platform` contains raw `platform`, `release`, canonical `hardwareArch`, canonical `processArch`, and `translationMode` (`native` or `rosetta2`). `runtime` contains `mode`, exact version, canonical `runtimeArch`, archive digest, and source URL. `result` is exactly the string `pass`; a failed run remains ignored diagnostics and is never formal evidence. Freeze these nested contracts:

```text
parityTransfer {
  implementationCommit: 40-hex I,
  manifestSha256: 64-hex digest,
  fileCount: 16,
  verified: true
}
relationships {
  implementationParentVerified: true,
  windowsEvidenceOnlyDiffVerified: true,
  windowsEvidenceCommit: 40-hex W,
  implementationCommit: 40-hex I,
  handoffReceiptSha256: 64-hex digest,
  bundleSha256: 64-hex digest,
  windowsEvidenceSha256: 64-hex digest
}
```

`parityTransfer.fileCount` counts payload entries only: `manifest.json` plus fifteen tensors. The outer `transfer.json` envelope is not a payload entry, so the physical transfer directory contains seventeen files in total.

Formal Apple Silicon requires `hardwareArch == arm64` and bundled `runtimeArch == arm64`; an x86-64 Node process is allowed only with `translationMode == rosetta2`. Intel is never routed to a formal path.

- [ ] **Step 3: Return platform/schema tests to GREEN and commit**

```powershell
npm.cmd --prefix web_demo test -- --run tests/unit/acceptance-platforms.test.mjs tests/unit/browser-acceptance.test.mjs tests/unit/acceptance-evidence-recorder.test.mjs
git add web_demo/tools/acceptance_platforms.mjs web_demo/tests/unit/acceptance-platforms.test.mjs web_demo/tests/unit/browser-acceptance.test.mjs web_demo/tests/unit/acceptance-evidence-recorder.test.mjs
git commit -m "feat(web): define platform-isolated evidence contracts"
```

### Task 9B: Export sealed Windows parity inputs and consume them on macOS

**Files:**
- Create: `web_demo/tools/export_parity_transfer.mjs`
- Create: `web_demo/tests/unit/parity-transfer.test.mjs`
- Modify: `web_demo/tools/run_browser_acceptance.mjs`
- Modify: `web_demo/tests/unit/browser-acceptance.test.mjs`
- Modify: `web_demo/package.json`

- [ ] **Step 1: Write and observe parity-transfer RED**

Test atomic export to a caller-selected directory outside the repository. The transfer contains `transfer.json`, `manifest.json`, and the exact fifteen referenced tensor files only. `transfer.json` freezes schema version, implementation commit, manifest digest, and sorted relative file entries with byte count/SHA-256. Reject dirty tracked state, symlinks, missing/extra paths, traversal, wrong bytes/digest, wrong model identity, threshold other than `0.55657113`, or a commit mismatch.

Add Mac-runner tests proving `--parity-input` plus `--implementation-tree-commit` validates/copies the sealed directory into ignored generated state without invoking `generate_parity_references.py`. Without those flags Darwin must fail actionably before browser launch. Preserve the Windows path: it still generates parity references and still emits the exact Windows v1 report.

Run: `npm.cmd --prefix web_demo test -- --run tests/unit/parity-transfer.test.mjs tests/unit/browser-acceptance.test.mjs`

Expected: FAIL because transfer export/import is absent.

- [ ] **Step 2: Implement the sealed transfer and platform-aware runner**

Add package script `export:parity-transfer`. Export only after validating the current generated parity tree and clean tracked commit; write into a same-parent temporary directory and atomically rename. If the fixed destination already contains a valid sealed export for the same implementation commit with byte-identical manifest/file identities, print `PARITY TRANSFER reused` and return success without rewriting it; if any identity differs, fail without deleting either tree so the operator can preserve diagnostics and choose a new external transfer root. Import validates every path before copying and records its digest/commit in the Mac automated report.

On Darwin, discover Chrome first at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, then Edge at `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`; Edge is optional. Use `/bin/sh start-demo.sh` in both source and fresh-copy automated paths, always default bundled mode, and require `.command`, bootstrap, selected arm64 archive, dist, and model in the fresh copy. Run created-cache and reused-cache checks, occupied-range fallback without killing holders, explicit-port failure, Chrome WebGPU/forced-WASM real-image inference, and foreground shutdown. Emit only the separate Mac automated report. Scope every cleanup/replacement to the runner's own `browser-acceptance` and imported-parity subdirectories; never remove `macos-acceptance/manual-observations.json`, its active session, or `audit-context.sh`. Rename the internal helper to `runLauncherCheck`, but map its Windows result back to the unchanged `freshCopy.batchCheck` key.

For Windows portable evidence, concatenate the first and second BAT `--check` outputs into the existing `freshCopy.batchCheck.output` string; require exact bundled-runtime, `CACHE created`, `CACHE reused`, isolation, and distribution-verification lines while retaining the v1 keys. The fresh server URL must differ from deliberately occupied 8765. Do not add a Windows schema field to describe runtime source.

- [ ] **Step 3: Return transfer/runner tests to GREEN and commit**

```powershell
npm.cmd --prefix web_demo test -- --run tests/unit/parity-transfer.test.mjs tests/unit/browser-acceptance.test.mjs
git add web_demo/package.json web_demo/tools/export_parity_transfer.mjs web_demo/tools/run_browser_acceptance.mjs web_demo/tests/unit/parity-transfer.test.mjs web_demo/tests/unit/browser-acceptance.test.mjs
git commit -m "feat(web): add sealed macOS parity input"
```

### Task 9C: Capture manual Mac observations as strict ignored input

**Files:**
- Create: `web_demo/tools/record_macos_manual_observations.mjs`
- Modify: `web_demo/tests/unit/acceptance-platforms.test.mjs`
- Modify: `web_demo/package.json`

- [ ] **Step 1: Write and observe manual-observation RED**

Test exported validation/build functions with injected answers and a temporary repository. The atomically written ignored file is `web_demo/.generated-tests/macos-acceptance/manual-observations.json`; it contains exact `schemaVersion`, `testedCommit`, `recordedAt`, `checkoutTransport`, `platform`, `finderDoubleClick`, `pathPollution`, `gatekeeper`, `cache`, `ports`, `checks`, `browsers`, `shutdown`, and `downloadZip` keys. General status values are only `pass|fail|not-installed|not-run`; Gatekeeper status is only `allowed|open-required|blocked|not-observed`; transport is only `git-bundle-clone|remote-git-clone`. Every observation requires a non-empty diagnostic, and the recorder rejects placeholder words, non-Darwin/non-Apple-Silicon hardware, dirty tracked state, or a commit mismatch. Add state-machine tests for `--prepare-finder-path-test` and `--resume-finder-path-test`: the prepare phase exits successfully after persisting one active session, killing its parent cannot prevent timed restoration, resume accepts exactly one matching unexpired session, and stale/duplicate/tampered sessions fail closed. Also test a mode-`0600` ignored `audit-context.sh` with POSIX-safe single-quote escaping for spaces, Chinese, and literal apostrophes; when sourced in a fresh shell it must restore the exact repository CWD plus `LINGSHU_AUDIT_CHECKOUT`, `LINGSHU_TRANSFER_ROOT`, and `LINGSHU_RECEIPT_SHA256` without executing substituted text.

Required manual items explicitly distinguish a true Finder double-click from `/bin/sh start-demo.sh`: hostile ordinary PATH, first-created/second-reused cache, foreign port-holder survival, `--check`, `--no-browser`, occupied explicit port, Ctrl+C, Terminal-window close, URL unreachable, and port released. Safari WASM and Download ZIP may honestly be `not-installed`/`not-run`; Download ZIP remains experimental.

Run: `npm.cmd --prefix web_demo test -- --run tests/unit/acceptance-platforms.test.mjs`

Expected: FAIL because the interactive recorder is absent.

- [ ] **Step 2: Implement the interactive recorder and package command**

Add `record:macos-manual-observations`. The CLI auto-records commit/time/macOS/hardware using Git, `os.release()`, and the fixed sysctl, then guides and prompts one strict status/diagnostic for each physical observation. Implement the Finder hostile-PATH check as a two-phase stock-Terminal workflow, not a requirement for Codex/VS Code or for one controller process to survive Terminal shutdown. `--prepare-finder-path-test` requires the already verified absolute checkout plus `LINGSHU_TRANSFER_ROOT` and 64-hex `LINGSHU_RECEIPT_SHA256`, creates temporary sentinel executables, saves `/bin/launchctl getenv PATH`, atomically writes one ignored session record with commit, prior-state, deadline, and recovery identity, and atomically writes mode-`0600` `audit-context.sh`. That context exports the three audit variables, changes back to the exact checkout, and contains only rigorously POSIX-single-quoted literals. The tool prints the exact one-line command that sources this context and invokes `--resume-finder-path-test`; it then starts a detached self-expiring five-minute watchdog, sets and verifies a sentinel-first GUI-session PATH, and exits normally with instructions to save the printed line, quit Terminal, and Finder-double-click the real `.command`. After the launch/shutdown observation, the operator opens a new Terminal and runs the printed line; sourcing keeps CWD/exports in that new interactive shell, resume requires the one matching session, checks that no sentinel executed, captures the operator's non-placeholder diagnostic, restores the exact prior PATH (or unsets it when originally absent), signals the watchdog complete, verifies restoration, and consumes the active session while retaining the context file for later audit steps. The watchdog and resume operation are both idempotent restorers; interruption/parent-kill tests prove recovery. Detached behavior exists only in this team evidence tool, never in judge launchers. The recorder shows the exact JSON destination, supports Ctrl+C without a partial file, validates all answers, atomically replaces only the ignored destination, and never leaves a launchd environment change behind.

- [ ] **Step 3: Return manual-observation tests to GREEN and commit**

```powershell
npm.cmd --prefix web_demo test -- --run tests/unit/acceptance-platforms.test.mjs
git add web_demo/package.json web_demo/tools/record_macos_manual_observations.mjs web_demo/tests/unit/acceptance-platforms.test.mjs
git commit -m "feat(web): capture physical Mac observations"
```

### Task 9D: Validate and atomically record formal Apple Silicon evidence

**Files:**
- Create: `web_demo/tools/record_macos_acceptance_evidence.mjs`
- Modify: `web_demo/tests/unit/acceptance-platforms.test.mjs`
- Modify: `web_demo/tests/unit/acceptance-evidence-recorder.test.mjs`
- Modify: `web_demo/package.json`

- [ ] **Step 1: Write and observe formal-recorder RED**

Use temporary Git repositories to freeze the commit graph `I <- W`. Require `W^ == I`, Windows JSON `testedCommit == I`, Mac automated report/manual observations/fresh copy all equal `W`, and `git diff --name-only I..W` equals only `results/web_demo_acceptance/latest.json`. Require the manual statuses for true Finder double-click, guided hostile-PATH selection of bundled arm64, first-created/second-reused cache, surviving foreign holders plus ephemeral fallback, `--check`, `--no-browser`, occupied explicit port, Chrome real inference, Ctrl+C, Terminal-window close, URL unreachable, and port released all to be `pass`. Gatekeeper is acceptable only as `allowed`, or `open-required` with a separate `recoveryResult: pass`; `blocked` and `not-observed` prevent formal evidence. Only Edge, Safari, and Download ZIP may be `not-installed`, `not-run`, or a recorded optional failure. Write a Windows evidence canary, run the Mac recorder, and assert its bytes never change. Assert the Mac JSON bytes are UTF-8 without BOM, use LF only, and end in exactly one LF. Reject Intel hardware, bundled x86 runtime, mismatched parity transfer/handoff receipt, dirty tracked state, missing manual input, or optional results falsely promoted to required support.

Run: `npm.cmd --prefix web_demo test -- --run tests/unit/acceptance-platforms.test.mjs tests/unit/acceptance-evidence-recorder.test.mjs`

Expected: FAIL because the formal Mac recorder is absent.

- [ ] **Step 2: Implement exact relationship checks and atomic output**

Add `record:macos-acceptance-evidence`. Require explicit `--implementation-tree-commit`, `--manual-observations`, `--handoff-receipt`, and `--handoff-receipt-sha256` arguments. The recorder computes/validates the graph, evidence-only diff, receipt `I/W`, actual bundle digest, parity-transfer-manifest digest, the checked-out Windows evidence digest, and mandatory manual pass matrix itself. It rejects a receipt whose `windowsEvidenceSha256` differs from `results/web_demo_acceptance/latest.json`. It merges automated/manual inputs into the strict Mac schema from Task 9A; `parityTransfer` embeds the manifest digest and exact 16-payload count, while `relationships` embeds receipt, bundle, and Windows-evidence digests. Serialize with `JSON.stringify(..., null, 2) + "\n"` and atomically write UTF-8 without BOM only to `results/web_demo_acceptance/macos-apple-silicon/latest.json`. `testedCommit` is the actually executed `W`; `implementationTreeCommit` is `I`. Timing fields are machine-specific. Edge and Safari remain optional facts, never inferred support.

An Intel-on-Rosetta experiment is ignored diagnostics only at `web_demo/.generated-tests/macos-acceptance/rosetta-intel-runtime.json`. It must be produced by manually extracting the already verified Intel archive and executing its absolute interpreter with `/usr/bin/arch -x86_64` for the self-test; never add a launcher host override, never feed it to the formal recorder, and never remove the native Intel unverified label.

- [ ] **Step 3: Run the full evidence-tooling suite and commit**

```powershell
npm.cmd --prefix web_demo test -- --run tests/unit/browser-acceptance.test.mjs tests/unit/acceptance-evidence-recorder.test.mjs tests/unit/acceptance-platforms.test.mjs tests/unit/parity-transfer.test.mjs
git add web_demo/package.json web_demo/tools/record_macos_acceptance_evidence.mjs web_demo/tests/unit/acceptance-platforms.test.mjs web_demo/tests/unit/acceptance-evidence-recorder.test.mjs
git commit -m "feat(web): add formal Apple Silicon evidence recorder"
```

Expected: all evidence-tool unit tests pass; the tracked Windows evidence remains byte-for-byte unchanged.

### Task 9E: Freeze the final functional implementation footprint

**Files:**
- Modify: `web_demo/tests/unit/build-packaging.test.ts`
- Modify: `web_demo/README.md`

- [ ] **Step 1: Tighten the footprint contract and observe RED**

Change the packaging test from the Task 8 two-state transition allowance to require exactly `Measurement kind: final portable implementation before measurement-only docs commit`. Continue parsing all six labels, require the measured commit to be an ancestor of the current checkout, recompute tracked Git blob bytes and the three-runtime subtotal from that stated commit, and require exact byte/MiB equality. Do not compare against checkout allocation, `.git` history, or the dirty worktree.

Run:

```powershell
npm.cmd --prefix web_demo test -- --run tests/unit/build-packaging.test.ts
```

Expected: FAIL because the README still records the Task 7 baseline.

- [ ] **Step 2: Measure the clean committed Task 9D tree**

With only the failing packaging-test edit in the worktree, measure committed `HEAD` (the just-completed Task 9D implementation), not the dirty worktree:

```powershell
$measuredCommit = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "Could not resolve the final functional commit" }
$sizes = git ls-tree -r --format="%(objectsize)" $measuredCommit
if ($LASTEXITCODE -ne 0) { throw "git ls-tree failed" }
$trackedBytes = [int64](($sizes | ForEach-Object { [int64]$_ } | Measure-Object -Sum).Sum)
$runtimePaths = @(
    "web_demo/runtimes/windows-x86_64-python.zip",
    "web_demo/runtimes/macos-arm64-python.tar.gz",
    "web_demo/runtimes/macos-x86_64-python.tar.gz"
)
$runtimeBytes = [int64]0
foreach ($runtimePath in $runtimePaths) {
    $runtimeBytes += [int64](git cat-file -s "${measuredCommit}:$runtimePath")
    if ($LASTEXITCODE -ne 0) { throw "Missing committed runtime: $runtimePath" }
}
if ($runtimeBytes -ne 60787627) { throw "Runtime total mismatch: $runtimeBytes" }
[PSCustomObject]@{
    measuredCommit = $measuredCommit
    trackedBytes = $trackedBytes
    trackedMiB = [Math]::Round($trackedBytes / 1MB, 2)
    runtimeBytes = $runtimeBytes
    runtimeMiB = [Math]::Round($runtimeBytes / 1MB, 2)
}
```

Replace only the six-line footprint block in `web_demo/README.md`: use the final measurement-kind string, the exact `$measuredCommit`, and the four exact values printed above. The recorded commit intentionally excludes the self-referential measurement-only README/test commit, but includes every portable runtime, launcher, server, test, CI, packaging, parity, and evidence-tool implementation through Task 9D.

- [ ] **Step 3: Return the final footprint contract to GREEN and commit**

```powershell
npm.cmd --prefix web_demo test -- --run tests/unit/build-packaging.test.ts
git add web_demo/README.md web_demo/tests/unit/build-packaging.test.ts
git commit -m "docs(web): record portable repository footprint"
```

Expected: the test recomputes the exact recorded commit and totals successfully. Later evidence-only and support-doc commits may remain descendants without changing what this implementation-footprint measurement means.

### Task 10: Run the complete implementation regression and freeze a tested commit

**Files:**
- None — verification only

- [ ] **Step 1: Run every Python and frontend gate**

From repository root:

```powershell
$ErrorActionPreference = "Stop"
& .\.venv\Scripts\python.exe -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw "Python unittest gate failed" }
& .\.venv\Scripts\python.exe web_demo\tools\verify_distribution.py
if ($LASTEXITCODE -ne 0) { throw "WebDemo distribution gate failed" }
& .\.venv\Scripts\python.exe web_demo\tools\runtime_distribution.py
if ($LASTEXITCODE -ne 0) { throw "Runtime archive gate failed" }
npm.cmd --prefix web_demo test
if ($LASTEXITCODE -ne 0) { throw "Frontend unit gate failed" }
npm.cmd --prefix web_demo run typecheck
if ($LASTEXITCODE -ne 0) { throw "TypeScript gate failed" }
npm.cmd --prefix web_demo run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build gate failed" }
npm.cmd --prefix web_demo run verify:dist
if ($LASTEXITCODE -ne 0) { throw "Committed dist drift gate failed" }
```

Expected: all commands exit 0; `verify:dist` produces no diff.

- [ ] **Step 2: Exercise the real Windows embedded runtime, not only fixtures**

Never delete an existing cache. From repository root, atomically move the exact direct-child cache to the ignored backup root if it exists:

```powershell
$webDemoRoot = (Resolve-Path "web_demo").Path
$cachePath = Join-Path $webDemoRoot ".runtime-cache"
$backupRoot = Join-Path $webDemoRoot ".runtime-cache-backups"
if ([IO.Directory]::Exists($cachePath)) {
    $cacheItem = Get-Item -LiteralPath $cachePath -Force
    if (($cacheItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Runtime cache root is a reparse point" }
    if ([IO.Path]::GetFullPath($cachePath) -ne [IO.Path]::Combine($webDemoRoot, ".runtime-cache")) { throw "Runtime cache is not the expected direct child" }
    if ([IO.Directory]::Exists($backupRoot)) {
        $backupItem = Get-Item -LiteralPath $backupRoot -Force
        if (($backupItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Runtime backup root is a reparse point" }
    } else {
        [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    }
    if ([IO.Path]::GetFullPath($backupRoot) -ne [IO.Path]::Combine($webDemoRoot, ".runtime-cache-backups")) { throw "Runtime backup root is not the expected direct child" }
    $backupPath = Join-Path $backupRoot ([guid]::NewGuid().ToString("N"))
    $backupPrefix = [IO.Path]::GetFullPath($backupRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not [IO.Path]::GetFullPath($backupPath).StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Runtime backup destination escapes its root" }
    [IO.Directory]::Move($cachePath, $backupPath)
    Write-Host "Preserved previous runtime cache at $backupPath"
}
```

Then run:

```powershell
cmd /d /c web_demo\start-demo.bat --check
if ($LASTEXITCODE -ne 0) { throw "First bundled BAT check failed" }
cmd /d /c web_demo\start-demo.bat --check
if ($LASTEXITCODE -ne 0) { throw "Second bundled BAT check failed" }
```

Expected: first output identifies bundled CPython 3.12.10 and `CACHE created`; second identifies `CACHE reused`; both show `ISOLATION` and distribution verification; neither probes system Python or starts a server.

- [ ] **Step 3: Verify scope, identities, modes, and clean tree**

Run these exact checks from repository root:

```powershell
$model = Get-Item -LiteralPath "web_demo\models\baseline2_njr_fp32.onnx"
if ($model.Length -ne 88123029) { throw "Model byte count changed" }
$modelHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $model.FullName).Hash.ToLowerInvariant()
if ($modelHash -ne "e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69") { throw "Model digest changed" }
.\.venv\Scripts\python.exe web_demo\tools\runtime_distribution.py
if ($LASTEXITCODE -ne 0) { throw "Runtime distribution audit failed" }
$implementationBase = git rev-parse refs/lingshu/portable-launcher-base
if ($LASTEXITCODE -ne 0) { throw "Missing portable-launcher base ref" }
$srcChanges = git diff --name-only $implementationBase..HEAD -- web_demo/src
if ($srcChanges) { throw "UI scope changed: $srcChanges" }
$executableModeLines = @(git ls-files --stage web_demo/start-demo.sh web_demo/start-demo.command web_demo/tools/bootstrap_macos.sh)
if ($LASTEXITCODE -ne 0 -or $executableModeLines.Count -ne 3 -or @($executableModeLines | Where-Object { $_ -notmatch '^100755 ' }).Count -ne 0) { throw "POSIX launcher modes are not all 100755" }
$libraryModeLines = @(git ls-files --stage web_demo/tools/bootstrap_posix_lib.sh)
if ($LASTEXITCODE -ne 0 -or $libraryModeLines.Count -ne 1 -or $libraryModeLines[0] -notmatch '^100644 ') { throw "POSIX source library mode is not 100644" }
git check-ignore -q web_demo/.runtime-cache
if ($LASTEXITCODE -ne 0) { throw "Runtime cache is not ignored" }
git check-ignore -q web_demo/.runtime-cache-backups
if ($LASTEXITCODE -ne 0) { throw "Runtime cache backups are not ignored" }
$trackedCache = git ls-files -- web_demo/.runtime-cache web_demo/.runtime-cache-backups
if ($trackedCache) { throw "Runtime cache state became tracked" }
git diff --check
if ($LASTEXITCODE -ne 0) { throw "Whitespace gate failed" }
$porcelain = @(git status --porcelain --untracked-files=normal)
if ($LASTEXITCODE -ne 0 -or $porcelain.Count -ne 0) { throw "Tracked worktree is not clean: $porcelain" }
git status --short --branch
```

The three shell index modes must be `100755`; the cache may exist after the two checks, but it must be ignored, unstaged, and untracked. `git status --short` must contain no non-ignored change.

- [ ] **Step 4: Stop on failure; freeze `I` only after every gate passes**

If any gate fails, stop without editing production code. Append a concrete `Task 10A` to this plan naming exact files, one RED test and expected failure, the minimum implementation, the GREEN command, and a specific Conventional Commit message; review that micro-task before executing it, then restart Task 10 Step 1. If every gate is green, create no empty commit. Record clean `git rev-parse HEAD` as implementation commit `I`.

### Task 11: Refresh Windows evidence against the frozen implementation commit

**Files:**
- Modify: `results/web_demo_acceptance/latest.json`

- [ ] **Step 1: Prove the evidence preconditions**

Require a clean tracked tree. Confirm the prior evidence's `testedCommit` differs from `I` and remains historical in Git. Preserve any runtime cache by rerunning Task 10's exact atomic cache-to-backup block; generated acceptance state may be overwritten only by its owning tools beneath the already ignored `.generated-tests` directory.

- [ ] **Step 2: Run fresh-copy Windows x86-64 acceptance**

Run the existing browser acceptance with default bundled mode on the fresh-copy launcher path, system Python unavailable to that launcher, a first extraction and second reuse observation, occupied-port fallback, `--check`, Edge WebGPU, forced WASM, real image inference, distribution failures, and foreground shutdown.

```powershell
npm.cmd --prefix web_demo run test:browser-acceptance
if ($LASTEXITCODE -ne 0) { throw "Windows browser acceptance failed" }
npm.cmd --prefix web_demo run test:preprocess-parity
if ($LASTEXITCODE -ne 0) { throw "Windows preprocessing parity failed" }
```

Expected: both commands exit 0; the ignored reports identify `I`; fresh-copy launcher uses the bundled Windows runtime; the URL is unreachable after termination.

- [ ] **Step 3: Export the already validated parity references for the Mac audit**

Do not make the fresh Mac install PyTorch/ONNX Runtime/Pillow/NumPy merely to regenerate reference tensors. Export the Windows-validated parity tree to a repository-external transfer directory:

```powershell
$implementationCommit = git rev-parse HEAD
$workspaceRoot = (Resolve-Path "..").Path
$transferRoot = Join-Path $workspaceRoot "LingShu-Mac-Transfer"
[IO.Directory]::CreateDirectory($transferRoot) | Out-Null
$parityTransferRoot = Join-Path $transferRoot ("parity-" + $implementationCommit)
npm.cmd --prefix web_demo run export:parity-transfer -- --output $parityTransferRoot
if ($LASTEXITCODE -ne 0) { throw "Parity transfer export failed" }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $parityTransferRoot "transfer.json")
```

The exporter must record `I`, verify all fifteen tensor entries and model/threshold identity, and refuse a dirty tracked tree. Preserve this directory outside Git for Task 12.

- [ ] **Step 4: Validate and commit the Windows evidence only**

The exporter ran first while the tracked tree was clean. Now let the recorder update the one tracked Windows JSON, validate it, and commit only that path. The unit validator supplies the exact v1 key check; this block adds relationship/output checks:

```powershell
$implementationCommit = git rev-parse HEAD
npm.cmd --prefix web_demo run record:acceptance-evidence
if ($LASTEXITCODE -ne 0) { throw "Windows evidence recorder failed" }
$windowsEvidenceBytes = [IO.File]::ReadAllBytes((Resolve-Path "results\web_demo_acceptance\latest.json"))
if ($windowsEvidenceBytes.Length -lt 2 -or ($windowsEvidenceBytes -contains 13) -or $windowsEvidenceBytes[-1] -ne 10 -or $windowsEvidenceBytes[-2] -eq 10 -or ($windowsEvidenceBytes.Length -ge 3 -and $windowsEvidenceBytes[0] -eq 239 -and $windowsEvidenceBytes[1] -eq 187 -and $windowsEvidenceBytes[2] -eq 191)) { throw "Windows evidence must be UTF-8 without BOM and end in exactly one LF" }
$windowsEvidence = Get-Content -Encoding UTF8 -LiteralPath "results\web_demo_acceptance\latest.json" | ConvertFrom-Json
if ($windowsEvidence.testedCommit -ne $implementationCommit) { throw "Windows evidence does not test I" }
$batchOutput = $windowsEvidence.browserAcceptance.freshCopy.batchCheck.output
foreach ($requiredLine in @("RUNTIME bundled CPython 3.12.10 (Windows x86_64)", "CACHE created", "CACHE reused", "ISOLATION sanitized environment; user site disabled; offline bootstrap", "Distribution verification passed.")) {
    if ($batchOutput -notmatch [Regex]::Escape($requiredLine)) { throw "Windows batch evidence is missing: $requiredLine" }
}
$workspaceRoot = (Resolve-Path "..").Path
$transferRoot = Join-Path $workspaceRoot "LingShu-Mac-Transfer"
$parityTransfer = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $transferRoot ("parity-" + $implementationCommit + "\transfer.json")) | ConvertFrom-Json
if ($parityTransfer.implementationCommit -ne $implementationCommit) { throw "Parity transfer does not identify I" }
git add results/web_demo_acceptance/latest.json
git commit -m "test(web): refresh portable Windows acceptance evidence"
$windowsEvidenceCommit = git rev-parse HEAD
if ((git rev-parse "$windowsEvidenceCommit^") -ne $implementationCommit) { throw "W is not the direct child of I" }
$windowsOnlyDiff = @(git diff --name-only $implementationCommit..$windowsEvidenceCommit)
if ($windowsOnlyDiff.Count -ne 1 -or $windowsOnlyDiff[0] -ne "results/web_demo_acceptance/latest.json") { throw "W contains non-evidence changes" }
```

Stage no README, cache, backup, parity transfer, or generated raw report. The resulting `$windowsEvidenceCommit` is `W` in Task 12.

### Task 12: Run physical Apple Silicon acceptance before publishing support

**Files:**
- Create: `results/web_demo_acceptance/macos-apple-silicon/latest.json`
- Modify: `results/web_demo_acceptance/README.md`
- Modify: `results/web_demo_acceptance/macos-apple-silicon/README.md`
- Modify: `README.md`
- Modify: `web_demo/README.md`

- [ ] **Step 1: Transfer or clone the exact clean branch commit to the physical Mac**

Do not require a push. On clean Windows commit `W`, create and verify a bundle outside the repository, then copy both it and the parity transfer directory through the chosen transport medium:

```powershell
$implementationCommit = (Get-Content -Encoding UTF8 "results\web_demo_acceptance\latest.json" | ConvertFrom-Json).testedCommit
$workspaceRoot = (Resolve-Path "..").Path
$transferRoot = Join-Path $workspaceRoot "LingShu-Mac-Transfer"
[IO.Directory]::CreateDirectory($transferRoot) | Out-Null
$windowsEvidenceCommit = git rev-parse HEAD
if ((git rev-parse "$windowsEvidenceCommit^") -ne $implementationCommit) { throw "Current HEAD is not W with parent I" }
$windowsOnlyDiff = @(git diff --name-only $implementationCommit..$windowsEvidenceCommit)
if ($windowsOnlyDiff.Count -ne 1 -or $windowsOnlyDiff[0] -ne "results/web_demo_acceptance/latest.json") { throw "W is not evidence-only" }
$porcelain = @(git status --porcelain --untracked-files=normal)
if ($porcelain.Count -ne 0) { throw "Windows branch is not clean at W: $porcelain" }
$bundleFile = "lingshu-webdemo-$windowsEvidenceCommit.bundle"
$bundlePath = Join-Path $transferRoot $bundleFile
git bundle create $bundlePath refs/heads/feat/web-demo
if ($LASTEXITCODE -ne 0) { throw "Bundle creation failed" }
git bundle verify $bundlePath
if ($LASTEXITCODE -ne 0) { throw "Bundle verification failed" }
$bundleSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundlePath).Hash.ToLowerInvariant()
$parityTransferRoot = Join-Path $transferRoot ("parity-" + $implementationCommit)
if (-not [IO.Directory]::Exists($parityTransferRoot)) { throw "Sealed parity transfer is missing" }
$parityManifestPath = Join-Path $parityTransferRoot "transfer.json"
$parityManifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $parityManifestPath).Hash.ToLowerInvariant()
$windowsEvidenceCommit = git rev-parse HEAD
$windowsEvidenceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath "results\web_demo_acceptance\latest.json").Hash.ToLowerInvariant()
$receiptPath = Join-Path $transferRoot "handoff-receipt.json"
$receipt = [ordered]@{
    schemaVersion = 1
    implementationCommit = $implementationCommit
    windowsEvidenceCommit = $windowsEvidenceCommit
    bundleFile = $bundleFile
    bundleSha256 = $bundleSha256
    parityTransferManifestSha256 = $parityManifestSha256
    windowsEvidenceSha256 = $windowsEvidenceSha256
}
$receiptJson = ($receipt | ConvertTo-Json -Depth 3) + "`n"
[IO.File]::WriteAllText($receiptPath, $receiptJson, [Text.UTF8Encoding]::new($false))
$receiptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $receiptPath).Hash.ToLowerInvariant()
Write-Host "Record this handoff receipt SHA-256 out of band: $receiptSha256"
```

Record `$receiptSha256` separately from the transferred folder (for example in the task notes); copying a receipt beside the bytes without checking its out-of-band digest is not verification. Before this Mac-side block, provision/preflight the team-audit system CPython 3.11+ described in Step 2; that interpreter is not a judge-launch dependency. Set `LINGSHU_TRANSFER_ROOT` to the absolute received directory and `LINGSHU_RECEIPT_SHA256` to that separately recorded digest. Verify every receipt identity before clone, then clone into a fresh path containing spaces and Chinese characters:

```sh
set -eu
: "${LINGSHU_TRANSFER_ROOT:?set LINGSHU_TRANSFER_ROOT to the received absolute directory}"
: "${LINGSHU_RECEIPT_SHA256:?set LINGSHU_RECEIPT_SHA256 from the out-of-band record}"
case "$LINGSHU_TRANSFER_ROOT" in /*) ;; *) echo "transfer root must be absolute" >&2; exit 1 ;; esac
receipt="$LINGSHU_TRANSFER_ROOT/handoff-receipt.json"
set -- $(/usr/bin/shasum -a 256 "$receipt")
test "$1" = "$LINGSHU_RECEIPT_SHA256"
I="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["implementationCommit"])' "$receipt")"
W="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["windowsEvidenceCommit"])' "$receipt")"
expected_bundle_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["bundleSha256"])' "$receipt")"
expected_parity_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["parityTransferManifestSha256"])' "$receipt")"
expected_windows_evidence_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["windowsEvidenceSha256"])' "$receipt")"
bundle_file="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["bundleFile"])' "$receipt")"
set -- $(/usr/bin/shasum -a 256 "$LINGSHU_TRANSFER_ROOT/$bundle_file")
test "$1" = "$expected_bundle_sha"
set -- $(/usr/bin/shasum -a 256 "$LINGSHU_TRANSFER_ROOT/parity-$I/transfer.json")
test "$1" = "$expected_parity_sha"
git bundle list-heads "$LINGSHU_TRANSFER_ROOT/$bundle_file" | /usr/bin/grep -Fx "$W refs/heads/feat/web-demo"
audit_root="$(/usr/bin/mktemp -d /tmp/lingshu-mac-audit.XXXXXX)"
checkout="$audit_root/LingShu 评测 中文路径"
git clone --branch feat/web-demo "$LINGSHU_TRANSFER_ROOT/$bundle_file" "$checkout"
cd "$checkout"
git -C "$checkout" bundle verify "$LINGSHU_TRANSFER_ROOT/$bundle_file"
test "$(git rev-parse HEAD)" = "$W"
set -- $(/usr/bin/shasum -a 256 "results/web_demo_acceptance/latest.json")
test "$1" = "$expected_windows_evidence_sha"
test "$(python3 -c 'import json; print(json.load(open("results/web_demo_acceptance/latest.json", encoding="utf-8"))["testedCommit"])')" = "$I"
test "$(git rev-parse "HEAD^")" = "$I"
test "$(git diff --name-only "$I..$W")" = "results/web_demo_acceptance/latest.json"
test -z "$(git status --porcelain)"
```

Record the bundle and transfer-manifest SHA values. `checkoutTransport` is `git-bundle-clone`; its Gatekeeper observation must not be described as proof for a GitHub remote clone.

- [ ] **Step 2: Prepare explicit team-audit dependencies and run platform gates**

The physical evidence machine must have system CPython 3.11+ for standard-library tests, Node/npm for the evidence harness, Chrome, and the stock macOS `/bin/launchctl` plus `/usr/bin/nohup` used by the self-restoring manual-observation watchdog; Edge is optional. No IDE or non-Terminal controller is required. These are team-audit dependencies, not judge-launch dependencies. Install locked Node packages once with `npm --prefix web_demo ci`. Do not install the Windows ML requirements on Mac; the sealed parity input replaces reference regeneration.

From repository root run:

```sh
set -eu
python3 -c 'import sys; assert sys.implementation.name == "cpython" and sys.version_info >= (3, 11); print(sys.version)'
node --version
npm --version
test -x /bin/launchctl
test -x /usr/bin/nohup
npm --prefix web_demo ci
python3 -m unittest tests.test_web_demo_server tests.test_web_demo_distribution tests.test_web_demo_runtime_distribution tests.test_web_demo_bootstrap tests.test_web_demo_launcher -v
python3 web_demo/tools/runtime_distribution.py
/bin/sh -n web_demo/start-demo.sh web_demo/start-demo.command web_demo/tools/bootstrap_macos.sh web_demo/tools/bootstrap_posix_lib.sh
npm --prefix web_demo test
npm --prefix web_demo run typecheck
npm --prefix web_demo run build
npm --prefix web_demo run verify:dist
```

Any failure invalidates the attempt and returns to a reviewed RED/GREEN micro-task before creating evidence.

- [ ] **Step 3: Record Finder, cache, port, browser, and shutdown matrix**

On Apple Silicon, perform every item from the design: true Finder double-click of `start-demo.command`; hostile ordinary PATH; first `CACHE created`; second `CACHE reused`; real image inference; all 8765–8784 held by unrelated processes followed by an ephemeral port without killing them; `--check`; `--no-browser`; occupied explicit `--port`; Chrome WebGPU and forced WASM; Edge WebGPU/WASM if installed; Safari WASM best effort; Ctrl+C and Terminal-window shutdown with URL/port unreachable; and transport-specific Gatekeeper observations. For the hostile-PATH/Finder case, first run `npm --prefix web_demo run record:macos-manual-observations -- --prepare-finder-path-test`, save the exact source-and-resume line it prints, follow its instruction to quit Terminal and Finder-double-click the real entry, then paste that exact line into the newly opened Terminal. Before continuing, require it to report successful PATH restoration and check `pwd -P`, `LINGSHU_AUDIT_CHECKOUT`, `LINGSHU_TRANSFER_ROOT`, and `LINGSHU_RECEIPT_SHA256`; the sourced context deliberately keeps those values in the new shell for Steps 4–6. Test Download ZIP separately only if time permits and label it experimental regardless of `chmod`.

Run `npm --prefix web_demo run record:macos-manual-observations` and answer every strict prompt with the observed status plus a non-empty diagnostic. If Rosetta is installed, optionally verify the Intel archive manually with `/usr/bin/arch -x86_64` and write only the ignored diagnostic named in Task 9D. Do not add a host override or remove the native Intel unverified label.

- [ ] **Step 4: Generate and validate separate Mac evidence**

Run from repository root with the sealed transfer and explicit implementation commit:

```sh
set -eu
: "${LINGSHU_AUDIT_CHECKOUT:?source the printed audit-context line after Terminal restart}"
: "${LINGSHU_TRANSFER_ROOT:?source the printed audit-context line after Terminal restart}"
: "${LINGSHU_RECEIPT_SHA256:?source the printed audit-context line after Terminal restart}"
cd "$LINGSHU_AUDIT_CHECKOUT"
test "$(pwd -P)" = "$LINGSHU_AUDIT_CHECKOUT"
set -- $(/usr/bin/shasum -a 256 "$LINGSHU_TRANSFER_ROOT/handoff-receipt.json")
test "$1" = "$LINGSHU_RECEIPT_SHA256"
W="$(git rev-parse HEAD)"
I="$(python3 -c 'import json; print(json.load(open("results/web_demo_acceptance/latest.json", encoding="utf-8"))["testedCommit"])')"
npm --prefix web_demo run test:browser-acceptance -- --parity-input "$LINGSHU_TRANSFER_ROOT/parity-$I" --implementation-tree-commit "$I"
npm --prefix web_demo run record:macos-acceptance-evidence -- --implementation-tree-commit "$I" --manual-observations "$(pwd)/web_demo/.generated-tests/macos-acceptance/manual-observations.json" --handoff-receipt "$LINGSHU_TRANSFER_ROOT/handoff-receipt.json" --handoff-receipt-sha256 "$LINGSHU_RECEIPT_SHA256"
```

Expected: the Mac recorder proves hardware/runtime arm64, accepts the checked-out `W`, sets `testedCommit = W` and `implementationTreeCommit = I`, writes only `results/web_demo_acceptance/macos-apple-silicon/latest.json`, records machine/browser/runtime/cache/timing/manual/transport facts, and leaves Windows evidence unchanged.

- [ ] **Step 5: Commit the Mac evidence as an evidence-only commit**

Verify the generated JSON's `testedCommit == W == HEAD`, `implementationTreeCommit == I`, and the Windows evidence file is byte-for-byte unchanged. Stage only the Mac JSON.

```sh
set -eu
: "${LINGSHU_AUDIT_CHECKOUT:?source audit-context.sh before committing Mac evidence}"
cd "$LINGSHU_AUDIT_CHECKOUT"
test "$(pwd -P)" = "$LINGSHU_AUDIT_CHECKOUT"
W="$(git rev-parse HEAD)"
I="$(python3 -c 'import json; print(json.load(open("results/web_demo_acceptance/latest.json", encoding="utf-8"))["testedCommit"])')"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1], encoding="utf-8")); assert d["testedCommit"] == sys.argv[2]; assert d["implementationTreeCommit"] == sys.argv[3]; assert d["result"] == "pass"' results/web_demo_acceptance/macos-apple-silicon/latest.json "$W" "$I"
test -z "$(git diff --name-only -- results/web_demo_acceptance/latest.json)"
test "$(git status --porcelain --untracked-files=normal)" = "?? results/web_demo_acceptance/macos-apple-silicon/latest.json"
git add results/web_demo_acceptance/macos-apple-silicon/latest.json
git commit -m "test(web): record Apple Silicon portable acceptance"
M="$(git rev-parse HEAD)"
test "$(git rev-parse "HEAD^")" = "$W"
test "$(git rev-list --count "$W..$M")" = "1"
```

Record this evidence commit as `M`; require `M^ == W`.

- [ ] **Step 6: Return `M` to Windows without overwriting the branch**

On Mac, write a return bundle outside the repository:

```sh
set -eu
: "${LINGSHU_AUDIT_CHECKOUT:?source audit-context.sh before creating the return bundle}"
: "${LINGSHU_TRANSFER_ROOT:?source audit-context.sh before creating the return bundle}"
cd "$LINGSHU_AUDIT_CHECKOUT"
test "$(pwd -P)" = "$LINGSHU_AUDIT_CHECKOUT"
git bundle create "$LINGSHU_TRANSFER_ROOT/lingshu-mac-M.bundle" refs/heads/feat/web-demo
/usr/bin/shasum -a 256 "$LINGSHU_TRANSFER_ROOT/lingshu-mac-M.bundle"
```

Copy `lingshu-mac-M.bundle` back into the Windows `LingShu-Mac-Transfer` directory. On Windows, require the local branch still clean at `W`, verify/fetch to a separate remote-tracking ref, prove ancestry/diff, then fast-forward:

```powershell
$workspaceRoot = (Resolve-Path "..").Path
$transferRoot = Join-Path $workspaceRoot "LingShu-Mac-Transfer"
$returnBundle = Join-Path $transferRoot "lingshu-mac-M.bundle"
git bundle verify $returnBundle
Get-FileHash -Algorithm SHA256 -LiteralPath $returnBundle
if (git status --porcelain) { throw "Local branch is dirty" }
$windowsEvidenceCommit = git rev-parse HEAD
$implementationCommit = (Get-Content -Encoding UTF8 "results\web_demo_acceptance\latest.json" | ConvertFrom-Json).testedCommit
if ((git rev-parse "$windowsEvidenceCommit^") -ne $implementationCommit) { throw "Local HEAD is not the Windows evidence commit W" }
$windowsOnlyDiff = @(git diff --name-only $implementationCommit..$windowsEvidenceCommit)
if ($windowsOnlyDiff.Count -ne 1 -or $windowsOnlyDiff[0] -ne "results/web_demo_acceptance/latest.json") { throw "Local W contains non-evidence changes" }
git fetch $returnBundle refs/heads/feat/web-demo
if ($LASTEXITCODE -ne 0) { throw "Return bundle fetch failed" }
$returnedCommit = git rev-parse FETCH_HEAD
git merge-base --is-ancestor HEAD $returnedCommit
if ($LASTEXITCODE -ne 0) { throw "Returned Mac branch is not a descendant of W" }
$returnedCount = [int](git rev-list --count "HEAD..$returnedCommit")
if ($returnedCount -ne 1) { throw "Return must contain exactly one commit M after W" }
if ((git rev-parse "$returnedCommit^") -ne $windowsEvidenceCommit) { throw "M is not the direct child of W" }
$returnedDiff = @(git diff --name-only HEAD..$returnedCommit)
if ($returnedDiff.Count -ne 1 -or $returnedDiff[0] -ne "results/web_demo_acceptance/macos-apple-silicon/latest.json") { throw "Mac return contains non-evidence changes: $returnedDiff" }
git diff --exit-code HEAD..$returnedCommit -- results/web_demo_acceptance/latest.json
if ($LASTEXITCODE -ne 0) { throw "M changed the Windows evidence blob" }
$macEvidenceText = @(git show "${returnedCommit}:results/web_demo_acceptance/macos-apple-silicon/latest.json") -join "`n"
if ($LASTEXITCODE -ne 0) { throw "Returned Mac evidence is unreadable" }
$macEvidence = $macEvidenceText | ConvertFrom-Json
if ($macEvidence.testedCommit -ne $windowsEvidenceCommit) { throw "Mac evidence testedCommit is not W" }
if ($macEvidence.implementationTreeCommit -ne $implementationCommit) { throw "Mac evidence implementationTreeCommit is not I" }
$receiptPath = Join-Path $transferRoot "handoff-receipt.json"
$receiptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $receiptPath).Hash.ToLowerInvariant()
$receipt = Get-Content -Encoding UTF8 -LiteralPath $receiptPath | ConvertFrom-Json
$windowsEvidenceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath "results\web_demo_acceptance\latest.json").Hash.ToLowerInvariant()
if ($receipt.windowsEvidenceSha256 -ne $windowsEvidenceSha256) { throw "Original Windows evidence no longer matches its receipt" }
$parityPath = Join-Path $transferRoot ("parity-" + $implementationCommit + "\transfer.json")
$paritySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $parityPath).Hash.ToLowerInvariant()
if ($receipt.parityTransferManifestSha256 -ne $paritySha256) { throw "Original parity transfer no longer matches its receipt" }
if ($macEvidence.parityTransfer.manifestSha256 -ne $paritySha256) { throw "Mac evidence parity digest differs from the Windows export" }
if ($macEvidence.relationships.handoffReceiptSha256 -ne $receiptSha256) { throw "Mac evidence receipt digest differs from the Windows receipt" }
if ($macEvidence.relationships.bundleSha256 -ne $receipt.bundleSha256) { throw "Mac evidence bundle digest differs from the Windows receipt" }
if ($macEvidence.relationships.windowsEvidenceSha256 -ne $windowsEvidenceSha256) { throw "Mac evidence Windows digest differs from W" }
git merge --ff-only $returnedCommit
if ($LASTEXITCODE -ne 0) { throw "Fast-forward to M failed" }
if ((git rev-parse HEAD) -ne $returnedCommit -or (git rev-parse "HEAD^") -ne $windowsEvidenceCommit) { throw "Final local M/W relationship is invalid" }
```

- [ ] **Step 7: Publish only evidence-backed support language in a separate docs commit**

After Windows receives `M`, first run the first two PowerShell lines below to prove the worktree is clean. Then, in that same session, change Apple Silicon wording from pending to formally recorded only for the exact macOS/browser/checkout-transport combinations in evidence before continuing with the test/commit lines. Keep timings machine-specific, Git-bundle Gatekeeper observations transport-specific, Download ZIP experimental unless separately proven, and native Intel bundled but unverified.

```powershell
$macEvidenceCommit = git rev-parse HEAD
if (git status --porcelain) { throw "Worktree must be clean at M before support-doc edits" }
# Pause here, make only the four support-document edits described above, then continue.
npm.cmd --prefix web_demo test -- --run tests/unit/build-packaging.test.ts tests/unit/acceptance-platforms.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Evidence-aware documentation tests failed" }
git add results/web_demo_acceptance/README.md results/web_demo_acceptance/macos-apple-silicon/README.md README.md web_demo/README.md
git commit -m "docs(web): publish recorded Apple Silicon support"
$docsCommit = git rev-parse HEAD
if ((git rev-parse "$docsCommit^") -ne $macEvidenceCommit) { throw "D is not the direct child of M" }
$expectedDocs = @(
    "README.md",
    "results/web_demo_acceptance/README.md",
    "results/web_demo_acceptance/macos-apple-silicon/README.md",
    "web_demo/README.md"
) | Sort-Object
$docsDiff = @(git diff --name-only $macEvidenceCommit..$docsCommit | Sort-Object)
if (@(Compare-Object $expectedDocs $docsDiff).Count -ne 0) { throw "D is not the exact support-doc commit: $docsDiff" }
```

Require `D^ == M`; do not push any of `W`, `M`, or `D` unless the user separately asks.

## Final completion gate

The launcher slice is complete only after Tasks 1–11 are green and committed and Task 12 has real physical Apple Silicon evidence. Freeze and verify the linear graph `I <- W <- M <- D`: Windows JSON tests `I`; Mac JSON tests checked-out `W` and identifies implementation tree `I`; `W` changes only Windows evidence; `M` changes only Mac evidence; `D` changes only support docs. Before presenting completion, rerun Task 10's full gates, `git diff --check`, archive/model identities, exact tracked modes, evidence relationships, and `git status --short --branch`. Old Windows evidence, Windows-hosted shell tests, CI smoke, and Rosetta diagnostics are never substitutes for physical platform evidence.
