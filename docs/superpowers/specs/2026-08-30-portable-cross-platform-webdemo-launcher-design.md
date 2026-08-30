# Portable Cross-Platform WebDemo Launcher Design

## Status

> [!IMPORTANT]
> **Historical design — superseded.** The deadline implementation is defined by
> the [implementation plan](../plans/2026-08-30-portable-cross-platform-webdemo-launcher.md)
> and the current judge-facing [repository README](../../../README.md) and
> [WebDemo README](../../../web_demo/README.md). The delivered portable slice has
> only two bundled runtimes: Windows x86-64 and Apple Silicon macOS. It has no
> Intel macOS archive, adds no new `--system-python` option, and the two runtime
> archives total exactly 36,103,844 bytes. The three-runtime design below is
> retained as historical design context, not as a delivery commitment.

This document originally superseded only the launcher and host-runtime portions of
`2026-08-30-offline-fp32-webdemo-design.md`. The frozen FP32 ONNX model, browser
inference contract, local-only HTTP server, integrity checks, and privacy boundary
remain unchanged. Existing Windows acceptance files remain valid historical
evidence for their recorded commit only. Launcher or server changes require new
Windows evidence against the final implementation commit.

## Objective

Make the committed WebDemo reproducible on a judge's Windows x86-64 or Apple
Silicon macOS computer without requiring Python, Node.js, npm, pip, administrator
access, an API key, an inference server, or an Internet connection after the
repository has been obtained. An Intel macOS runtime is shipped as a best-effort
compatibility artifact until it receives architecture-specific acceptance.

The intended judge experience is:

1. Clone the submitted Git revision.
2. Double-click `web_demo/start-demo.bat` on Windows or
   `web_demo/start-demo.command` on macOS.
3. Wait while the launcher verifies and, on first use, extracts its own Python
   runtime.
4. Use the automatically opened loopback WebDemo.
5. Press `Ctrl+C` or close the launcher window to stop the server.

The default path must be deterministic even if another team's demo has left an
occupied port, a broken virtual environment, a polluted `PATH`, or persistent
Python-related environment variables.

## First-principles constraints

- The 88,123,029-byte FP32 ONNX model remains unchanged. This work does not add
  FP16, INT8, remote inference, or a mock fallback.
- Python is only the bootstrap and local static-server runtime. Model inference
  remains entirely inside the judge's browser through ONNX Runtime Web.
- Normal launch performs no download, installation, package resolution, or
  privilege escalation.
- The launcher binds only to `127.0.0.1`. It never exposes the demo to the LAN.
- The normal judge path uses a repository-supplied runtime. It does not inspect
  or execute a system Python first.
- A system Python 3.11 or newer remains available only through the explicit
  developer option `--system-python`.
- Windows x86-64, macOS Apple Silicon, and macOS Intel receive bundled-runtime
  artifacts. Windows x86-64 and Apple Silicon are the formal acceptance targets;
  Intel macOS remains explicitly unverified until a native Intel-hardware run is
  recorded. A Rosetta smoke test does not remove that label. Windows ARM64,
  Windows x86, and Linux do not receive bundled runtimes in this slice.
- Linux may continue through `start-demo.sh --system-python`; a default Linux
  launch fails with a clear unsupported-platform error instead of downloading or
  guessing a runtime.
- The team has no Apple Developer ID. The design cannot promise that Gatekeeper
  will never ask the user to approve an unnotarized launcher or runtime.
- Git clone is the primary macOS handoff path because Git preserves executable
  bits. GitHub Download ZIP is an experimental diagnostic path only: `chmod`
  can restore executable bits but cannot repair quarantine or provenance trust.
- No macOS compatibility claim becomes formal until evidence is captured on the
  available physical Apple Silicon Mac.

## Scope boundary

### Included

- Finder-double-click macOS entry point.
- Bundled, compressed CPython runtimes for the three supported platform/CPU
  combinations.
- Runtime manifest, byte-size and SHA-256 verification, safe first-run extraction,
  cache reuse, and cache repair.
