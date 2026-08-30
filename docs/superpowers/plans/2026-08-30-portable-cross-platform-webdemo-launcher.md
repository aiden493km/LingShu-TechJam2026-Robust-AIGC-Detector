# Portable Cross-Platform WebDemo Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a judge clone the repository and launch the existing FP32 WebDemo by double-clicking on Windows x86-64 or Apple Silicon macOS, without installing Python, Node.js, packages, or a server.

**Architecture:** Keep the existing browser application, model, inference path, and loopback server. Commit one pinned Python archive per target platform; a small native bootstrap verifies the archive, extracts it into a repository-local cache, and runs `serve_demo.py` with the bundled interpreter. This is the minimum competition-ready slice: two launchers, one cache convention, existing tests, simple CI, and real-machine smoke evidence.

**Tech Stack:** Windows BAT and PowerShell 5.1, POSIX `/bin/sh`, CPython 3.12 standard library, Python `unittest`, existing React/Vite/ONNX Runtime Web.

---

## Scope and success criteria

This plan supersedes the earlier release-grade version of this document. It intentionally follows four rules: make assumptions visible, implement the minimum requested behavior, touch only launcher-related files, and verify user-visible outcomes.

Assumptions:

- The judge targets are Windows 10+ x86-64 and Apple Silicon macOS. Native Intel macOS is not part of this deadline slice.
- The unchanged model is `web_demo/models/baseline2_njr_fp32.onnx`, exactly 88,123,029 bytes with SHA-256 `e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69`.
- The default path always uses the repository runtime. There is no new `--system-python` mode and no runtime download during judge launch.
- Existing Linux behavior in `start-demo.sh` remains intact, but Linux is not a bundled-runtime target.
- The team has no Apple Developer ID. The launcher gives honest Gatekeeper guidance and never runs `sudo` or removes quarantine attributes.

Done means:

1. `start-demo.bat --check` succeeds with no usable system Python on Windows x86-64.
2. Finder double-click and `./start-demo.command --check` succeed with no usable system Python on Apple Silicon.
3. First launch creates a verified local cache; later launch reuses it.
4. A foreign process on port 8765 survives while the demo selects another loopback port.
5. A real image completes FP32 browser inference on both physical platforms.
6. Existing Python/frontend tests pass and no file under `web_demo/src/` changes.

Deferred until after the local demo works: Intel macOS, signing/notarization, online hosting, automatic evidence recorders, parity-transfer tooling, multi-commit evidence graphs, and UI redesign. Impeccable belongs to that later UI phase.

## File map

```text
.gitattributes                                  # binary runtime and launcher EOL rules
.gitignore                                      # repository-local runtime cache
THIRD_PARTY_NOTICES.md                          # two bundled Python distributions
.github/workflows/web-demo-portable.yml         # Windows and Apple Silicon smoke jobs

tests/
├── test_web_demo_server.py                     # embedded-runtime import/port/output behavior
├── test_web_demo_launcher.py                   # existing wrapper behavior and quoting
└── test_web_demo_portable.py                   # two archive identities and native launcher smoke

web_demo/
├── start-demo.bat                              # Windows double-click entry
├── start-demo.command                          # macOS Finder entry
├── start-demo.sh                               # macOS delegation; current Linux path preserved
├── runtimes/
│   ├── windows-x86_64-python.zip              # CPython 3.12.10 embeddable
│   └── macos-arm64-python.tar.gz              # CPython 3.12.14 standalone
└── tools/
    ├── bootstrap_windows.ps1                  # verify/cache/run Windows runtime
    ├── bootstrap_macos.sh                     # verify/cache/run Apple Silicon runtime
    └── serve_demo.py                          # embedded import and clear launch output

README.md                                       # top-level quick start
web_demo/README.md                              # local launch/troubleshooting details
results/web_demo_acceptance/portable-launchers.md
                                                # concise physical Windows/macOS observations
```

`web_demo/.runtime-cache/` is ignored derived state. Bootstrap scripts may replace only their own exact cache child; they never inspect or terminate unrelated processes and never use another project's environment.

## Preflight (no commit)

