#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd) || exit 1
"$SCRIPT_DIR/tools/bootstrap_macos.sh" "$@"
status=$?
if [ "$status" -ne 0 ] && [ "$#" -eq 0 ]; then
  printf '%s' 'Press Return to close this window...'
  IFS= read -r _
fi
exit "$status"