- Windows and macOS environment isolation.
- Explicit system-Python developer mode.
- Occupied-port recovery, deterministic browser opening, readable error codes,
  and foreground process cleanup.
- Launcher tests, documentation, third-party notices, and separate macOS
  acceptance evidence.

### Deferred or excluded

- Online hosting and Cloudflare deployment.
- Linux bundled runtimes.
- Windows ARM64 or 32-bit Windows.
- A signed/notarized `.app`, Apple Developer ID purchase, or automatic Gatekeeper
  bypass.
- PyInstaller, Electron, Tauri, Docker, Homebrew, Conda, and repository-local pip
  installation.
- Any redesign of the WebDemo page itself. Impeccable-driven visual and motion
  work remains a later UI phase.

## Considered approaches

### A. System Python first, bundled fallback — rejected for the judge default

This saves first-run extraction when a healthy interpreter is already installed,
but it reintroduces the exact uncertainty the portable path is meant to remove:
stale virtual environments, shell aliases, Microsoft Store shims, broken DLLs,
user-site packages, `PYTHONHOME`, `PYTHONPATH`, and another demo's modified
`PATH`.

It remains available as explicit `--system-python` developer mode.

### B. Bundled compressed CPython by default — selected

The repository contains one compressed runtime per supported platform and
architecture. The launcher selects only the matching archive, verifies it, and
extracts it into a repository-local ignored cache. The first launch pays the
extraction cost; later launches reuse the validated cache and do not probe system
Python.

This adds about 57.97 MiB of tracked data but gives the strongest offline and
cross-machine consistency without introducing a compiled application wrapper.

### C. Native executable or signed macOS app — rejected for this slice

A PyInstaller-style executable or `.app` would still require one build per
platform and architecture, would enlarge the binary surface, and would not solve
macOS trust prompts without signing and notarization. It also makes the local
server harder for judges to audit than the current short Python implementation.

### D. Download the runtime on first launch — rejected for the judge path

This reduces the Git checkout size but makes first launch depend on Internet
access, GitHub availability, proxy settings, and download integrity. The approved
goal is a clone-complete offline package.

## Repository layout

The implementation adds the following paths while preserving the existing
browser build, model, and server:

```text
web_demo/
├── start-demo.bat
├── start-demo.command
├── start-demo.sh
├── tools/
│   ├── bootstrap_windows.ps1
│   ├── bootstrap_macos.sh
│   ├── serve_demo.py
│   └── verify_distribution.py
└── runtimes/
    ├── runtime-manifest.tsv
    ├── macos-arm64-python.tar.gz
    ├── macos-x86_64-python.tar.gz
    └── windows-x86_64-python.zip
```

The extracted cache lives at:

```text
web_demo/.runtime-cache/<runtime-id>-<first-12-sha256-characters>/
```

`web_demo/.runtime-cache/` is ignored by Git. Keeping it inside the checkout
prevents collisions with other projects and makes the runtime source obvious.
Launchers must resolve this path from their own absolute location, never from the
caller's current working directory.

The repository root `README.md`, `web_demo/README.md`, `.gitattributes`,
`.gitignore`, and `THIRD_PARTY_NOTICES.md` are updated as part of implementation.

## Frozen runtime artifacts

`runtime-manifest.tsv` is the only machine-readable runtime registry. TSV is
selected because POSIX shell and Windows PowerShell can parse it before Python is
available, without `jq`, Node.js, or another dependency.

The header is:

```text
runtime_id	os	arch	target_triple	runtime_min_os	python_version	archive	archive_format	bytes	sha256	entrypoint	source_url
```

Every data row must have exactly twelve non-empty fields. Identifiers and relative
paths may contain neither tabs nor newlines. Duplicate `(os, arch)` records,
unknown archive formats, non-decimal byte counts, non-lowercase 64-character
SHA-256 values, malformed target triples or minimum versions, absolute paths, or
paths containing `..` are fatal manifest errors.

The selected artifacts are frozen as follows:

| Runtime ID | Target triple | Runtime minimum OS | Repository archive | Exact bytes | SHA-256 | Entrypoint |
| --- | --- | --- | --- | ---: | --- | --- |
| `windows-x86_64` | `x86_64-pc-windows-msvc` | Windows 8.1 | `windows-x86_64-python.zip` | 11,133,606 | `4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3` | `python.exe` |
| `macos-arm64` | `aarch64-apple-darwin` | macOS 11.0 | `macos-arm64-python.tar.gz` | 24,970,238 | `8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6` | `python/bin/python3` |
| `macos-x86_64` | `x86_64-apple-darwin` | macOS 10.15 | `macos-x86_64-python.tar.gz` | 24,683,783 | `bd486eadd20259ad1fece28c800205baac0113c3b9cc663ddae495c19ba9db38` | `python/bin/python3` |

The minimum values above describe the Python runtime binaries, not an unlimited
promise for the full WebDemo. The project's formal host matrix additionally
requires a browser version that its vendor still supports on that operating
system. Windows acceptance targets Windows 10 x86-64 or newer. Apple Silicon and
Intel documentation names only exact macOS/browser combinations for which the
team has recorded evidence; the runtime deployment target alone is not presented
as full-project validation.

The Windows archive is the official CPython 3.12.10 embeddable x86-64 package:

```text
https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip
```

The two macOS archives are CPython 3.12.14 `install_only_stripped` artifacts from
the immutable `python-build-standalone` release `20260825`:

```text
https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-aarch64-apple-darwin-install_only_stripped.tar.gz
https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-x86_64-apple-darwin-install_only_stripped.tar.gz
```

The three archives total 60,787,627 bytes, or 57.97 MiB. At the current branch's
124.64 MiB tracked working-tree size, they bring the approximate tracked working
tree to 182.61 MiB before small scripts and documentation. Git history and clone
transfer size are separate and may be larger.

No new runtime archive exceeds GitHub's 50 MiB warning threshold. The already
committed 84.04 MiB model remains below GitHub's 100 MiB hard block. Checksums,
upstream URLs, versions, licenses, and retained archive notices must be recorded
in `THIRD_PARTY_NOTICES.md` before the runtime commit is accepted.

`.gitattributes` marks the ZIP and TAR.GZ runtime paths as binary with diff and
merge disabled. Exact archive bytes must never pass through text, EOL, or checkout
filters because launch-time integrity depends on their SHA-256 values.

## Entry-point architecture

### Windows

`start-demo.bat` remains the double-click entry point. It performs only the tasks
that are safer in batch: resolve its directory, set UTF-8 console behavior,
invoke `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` and the
repository's absolute `bootstrap_windows.ps1` with `-NoProfile` and a
process-scoped execution-policy bypass, forward all arguments without delayed
expansion, preserve the exit code, and pause on a double-click startup failure so
the error remains readable.

It must not probe `.venv`, `py`, or `python` in default mode. It must not use
`Start-Process` or detach the server.

### macOS

`start-demo.command` is a minimal Finder-facing wrapper with LF endings and Git
mode `100755`. Through `/bin/sh`, it resolves its own directory, invokes the
absolute `bootstrap_macos.sh`, forwards all arguments exactly, and keeps a
failure message visible when Finder launched the terminal window.

`bootstrap_macos.sh` contains the actual selection, verification, cache, and
launch logic. It also has LF endings and mode `100755`. The wrapper must not use
AppleScript, Homebrew, `sudo`, or `xattr`.

### Shared shell entry

`start-demo.sh` remains the documented terminal entry point. On macOS it delegates
to `bootstrap_macos.sh`. On Linux it accepts only explicit `--system-python` in
this slice. Its established path resolution, argument forwarding, foreground
execution, and exit-code behavior remain regression-tested.

## Platform and architecture selection

The host is selected before any runtime executable is launched. Default bundled
mode uses shell builtins, .NET APIs, or absolute operating-system tool paths; it
does not resolve bootstrap tools through the caller's `PATH`.