- [ ] Confirm `git branch --show-current` prints `feat/web-demo` and `git status --short` is empty.
- [ ] Record `git rev-parse HEAD` and run the existing baseline:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server tests.test_web_demo_launcher tests.test_web_demo_distribution -v
npm.cmd --prefix web_demo test
npm.cmd --prefix web_demo run typecheck
```

- [ ] Stop if the baseline fails for a reason unrelated to this launcher slice.

### Task 1: Make the existing server safe for bundled Python

**Files:**
- Modify: `tests/test_web_demo_server.py`
- Modify: `web_demo/tools/serve_demo.py`

- [ ] **Step 1: Add focused failing tests**

Add tests for only the two gaps that affect bundled launch:

```python
def test_direct_script_loads_verifier_from_its_own_tools_directory(self):
    copied_tools, decoy = self.copy_server_verifier_and_decoy()
    module = self.load_server(copied_tools / "serve_demo.py", sys_path_first=decoy)
    verifier = module._load_distribution_verifier()
    self.assertEqual(
        Path(verifier.__globals__["__file__"]).resolve(),
        (copied_tools / "verify_distribution.py").resolve(),
    )
    self.assertFalse((decoy / "decoy-imported.txt").exists())


def test_explicit_port_zero_is_rejected_before_validation_or_binding(self):
    with self.assertRaises(SystemExit) as raised:
        main(["--port", "0"], repository_root=self.root)
    self.assertEqual(raised.exception.code, 2)
```

Also extend the existing normal-launch test to require `VERIFIED`, `READY`, and `STOP` in that order, and require a failed `webbrowser.open()` to print the URL while leaving the server alive.

- [ ] **Step 2: Run RED**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server.RuntimeAndCliTests tests.test_web_demo_server.BindingTests -v
```

Expected: the sibling-import and explicit-zero tests fail.

- [ ] **Step 3: Implement the minimum server changes**

Replace the direct sibling import with one lazy, path-anchored loader while preserving the public `verify_distribution()` wrapper used by existing mocks:

```python
def _load_distribution_verifier():
    verifier_path = Path(__file__).resolve().with_name("verify_distribution.py")
    specification = importlib.util.spec_from_file_location(
        "_lingshu_verify_distribution",
        verifier_path,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError(f"Could not load distribution verifier: {verifier_path}")
    module = importlib.util.module_from_spec(specification)
    sys.modules[specification.name] = module
    try:
        specification.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(specification.name, None)
        raise
    return module.verify_distribution
```

Change explicit port validation to `1 <= port <= 65535`; keep internal ephemeral port zero only after 8765–8784 are exhausted. Print these stable lines:

```text
VERIFIED FP32 model and WebDemo distribution
READY http://127.0.0.1:8765/
STOP Press Ctrl+C or close this window to stop the local server.
```

The shown port is an example; tests match `READY http://127.0.0.1:[0-9]+/` and use the actual selected value.

If browser opening raises or returns false, print `Open the READY URL manually:` plus the same URL and continue serving.

- [ ] **Step 4: Run GREEN and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_server -v
git add web_demo/tools/serve_demo.py tests/test_web_demo_server.py
git commit -m "fix(web): support bundled Python server startup"
```

### Task 2: Commit only the two runtimes the judges need

**Files:**
- Create: `tests/test_web_demo_portable.py`
- Create: `web_demo/runtimes/windows-x86_64-python.zip`
- Create: `web_demo/runtimes/macos-arm64-python.tar.gz`
- Modify: `.gitattributes`
- Modify: `.gitignore`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Add the failing identity test**

Create `PortableRuntimeArtifactTests` with these exact constants:

```python
RUNTIMES = {
    "windows-x86_64-python.zip": (
        11_133_606,
        "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3",
        "python.exe",
    ),
    "macos-arm64-python.tar.gz": (
        24_970_238,
        "8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6",
        "python/bin/python3",
    ),
}
```

For each archive, assert exact bytes, streaming SHA-256, and the expected entrypoint member. Assert the two archives total exactly `36_103_844` bytes. In the same class, assert the existing ONNX model bytes/SHA above and assert that no `fp16`, `int8`, or `quant` model was added.

- [ ] **Step 2: Run RED**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_portable.PortableRuntimeArtifactTests -v
```

