# Portable launcher acceptance

Status: **Windows command-path acceptance passed; Windows Explorer double-click and physical Apple Silicon Finder acceptance remain pending.**

This record separates observed results from work that still requires a person at
the target desktop. It does not infer a GUI or macOS pass from unit tests or CI.

## Implementation under test

- Commit: `154ed4d3ab0cd92b08ad5584bc6b2de0054bb5e0`
- Branch: `feat/web-demo`
- Model: committed FP32 ONNX model, threshold `0.55657113`
- Windows fresh clone: no `.venv`, `node_modules`, or
  `web_demo/.runtime-cache` before the first launch
- macOS transfer bundle: `lingshu-portable.bundle`
  - bytes: `138313026`
  - SHA-256: `043763e98781ba27d7588471702fa9e3caf793b1b39a81825280500c1416df06`
  - `git bundle verify`: passed; the bundle contains the complete history and
    `refs/heads/feat/web-demo` at the implementation commit above

## Windows observations

Observed on 2026-08-30 (Asia/Singapore):

| Item | Observation |
|---|---|
| OS | Microsoft Windows 11 Home China, `10.0.22631`, x86-64 |
| Browser | Microsoft Edge `152.0.4191.53` |
| System Python dependency | The launch process received `PATH=C:\Windows\System32;C:\Windows`; `where.exe python` found no Python |
| First BAT launch | Passed; `CACHE created`; `READY` after `3649 ms`; root URL returned HTTP 200 |
| Reused BAT launch | Passed; `CACHE reused`; `READY` after `2433 ms`; root URL returned HTTP 200 |
| Runtime isolation | Both launches printed bundled CPython 3.12.10 and `ISOLATION inherited Python environments disabled` |
| Shutdown | After terminating each launcher's own process tree, its URL was unreachable |
| Port fallback | With a harmless holder on 8765 and pre-existing listeners on 8766/8767, the demo selected 8768 |
| Neighbor-process safety | The 8765 holder remained bound while the demo ran and after the demo stopped |

The two launch timings are observations on this machine, measured from starting
`cmd.exe /d /c web_demo\start-demo.bat --no-browser` until the stable `READY`
line. They are not promises for a judge's machine and do not include a human's
Explorer interaction time.

### Real-browser inference

The clean implementation commit passed the repository's installed-Edge
acceptance runner. It exercised the source checkout and a disposable tracked-file
copy, with 15 images in each of normal WebGPU, automatic WASM fallback, and
forced-WASM modes: **90/90 inference cases passed** in total. Both local server
URLs became unreachable after shutdown.

Two representative results from the fresh-copy normal WebGPU run were:

| Committed sample | Expected class | Browser result | Probability |
|---|---|---|---:|
| `demo_images/f1.png` | AIGC | AIGC | `0.999998378009472` |
| `demo_images/r2.png` | Real | Real | `0.000000249522554361318` |

The runner also verified automatic fallback, forced WASM, local-only requests,
the frozen FP32 model identity, corrupt-model rejection, missing-runtime
rejection, port fallback, and shutdown reachability.

### Windows GUI item still pending

`start-demo.bat` was not double-clicked through Explorer in this pass. Desktop
automation stopped when concurrent user input was detected, so recording a GUI
pass would be inaccurate. A person should still double-click the BAT once and
confirm that the console reaches `READY`, Edge opens, one image can be selected,
and closing the console makes the shown URL unreachable.

## Apple Silicon acceptance pending

The exact implementation bundle is prepared and verified on Windows, but the
following items have **not yet been observed on a physical Mac**:

| Item | Status |
|---|---|
| Clone bundle and verify exact HEAD | NOT RUN |
| `/bin/sh web_demo/start-demo.command --check` | NOT RUN |
| Finder double-click of `start-demo.command` | NOT RUN |
| Gatekeeper behavior / Open Anyway requirement | NOT RUN |
| First `CACHE created` and reused `CACHE reused` | NOT RUN |
| Known AIGC and Real browser inferences | NOT RUN |
| Shutdown makes URL unreachable | NOT RUN |
| Occupied-8765 fallback leaves holder alive | NOT RUN |
| First/reused launch timings | NOT MEASURED |

After copying the bundle to `~/Downloads/lingshu-portable.bundle`, use:

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

Then double-click `web_demo/start-demo.command` in Finder and fill only the
observations actually seen on that Mac into this section.

## Delivery boundaries

- Intel macOS runtime is not shipped and Intel support is unverified.
- The macOS launcher is not signed or notarized because the team has no
  Developer ID; Gatekeeper may require **Open Anyway** once.
- Online deployment is deferred until the local reproducibility path is fully
  accepted.