- Windows supports only a 64-bit operating system with x86-64 execution. The
  PowerShell bootstrap uses .NET runtime architecture information with
  `PROCESSOR_ARCHITEW6432` as a compatibility fallback. ARM64 and 32-bit results
  produce `E101`.
- macOS requires `/usr/bin/uname -s` to report `Darwin`.
- On macOS, `/usr/sbin/sysctl -n hw.optional.arm64` reporting `1` selects the
  Apple Silicon archive even if the calling terminal itself is running under
  Rosetta. Otherwise `/usr/bin/uname -m` must report `x86_64` for the Intel
  archive.
- Ambiguous, empty, or unsupported results produce `E101`; the launcher never
  chooses a best guess.

Only the selected archive is extracted or executed. CI separately verifies every
manifest record and all three committed archives.

## Runtime selection policy

### Default bundled mode

The launcher does not call `python`, `python3`, `py`, Conda, or a repository
virtual environment. A fake or broken Python earlier on `PATH` therefore cannot
affect normal judge launch.

The selected bundled runtime must report the exact manifest Python version and
expected machine architecture, and must import every standard-library module
needed by `serve_demo.py` and `verify_distribution.py` before it is trusted.

### Explicit system mode

`--system-python` is consumed by the bootstrap layer and is not forwarded to
`serve_demo.py`. In this mode only, the launcher resolves conventional system
commands, converts the winner to an absolute executable path, and accepts it only
after a real isolated probe confirms CPython 3.11 or newer and the required
standard-library imports.

Windows probes `py -3`, `python`, then `python3`. macOS and Linux probe `python3`,
then `python`. Failed probes are skipped. If none is healthy, launch stops with
`E106`; it never silently falls back to the bundled runtime because the caller
explicitly requested system mode.

The established server flags keep their meaning in both modes:

- `--check` verifies the selected runtime and committed distribution, opens no
  browser, and binds no port.
- `--no-browser` starts the server and prints the URL without opening a tab.
- `--port N` accepts only `1` through `65535`, requires exactly
  `127.0.0.1:N`, and fails clearly if it is unavailable. User-supplied
  `--port 0` is rejected; port zero is reserved for the server's internal
  automatic ephemeral fallback.
- All other arguments are forwarded unchanged for `serve_demo.py` to validate.

## Environment isolation

Both bootstraps create a child environment instead of mutating the user's global
configuration.

Before Python starts, they remove Python, virtual-environment, shell-hook, and
dynamic-loader variables that can redirect imports or native libraries, including
`PYTHONHOME`, `PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONUSERBASE`, `VIRTUAL_ENV`,
`CONDA_PREFIX`, `PIP_CONFIG_FILE`, `BASH_ENV`, `ENV`, `CDPATH`, `DYLD_LIBRARY_PATH`,
`DYLD_FRAMEWORK_PATH`, `DYLD_INSERT_LIBRARIES`, and `LD_LIBRARY_PATH` where the
host exposes them.

The selected interpreter is invoked by absolute path with:

```text
-E -s -B -X utf8
```

These flags ignore Python environment configuration, disable the user site,
avoid bytecode writes, and force UTF-8 mode. The child `PATH` is reduced to the
absolute runtime directory and operating-system directories required for normal
process operation. Browser commands and repository files are also addressed by
absolute path.

Before that reduction, bootstrap operations themselves also avoid hostile
`PATH` resolution. Windows uses the absolute system PowerShell executable and
PowerShell/.NET hashing, file, process, and ZIP APIs. macOS invokes fixed system
paths such as `/usr/bin/uname`, `/usr/sbin/sysctl`, `/usr/bin/shasum`, and
`/usr/bin/tar`, using `/bin` tools or POSIX shell builtins for directory, lock,
move, wait, and process-liveness operations. If a required fixed system tool is
missing or unhealthy, launch fails explicitly rather than using a same-named
program elsewhere on `PATH`.