Expected: failure because the two archives are absent.

- [ ] **Step 3: Download and verify the exact upstream files**

Use a temporary directory and keep TLS verification enabled:

```powershell
$downloadRoot = Join-Path $env:TEMP ("lingshu-runtime-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $downloadRoot | Out-Null
$windowsArchive = Join-Path $downloadRoot "windows-x86_64-python.zip"
$macArchive = Join-Path $downloadRoot "macos-arm64-python.tar.gz"

curl.exe --fail --location --proto "=https" --tlsv1.2 --output $windowsArchive "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
if ($LASTEXITCODE -ne 0) { throw "Windows runtime download failed" }
curl.exe --fail --location --proto "=https" --tlsv1.2 --output $macArchive "https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-aarch64-apple-darwin-install_only_stripped.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "Apple Silicon runtime download failed" }

if ((Get-Item $windowsArchive).Length -ne 11133606) { throw "Windows size mismatch" }
if ((Get-FileHash -Algorithm SHA256 $windowsArchive).Hash.ToLowerInvariant() -ne "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3") { throw "Windows hash mismatch" }
if ((Get-Item $macArchive).Length -ne 24970238) { throw "Mac size mismatch" }
if ((Get-FileHash -Algorithm SHA256 $macArchive).Hash.ToLowerInvariant() -ne "8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6") { throw "Mac hash mismatch" }

Copy-Item $windowsArchive web_demo\runtimes\windows-x86_64-python.zip
Copy-Item $macArchive web_demo\runtimes\macos-arm64-python.tar.gz
```

- [ ] **Step 4: Freeze Git behavior and notices**

Add only these rules:

```gitattributes
web_demo/runtimes/windows-x86_64-python.zip binary -diff -merge
web_demo/runtimes/macos-arm64-python.tar.gz binary -diff -merge
web_demo/start-demo.bat text eol=crlf
web_demo/start-demo.sh text eol=lf
web_demo/start-demo.command text eol=lf
web_demo/tools/bootstrap_macos.sh text eol=lf
```

Ignore `web_demo/.runtime-cache/`. Document CPython 3.12.10/PSF and python-build-standalone 3.12.14/Astral provenance, the exact source URLs, hashes, and retained license files. Do not add the Intel archive.

- [ ] **Step 5: Run GREEN and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_portable.PortableRuntimeArtifactTests -v
git add .gitattributes .gitignore THIRD_PARTY_NOTICES.md tests/test_web_demo_portable.py web_demo/runtimes/windows-x86_64-python.zip web_demo/runtimes/macos-arm64-python.tar.gz
git commit -m "build(web): bundle judge Python runtimes"
```

### Task 3: Make Windows double-click use the bundled runtime

**Files:**
- Create: `web_demo/tools/bootstrap_windows.ps1`
- Modify: `web_demo/start-demo.bat`
- Modify: `tests/test_web_demo_launcher.py`
- Modify: `tests/test_web_demo_portable.py`

- [ ] **Step 1: Add Windows RED tests**

Guard native process tests with `@unittest.skipUnless(os.name == "nt", "requires Windows")`. Require:

- the BAT invokes the absolute repository PowerShell bootstrap and contains no `py`, `python`, `pip`, download, or fixed external dependency probe;
- the bootstrap pins the archive name, byte count, full SHA, and `python.exe` entrypoint;
- two real `start-demo.bat --check` runs succeed when `PATH` contains no Python; the second output contains `CACHE reused`;
- arguments containing spaces and Chinese text arrive unchanged;
- the child exit code becomes the BAT exit code.

Use this process shape:

```python
result = subprocess.run(
    ["cmd.exe", "/d", "/c", str(START_BAT), "--check"],
    cwd=unrelated_directory,
    env={**os.environ, "PATH": os.environ["SystemRoot"] + r"\System32"},
    text=True,
    capture_output=True,
    timeout=120,
)
self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
self.assertIn("RUNTIME bundled CPython 3.12.10 (Windows x86_64)", result.stdout)
```

- [ ] **Step 2: Run RED**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_portable tests.test_web_demo_launcher.WindowsLauncherTests -v
```

Expected: failure because the bundled bootstrap does not exist and BAT still probes installed Python.

