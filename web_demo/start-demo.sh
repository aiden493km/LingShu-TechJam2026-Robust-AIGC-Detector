#!/bin/sh
if [ "$(/usr/bin/uname -s 2>/dev/null)" = "Darwin" ]; then
  SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd) || exit 1
  exec "$SCRIPT_DIR/tools/bootstrap_macos.sh" "$@"
fi

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