The official Windows embeddable distribution constrains `sys.path` through its
`python312._pth` file, so the server must not assume that Python prepends the
script directory. In direct-script mode, `serve_demo.py` resolves the sibling
`verify_distribution.py` from `Path(__file__)` and loads that exact file through
an explicit path-anchored import. No pip package, global site package, `.pth`
modification, or current-working-directory import is required.

## Archive verification and cache lifecycle

The project does not treat a valid outer-file hash as a generic license to unpack
an arbitrary archive. Before any runtime archive is committed, a release-gate
test audits every member of those exact frozen bytes. Member names must be
relative, normalized, NUL-free, collision-free under the target filesystem's
case rules, and contained beneath the expected archive root. Allowed types are
directories, regular files, and only those relative symbolic or hard links whose
fully resolved targets remain inside that root. Absolute paths, drive-qualified
paths, `..` escapes, alternate data streams, device names, device nodes, FIFOs,
sockets, escaping links, and ambiguous duplicate members are rejected.

The byte-size and SHA-256 in the manifest bind launch-time extraction to the
already audited member set. A new or changed digest cannot pass CI or release
review without a new member audit. This is pinned-artifact extraction, not an
untrusted general-purpose archive installer.

Every bundled launch follows this order:

1. Parse and validate the manifest.
2. Select exactly one host record.
3. Resolve the archive beneath `web_demo/runtimes/` and reject containment
   escapes.
4. Compare the exact byte count.
5. Compute and compare SHA-256 before executing or extracting anything from the
   archive; only the release-audited digest is eligible for extraction.
6. Acquire an atomic, runtime-specific lock beneath
   `web_demo/.runtime-cache/.locks/`.
7. Reuse an existing cache only if its completion marker matches the full archive
   SHA-256 and its Python self-test succeeds.
8. Otherwise extract into a unique temporary directory with the same parent as
   the final cache, validate the expected entrypoint and all resolved links,
   self-test it, write the completion marker, and rename the directory atomically
   into its final cache name.
9. Release the lock and execute the server in the foreground.

Two simultaneous double-clicks must not corrupt the cache. A second launcher
waits for the first for at most 90 seconds, then rechecks the finished cache. A
lock older than ten minutes may be removed only when its recorded process is no
longer alive. All deletion or replacement is restricted to a resolved descendant
of `web_demo/.runtime-cache/`; repository archives, models, and source files are
never repaired or deleted automatically.

An invalid cache is treated as disposable derived state and rebuilt from the
already verified archive. A missing, truncated, or hash-mismatched archive is not
recoverable at launch: the launcher reports the error and instructs the user to
obtain a clean submitted revision. It never downloads a substitute.

## Local server, ports, and process lifecycle

The existing `serve_demo.py` behavior remains authoritative:

- Verify the FP32 model, model manifest, built site, ONNX Runtime Web files, and
  distribution integrity before binding a port.
- Bind exclusively to `127.0.0.1`.
- Without `--port`, try ports 8765 through 8784 in order, then request an
  operating-system-assigned ephemeral loopback port.
- With `--port`, try only the requested port.
- Print the actual bound URL.
- Run in the launcher terminal's foreground until `Ctrl+C` or window closure.

The bootstraps do not kill an existing process merely because it owns a preferred
port. They do not use a fixed PID file shared across checkouts. They do not leave
background helpers or orphaned servers after a normal shutdown.

## Browser-opening policy

`--no-browser` suppresses all automatic opening.

On macOS, the server uses `/usr/bin/open` by absolute path and attempts, in order:

1. Google Chrome, for the preferred WebGPU experience.
2. Microsoft Edge.
3. The user's default browser.

Safari is a best-effort WASM browser target, not the formal WebGPU target. On
Windows the existing default-browser behavior remains, while the documentation
continues to recommend current Microsoft Edge for the recorded acceptance path.

Failure to open a tab is nonfatal. The server stays alive, prints `E401` as a
warning, and leaves the `READY` URL visible for manual copy. It never treats a
browser-opening failure as an inference-server failure.

## User-visible output contract

A successful normal launch prints stable, greppable prefixes before the server
waits:

```text
RUNTIME bundled CPython 3.12.14 (macOS arm64)
CACHE created|reused <absolute cache path>
ISOLATION sanitized environment; user site disabled; offline bootstrap
VERIFIED FP32 model and WebDemo distribution
READY http://127.0.0.1:<actual-port>/
STOP Press Ctrl+C in this window to stop the local server.
```

Windows prints CPython 3.12.10 and `Windows x86_64`. Explicit system mode prints
`RUNTIME system CPython <detected-version> (explicit opt-in)` and omits the cache
line.

Expected failures use one stable code and one actionable explanation:

| Code | Meaning |
| --- | --- |
| `E101` | Unsupported or ambiguous operating system/architecture |
| `E102` | Selected repository runtime archive is missing |
| `E103` | Manifest, byte-size, or SHA-256 integrity failure |
| `E104` | Cache path, extraction, lock, permission, or atomic-move failure |
| `E105` | Bundled Python entrypoint or self-test failure |
| `E106` | No healthy CPython 3.11+ in explicit system mode |
| `E201` | Existing model or WebDemo distribution verification failure |
| `E301` | Explicit or automatic loopback binding exhausted |
| `E401` | Browser did not auto-open; nonfatal because the `READY` URL remains |

Expected errors do not show a raw stack trace. They identify the exact affected
path when safe and state that no online repair was attempted. Fatal codes preserve
a nonzero process exit code. `E401` is the sole nonfatal code: it leaves the
server running and does not change a successful process status.

## macOS Gatekeeper and handoff truth

Because the team has no Developer ID, neither the `.command` entry point nor the
third-party macOS runtime can be represented as a team-signed and notarized app.
The launcher must not conceal this limitation.

The primary instructions use `git clone`, which preserves executable bits and
normally avoids the browser-download workflow. If macOS blocks the first launch,
the documentation directs the judge to use Finder's **Open** action or System
Settings > Privacy & Security > **Open Anyway**, inspect the repository source,
and retry. The project never runs `xattr -d`, weakens system-wide Gatekeeper, or
asks for `sudo`.

Approval of the `.command` script does not guarantee that Gatekeeper will also
allow the subsequently extracted third-party Mach-O Python binary. If that binary
is blocked, the launcher reports `E105` and the exact path, but the team cannot
promise a frictionless recovery without signing and notarization. A managed Mac
may also remove the user's **Open Anyway** choice.

For GitHub Download ZIP, documentation explains that `chmod +x` can restore the
three shell executable bits but cannot remove quarantine or provenance metadata.
The ZIP path remains experimental and unsupported until a physical Mac run proves
both the wrapper and extracted runtime behavior. It is not advertised as equal to
git clone, and the project does not automatically clear quarantine.

## Test-driven implementation contract

Implementation follows red-green-refactor. Each production behavior begins with
a test that is observed failing for the intended reason.

### Manifest and runtime tests

- Parse all three exact records and reject malformed columns, duplicates,
  target triples, minimum OS values, absolute paths, traversal, invalid sizes,
  and invalid hashes.
- Verify the exact byte size and SHA-256 of every committed runtime archive.
- Audit every frozen archive member and link under the containment and file-type
  rules in this design before any extraction test runs.
- Select Windows x86-64, Apple Silicon, and Intel macOS correctly.
- Prefer Apple Silicon hardware detection when a Rosetta shell reports x86-64.
- Reject unsupported Windows and Linux default combinations with `E101`.
- Detect missing, truncated, and one-byte-corrupted archives as `E102` or `E103`.

### Bootstrap and isolation tests

- Default launch ignores fake `python`, `python3`, `py`, `.venv`, and hostile
  Python environment variables.
- Default launch also ignores fake `powershell`, `uname`, `sysctl`, `shasum`,
  `tar`, `stat`, `mkdir`, `mv`, `sleep`, and `kill` commands placed earlier on
  `PATH`; fixture sentinels prove that none is executed.
- Explicit `--system-python` performs a real version/import probe and does not
  silently switch modes.
- Python starts with the required isolation flags and a sanitized child
  environment.