- [ ] **Step 3: Implement one small PowerShell bootstrap**

Pin these values at the top; do not add a general manifest/parser layer:

```powershell
$ArchiveName = "windows-x86_64-python.zip"
$ExpectedBytes = 11133606
$ExpectedSha256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
$CacheName = "windows-x86_64-4acbed6dd1c7"
$Entrypoint = "python.exe"
```

The script must perform exactly this sequence:

1. Resolve `web_demo` from `$PSScriptRoot`; reject non-Windows-x86-64.
2. Verify archive existence, bytes, and streaming SHA-256 before extraction.
3. Reuse the cache only when `.complete-sha256` matches and absolute `python.exe -E -s -B -X utf8 -c` reports CPython 3.12 on x86-64.
4. If the fixed cache is invalid, require it to be a non-reparse direct child of `.runtime-cache`, rename it to a GUID-suffixed sibling, and remove only that renamed derived directory. Extract into a unique cache sibling, self-test it, write the marker, then atomically move it to the fixed cache path. If another launch won the move, verify and reuse the winner; remove only the current process's temporary directory.
5. Clear `PYTHONHOME`, `PYTHONPATH`, `PYTHONUSERBASE`, `VIRTUAL_ENV`, `CONDA_PREFIX`, `__PYVENV_LAUNCHER__`, and `PYTHON*` startup/debug variables inherited by the child.
6. Run the absolute bundled interpreter in the foreground with `-E -s -B -X utf8`, the absolute `serve_demo.py`, and the original arguments.

Print only stable runtime/cache/isolation lines before the server output. On failure, print one actionable `ERROR:` line, no PowerShell stack, and return nonzero.

Replace BAT contents with the thin wrapper:

```bat
@echo off
setlocal DisableDelayedExpansion
set "BOOTSTRAP=%~dp0tools\bootstrap_windows.ps1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%BOOTSTRAP%" %*
set "DEMO_EXIT=%ERRORLEVEL%"
if not "%DEMO_EXIT%"=="0" if "%~1"=="" pause
endlocal & exit /b %DEMO_EXIT%
```

- [ ] **Step 4: Run GREEN and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_portable tests.test_web_demo_launcher -v
cmd.exe /d /c web_demo\start-demo.bat --check
cmd.exe /d /c web_demo\start-demo.bat --check
git add web_demo/tools/bootstrap_windows.ps1 web_demo/start-demo.bat tests/test_web_demo_launcher.py tests/test_web_demo_portable.py
git commit -m "feat(web): launch with bundled Windows Python"
```

### Task 4: Add the Apple Silicon Finder launcher

**Files:**
- Create: `web_demo/tools/bootstrap_macos.sh`
- Create: `web_demo/start-demo.command`
- Modify: `web_demo/start-demo.sh`
- Modify: `tests/test_web_demo_launcher.py`
- Modify: `tests/test_web_demo_portable.py`

- [ ] **Step 1: Add macOS RED tests**

Static tests run everywhere and require LF endings, no `curl`, `pip`, `sudo`, `xattr`, backgrounding, or system-Python probe in the macOS bootstrap. Require tracked mode `100755` for `.command`, `.sh`, and `bootstrap_macos.sh`.

Native tests use `@unittest.skipUnless(sys.platform == "darwin", "requires macOS")` and require two `./start-demo.command --check` runs to succeed; the runtime line must say `macOS arm64` and the second run must say `CACHE reused`.

- [ ] **Step 2: Run RED**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_portable tests.test_web_demo_launcher.PosixLauncherTests -v
```

Expected on Windows: static failures and native tests skipped. Expected on Mac: static plus native failures.

- [ ] **Step 3: Implement the Apple Silicon bootstrap and wrappers**

Pin only these constants in `bootstrap_macos.sh`:

```sh
ARCHIVE_NAME='macos-arm64-python.tar.gz'
EXPECTED_BYTES='24970238'
EXPECTED_SHA256='8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6'
CACHE_NAME='macos-arm64-8b0f1fa71eab'
ENTRYPOINT='python/bin/python3'
```