- Direct-script startup succeeds under a fixture that reproduces the Windows
  embeddable distribution's restricted `._pth` import behavior; the sibling
  verifier is loaded only from the repository's absolute `tools/` path.
- Paths containing spaces, Chinese characters, parentheses, ampersands, percent
  signs, exclamation marks, dollar signs, and square brackets retain exact
  argument boundaries on their applicable platform.
- First launch extracts and marks a synthetic fixture runtime; second launch
  reuses it.
- A corrupt marker, missing entrypoint, or failed self-test rebuilds only the
  derived cache.
- Concurrent launch waits for the same runtime lock and converges on one healthy
  cache.
- A live lock times out without deletion; an old lock with a dead owner is
  recovered.
- `--check`, `--no-browser`, `--port`, unknown arguments, exit codes, and
  foreground interrupt behavior are preserved.

The bootstrap behavior tests use small synthetic fixture archives in temporary
repository-shaped directories. They do not repeatedly unpack the 58 MiB
production set. A separate integrity test hashes the real committed archives.

### Launcher regression tests

- `start-demo.command`, `start-demo.sh`, and `bootstrap_macos.sh` use LF endings
  and Git mode `100755`.
- Batch files retain Windows-compatible line endings and safe quoting with
  delayed expansion disabled.
- `.gitattributes` freezes all three runtime archives as binary with diff and
  merge disabled.
- The Windows BAT remains double-click readable on expected failure.
- No launcher contains `curl`, `wget`, `pip`, `npm`, `sudo`, `xattr`,
  `Start-Process`, or another download/detach path.
- Existing server security, distribution, parity, WebDemo unit, and Windows
  browser-acceptance tests remain green.

### Port and lifecycle tests

- A foreign process on port 8765 remains untouched and launch advances to 8766.
- When all ports 8765 through 8784 are occupied, automatic mode obtains an
  ephemeral loopback port.
- An occupied explicit `--port` fails with `E301` and does not kill the owner.
- User-supplied `--port 0` is rejected before binding; only automatic mode may
  request an ephemeral port from the operating system.
- `--check` opens neither socket nor browser.
- `Ctrl+C` terminates the foreground server, releases the port, and leaves no
  launcher-owned child process.

## Physical Apple Silicon acceptance

Automated tests on Windows do not establish macOS compatibility. Before the
README calls Apple Silicon macOS formally supported, the team runs and records
this matrix on the available Apple Silicon Mac against an exact commit:

1. Fresh `git clone` into a path containing spaces and Chinese characters.
2. Finder double-click of `start-demo.command` with ordinary system `PATH`
   pollution present, confirming bundled mode is still selected.
3. First launch extraction, exact runtime/version output, distribution
   verification, browser opening, model load, and one real image inference.
4. Second launch cache reuse.
5. Ports 8765 through 8784 occupied by unrelated test processes, followed by a
   successful ephemeral-port launch without terminating them.
6. `--check`, `--no-browser`, and explicit occupied `--port` behavior.
7. Google Chrome WebGPU and forced WASM runs with the same FP32 model.
8. Microsoft Edge WebGPU and WASM when Edge is available.
9. Safari WASM best-effort run, reported honestly if it fails.
10. `Ctrl+C` shutdown and confirmation that the URL and port are no longer live.
11. Gatekeeper behavior for git clone, plus a separately documented Download ZIP
    trial if time permits.

If Rosetta is already available, a separate smoke test may force selection and
self-test of the Intel archive. That result proves x86-64 execution under Rosetta
on the recorded Apple Silicon/macOS pair, not native Intel-Mac compatibility. If
no Intel-hardware evidence exists, judge-facing documentation labels Intel macOS
as bundled but unverified and makes no minimum-version promise beyond the exact
machines recorded by evidence.

Mac evidence is written beneath a new platform-specific directory such as:

```text
results/web_demo_acceptance/macos-apple-silicon/
```

It must not overwrite or relabel the existing Windows Edge evidence. Evidence
records include commit SHA, macOS version, hardware architecture, browser and
version, execution provider, runtime source, cache state, timings, result, and
failure diagnostics. Timings describe that machine only and are not promises.