Use absolute stock tools: `/usr/bin/uname`, `/usr/sbin/sysctl`, `/usr/bin/stat`, `/usr/bin/shasum`, `/usr/bin/tar`, and `/bin/mv`. Accept Darwin only when `hw.optional.arm64` is `1`, including a Rosetta-launched shell. Apply the same verify → cache self-test → unique temporary extraction → atomic move → reuse sequence as Windows, including the strict non-symlink direct-child rule before replacing an invalid cache. Clear Python, virtual-environment, and `DYLD_*` variables; execute the bundled interpreter in the foreground with `-E -s -B -X utf8`. If Gatekeeper blocks the interpreter, name the path and direct the user to System Settings → Privacy & Security → Open Anyway; do not bypass it.

Create the Finder wrapper:

```sh
#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd) || exit 1
"$SCRIPT_DIR/tools/bootstrap_macos.sh" "$@"
status=$?
if [ "$status" -ne 0 ] && [ "$#" -eq 0 ]; then
  printf '%s' 'Press Return to close this window...'
  IFS= read -r _
fi
exit "$status"
```

At the top of existing `start-demo.sh`, add only this Darwin delegation; leave the current non-Darwin Python logic byte-for-byte unchanged below it:

```sh
if [ "$(/usr/bin/uname -s 2>/dev/null)" = "Darwin" ]; then
  SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd) || exit 1
  exec "$SCRIPT_DIR/tools/bootstrap_macos.sh" "$@"
fi
```

Set modes explicitly:

```powershell
git add --chmod=+x web_demo/start-demo.sh web_demo/start-demo.command web_demo/tools/bootstrap_macos.sh
```

- [ ] **Step 4: Run available GREEN checks and commit**

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_web_demo_portable tests.test_web_demo_launcher -v
git add web_demo/start-demo.sh web_demo/start-demo.command web_demo/tools/bootstrap_macos.sh tests/test_web_demo_launcher.py tests/test_web_demo_portable.py
git commit -m "feat(web): add Apple Silicon one-click launcher"
```

Native macOS execution is completed in Task 6, not inferred from Windows shell tests.

### Task 5: Document, run CI smoke, and freeze the implementation

**Files:**
- Create: `.github/workflows/web-demo-portable.yml`
- Modify: `README.md`
- Modify: `web_demo/README.md`
- Modify: `tests/test_web_demo_portable.py`

- [ ] **Step 1: Add documentation/package RED assertions**

Require both quick-start filenames, bundled/offline wording, Windows x86-64 and Apple Silicon support boundaries, exact FP32 model/threshold `0.55657113`, first-run cache/reuse, automatic port fallback, loopback privacy, Gatekeeper truth, and an explicit statement that Intel macOS is not shipped in this slice.

- [ ] **Step 2: Update only the two judge-facing READMEs**

Place Windows and macOS instructions side by side. Explain that judges need only clone, double-click, wait for `READY`, and select an image. Document `--check`, `--no-browser`, cache location, Ctrl+C/window shutdown, port fallback, and Gatekeeper Open Anyway. Do not mention system-Python mode, online hosting, or compressed models.

- [ ] **Step 3: Add two small CI jobs**

```yaml
name: WebDemo portable launchers

on:
  push:
    paths:
      - "web_demo/**"
      - "tests/test_web_demo_*.py"
      - ".github/workflows/web-demo-portable.yml"
  pull_request:
    paths:
      - "web_demo/**"
      - "tests/test_web_demo_*.py"
      - ".github/workflows/web-demo-portable.yml"

jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -B -m unittest tests.test_web_demo_server tests.test_web_demo_launcher tests.test_web_demo_portable -v
      - run: cmd.exe /d /c web_demo\start-demo.bat --check

  apple-silicon:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -B -m unittest tests.test_web_demo_server tests.test_web_demo_launcher tests.test_web_demo_portable -v
      - run: /bin/sh web_demo/start-demo.command --check
```

CI is smoke coverage, not a substitute for Finder and real browser inference.

- [ ] **Step 4: Run the complete local gate**

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
npm.cmd --prefix web_demo test
npm.cmd --prefix web_demo run typecheck
npm.cmd --prefix web_demo run build
npm.cmd --prefix web_demo run verify:dist
cmd.exe /d /c web_demo\start-demo.bat --check
git diff --check
git status --short
```

Expected: every command exits zero, `verify:dist` reports no drift, and only Task 5 files are changed.

- [ ] **Step 5: Measure and commit**

Measure the committed Task 4 tree, then record its total plus the exact 36,103,844 runtime bytes in `web_demo/README.md`; label it Git blob size, not checkout/history size:

```powershell
$measuredCommit = git rev-parse HEAD
$sizes = git ls-tree -r --format="%(objectsize)" $measuredCommit
if ($LASTEXITCODE -ne 0) { throw "git ls-tree failed" }
$trackedBytes = [int64](($sizes | ForEach-Object { [int64]$_ } | Measure-Object -Sum).Sum)
$trackedMiB = [Math]::Round($trackedBytes / 1MB, 2)
Write-Host "Measured commit: $measuredCommit"
Write-Host "Tracked Git blob bytes: $trackedBytes"
Write-Host "Tracked Git blob MiB: $trackedMiB"
Write-Host "Bundled runtime bytes: 36103844"
Write-Host "Bundled runtime MiB: $([Math]::Round(36103844 / 1MB, 2))"
```

```powershell
git add .github/workflows/web-demo-portable.yml README.md web_demo/README.md tests/test_web_demo_portable.py
git commit -m "docs(web): document portable local launch"
git status --short --branch
```

Record the resulting clean commit as the implementation commit used in Task 6.

### Task 6: Run one concise physical acceptance pass

**Files:**
- Create: `results/web_demo_acceptance/portable-launchers.md`

- [ ] **Step 1: Test a fresh Windows checkout**

On Windows, use a fresh clone or tracked-file copy at the Task 5 commit. With Python removed from `PATH`, double-click `start-demo.bat`, verify first cache creation, upload one known real image and one known AI image, record both results, close the window, and confirm the URL is unreachable. Start a harmless holder on 8765 and repeat; confirm the holder survives and the demo prints another port.

- [ ] **Step 2: Transfer the exact implementation commit to the Mac**

From the clean Windows repository:

```powershell
git bundle create ..\lingshu-portable.bundle feat/web-demo
git bundle verify ..\lingshu-portable.bundle
```

After transferring it to `~/Downloads/lingshu-portable.bundle`, run on the Apple Silicon Mac:

```sh
set -eu
bundle="$HOME/Downloads/lingshu-portable.bundle"
checkout="$HOME/Desktop/LingShu 评测"
expected="$(git bundle list-heads "$bundle" | /usr/bin/awk '$2 == "refs/heads/feat/web-demo" { print $1 }')"
git clone --branch feat/web-demo "$bundle" "$checkout"
cd "$checkout"
test "$(git rev-parse HEAD)" = "$expected"
/bin/sh web_demo/start-demo.command --check
```

- [ ] **Step 3: Test the actual Finder path**

In Finder, double-click `web_demo/start-demo.command`. If Gatekeeper requires approval, use Open Anyway once and record that fact. Verify `CACHE created` on the fresh clone, complete the same two real browser inferences, stop the server, verify the URL is unreachable, then double-click again and verify `CACHE reused`. Do not infer Intel support from Rosetta.

- [ ] **Step 4: Record only observed facts and commit**

Create `portable-launchers.md` containing:

- implementation commit SHA;
- Windows version/architecture/browser and pass/fail for bundled launch, cache create/reuse, port fallback, inference, and shutdown;
- macOS version, Apple Silicon hardware, browser, checkout transport, Gatekeeper observation, and the same pass/fail items;
- measured first/reused launch times, clearly labeled as observations on those machines;
- limitations: Intel unshipped/unverified, no Developer ID, online demo deferred.

Do not invent missing results. If a mandatory item fails, fix only that failure with one focused regression test and rerun Task 5 before recording a pass.

```powershell
git add results/web_demo_acceptance/portable-launchers.md
git commit -m "test(web): record portable launcher acceptance"
git status --short --branch
```

## Final boundary

After Task 6, stop launcher work and return to WebDemo visual/content optimization. Do not add runtime abstraction layers, more platforms, installers, automatic evidence systems, or online deployment unless a demonstrated need appears or the user explicitly starts that next slice.