## Windows re-acceptance

The current Windows evidence predates the bundled-runtime launchers. After the
implementation commit is frozen, the team reruns the existing fresh-copy Windows
x86-64 Edge acceptance against that exact commit, using default bundled mode with
system Python made unavailable to the launcher. The run covers archive/cache
bootstrap, BAT double-click-equivalent launch, `--check`, occupied-port fallback,
WebGPU, WASM, real inference, and foreground shutdown.

The refreshed Windows evidence keeps the existing evidence schema and records
the tested implementation commit. If the project's evidence convention uses a
separate evidence-only commit, its parent is the recorded tested commit. Prior
evidence remains available in Git history and must not be presented as proof of
the new launcher.

## Documentation changes

The implementation updates judge-facing documentation to:

- Put Windows BAT and macOS COMMAND quick starts side by side.
- State that the default runtime is bundled and offline.
- Explain the one-time extraction and later cache reuse.
- Show explicit `--system-python` only under developer/manual options.
- Explain loopback port selection and coexistence with other demos.
- Give exact recovery guidance for `E101` through `E401`.
- Explain Gatekeeper and executable-bit limitations without claiming a bypass.
- Describe Git clone as the primary macOS path and Download ZIP as experimental;
  explain that script approval does not necessarily approve the extracted
  runtime binary.
- Distinguish formally recorded Windows evidence from pending or completed Mac
  evidence.
- Label Intel macOS as bundled but unverified until architecture-specific
  evidence exists, including the exact tested macOS version rather than an
  inferred minimum.
- Preserve the FP32 model provenance, threshold, privacy, and browser fallback
  language.

## Acceptance criteria

This slice is complete only when all of the following are true:

- The three exact runtime archives and valid TSV manifest are committed with
  provenance and license notices.
- Fresh Windows x86-64 and Apple Silicon macOS checkouts launch offline without
  installed Python, Node.js, package installation, administrator access, or
  fixed-port assumptions.
- Normal launch cannot be redirected by system Python, virtual-environment, user
  site, or dynamic-loader environment configuration covered by this design.
- First extraction is integrity-checked and atomic; subsequent launch reuses a
  self-tested cache.
- Windows BAT and macOS Finder paths remain foreground, readable, and cleanly
  stoppable.
- All new TDD tests and the existing project test suite pass.
- Fresh Windows evidence is recorded against the final implementation commit;
  older evidence remains historical only.
- The runtime size increase is measured from committed files and documented.
- Physical Apple Silicon acceptance evidence is recorded separately before a
  formal Apple Silicon support claim is published. Intel macOS remains visibly
  unverified until its own evidence exists.
- No online deployment or UI redesign is mixed into the launcher commits.

## Primary references

- Python 3.12.10 release and official Windows embeddable package:
  <https://www.python.org/downloads/release/python-31210/>
- Python 3.12.10 embeddable package SBOM and SHA-256:
  <https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip.spdx.json>
- CPython 3.12 `sys.path` and `._pth` initialization behavior:
  <https://docs.python.org/3.12/library/sys_path_init.html>
- CPython 3.12 supported Windows versions:
  <https://docs.python.org/3.12/using/windows.html#supported-windows-versions>
- `python-build-standalone` immutable `20260825` release:
  <https://github.com/astral-sh/python-build-standalone/releases/tag/20260825>
- Pinned `python-build-standalone` runtime and target-triple guidance:
  <https://github.com/astral-sh/python-build-standalone/blob/c0aa3bbdc2fff56a77ad1ecec68b1e47794d8779/docs/running.rst>
- Pinned macOS deployment-target configuration:
  <https://github.com/astral-sh/python-build-standalone/blob/c0aa3bbdc2fff56a77ad1ecec68b1e47794d8779/cpython-unix/targets.yml>
- GitHub regular-repository file-size limits:
  <https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github>
- Apple's unknown-developer recovery guidance:
  <https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac>
