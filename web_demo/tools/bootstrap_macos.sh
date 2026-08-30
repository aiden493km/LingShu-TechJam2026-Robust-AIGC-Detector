#!/bin/sh
ARCHIVE_NAME='macos-arm64-python.tar.gz'
EXPECTED_BYTES='24970238'
EXPECTED_SHA256='8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6'
CACHE_NAME='macos-arm64-8b0f1fa71eab'
ENTRYPOINT='python/bin/python3'

set -f
umask 077

temp_cache=''
invalid_cache=''
lock_fd_open=0
lock_path=''
cache_root=''
last_probe_error=''

fail() {
  printf '%s\n' "ERROR: WebDemo bootstrap failed: $*" >&2
  exit 1
}

cleanup() {
  cleanup_status=$?
  trap - 0 1 2 15

  if [ "$lock_fd_open" -eq 1 ]; then
    exec 9>&-
    lock_fd_open=0
  fi
  if [ -n "$temp_cache" ] && [ -n "$cache_root" ] &&
     [ "$(/usr/bin/dirname -- "$temp_cache")" = "$cache_root" ] &&
     [ -d "$temp_cache" ] && [ ! -L "$temp_cache" ]; then
    /bin/rm -rf "$temp_cache"
  fi
  if [ -n "$invalid_cache" ] && [ -n "$cache_root" ] &&
     [ "$(/usr/bin/dirname -- "$invalid_cache")" = "$cache_root" ] &&
     [ -d "$invalid_cache" ] && [ ! -L "$invalid_cache" ]; then
    /bin/rm -rf "$invalid_cache"
  fi
  exit "$cleanup_status"
}

trap cleanup 0 1 2 15

test_bundled_python() {
  candidate_python=$1
  last_probe_error=''
  [ -x "$candidate_python" ] || {
    last_probe_error='interpreter is missing or not executable'
    return 1
  }

  probe_output=$("$candidate_python" -E -s -B -X utf8 -c \
    "import platform,sys; arch=platform.machine().lower(); ok=(platform.python_implementation()=='CPython' and sys.version_info[:2]==(3,12) and arch in ('arm64','aarch64')); print('{}|{}|{}'.format(platform.python_implementation(),platform.python_version(),arch)); raise SystemExit(0 if ok else 1)" 2>&1)
  probe_status=$?
  if [ "$probe_status" -ne 0 ]; then
    last_probe_error=$probe_output
    return 1
  fi

  case "$probe_output" in
    CPython\|3.12.*\|arm64|CPython\|3.12.*\|aarch64)
      return 0
      ;;
    *)
      last_probe_error="unexpected runtime identity: $probe_output"
      return 1
      ;;
  esac
}

test_runtime_cache() {
  candidate_cache=$1
  [ -d "$candidate_cache" ] && [ ! -L "$candidate_cache" ] || return 1
  [ "$(/usr/bin/dirname -- "$candidate_cache")" = "$cache_root" ] || return 1

  marker_path="$candidate_cache/.complete-sha256"
  [ -f "$marker_path" ] && [ ! -L "$marker_path" ] || return 1
  marker_bytes=$(/usr/bin/stat -f '%z' "$marker_path" 2>/dev/null) || return 1
  [ "$marker_bytes" = '65' ] || return 1
  marker_value=''
  IFS= read -r marker_value < "$marker_path" || return 1
  [ "$marker_value" = "$EXPECTED_SHA256" ] || return 1

  test_bundled_python "$candidate_cache/$ENTRYPOINT"
}

lock_path_is_safe() {
  [ -n "$lock_path" ] && [ -n "$cache_root" ] &&
    [ "$(/usr/bin/dirname -- "$lock_path")" = "$cache_root" ] &&
    [ ! -L "$lock_path" ] &&
    { [ ! -e "$lock_path" ] || [ -f "$lock_path" ]; }
}

lock_file_is_safe() {
  [ "$(/usr/bin/dirname -- "$lock_path")" = "$cache_root" ] &&
    [ -f "$lock_path" ] && [ ! -L "$lock_path" ]
}

acquire_lock() {
  lock_path_is_safe ||
    fail "Runtime cache lock must be a regular non-symlink direct child: $lock_path"
  [ -x /usr/bin/lockf ] ||
    fail 'Required macOS kernel lock utility is missing: /usr/bin/lockf'

  exec 9>>"$lock_path" || fail "Could not open the runtime cache lock: $lock_path"
  lock_fd_open=1
  if ! lock_file_is_safe; then
    release_lock
    fail "Runtime cache lock became unsafe while opening: $lock_path"
  fi
  if ! /usr/bin/lockf -s -t 8 9 2>/dev/null; then
    release_lock
    fail "Timed out after 8 seconds waiting for the runtime cache lock: $lock_path. Close any stuck WebDemo launcher and retry."
  fi
}

release_lock() {
  [ "$lock_fd_open" -eq 1 ] || return 0
  exec 9>&-
  lock_fd_open=0
}

remove_invalid_fixed_cache() {
  if [ -L "$fixed_cache" ] || { [ -e "$fixed_cache" ] && [ ! -d "$fixed_cache" ]; }; then
    fail "Runtime cache entry must be a non-symlink directory: $fixed_cache"
  fi
  [ -d "$fixed_cache" ] || return 0
  [ "$(/usr/bin/dirname -- "$fixed_cache")" = "$cache_root" ] ||
    fail "Refusing to manage a runtime directory outside the cache root: $fixed_cache"

  cache_guid=$(/usr/bin/uuidgen 2>/dev/null) ||
    fail 'Could not create a unique runtime-cache recovery name.'
  case "$cache_guid" in
    ''|*[!0-9A-Fa-f-]*)
      fail 'Could not create a valid runtime-cache recovery name.'
      ;;
  esac
  invalid_cache="$cache_root/$CACHE_NAME.invalid-$cache_guid"
  /bin/mv "$fixed_cache" "$invalid_cache" ||
    fail "Could not quarantine the invalid runtime cache: $fixed_cache"
  [ -d "$invalid_cache" ] && [ ! -L "$invalid_cache" ] &&
    [ "$(/usr/bin/dirname -- "$invalid_cache")" = "$cache_root" ] ||
    fail "Quarantined runtime cache is unsafe: $invalid_cache"
  /bin/rm -rf "$invalid_cache" ||
    fail "Could not remove the quarantined runtime cache: $invalid_cache"
  invalid_cache=''
}

system_name=$(/usr/bin/uname -s 2>/dev/null) ||
  fail 'Could not identify this operating system.'
[ "$system_name" = 'Darwin' ] ||
  fail 'This bundled runtime requires macOS on Apple Silicon.'
arm64_capable=$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null) ||
  fail 'Could not verify Apple Silicon support with sysctl.'
[ "$arm64_capable" = '1' ] ||
  fail 'This bundled runtime requires macOS on Apple Silicon, including Rosetta shells.'

script_dir=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd) ||
  fail 'Could not resolve the macOS bootstrap directory.'
web_demo=$(CDPATH= cd -- "$script_dir/.." && pwd) ||
  fail 'Could not resolve the WebDemo directory.'
archive_path="$web_demo/runtimes/$ARCHIVE_NAME"
serve_demo="$web_demo/tools/serve_demo.py"
cache_root="$web_demo/.runtime-cache"
fixed_cache="$cache_root/$CACHE_NAME"
lock_path="$cache_root/$CACHE_NAME.lock"

env_names=$(/usr/bin/env | /usr/bin/sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p') ||
  fail 'Could not inspect the inherited environment.'
for env_name in $env_names; do
  case "$env_name" in
    PYTHON*|DYLD_*|VIRTUAL_ENV|CONDA_PREFIX|__PYVENV_LAUNCHER__)
      unset "$env_name"
      ;;
  esac
done
unset PYTHONHOME PYTHONPATH PYTHONUSERBASE VIRTUAL_ENV CONDA_PREFIX __PYVENV_LAUNCHER__

[ -f "$archive_path" ] && [ ! -L "$archive_path" ] ||
  fail "Bundled runtime archive must be a regular non-symlink file: $archive_path"
actual_bytes=$(/usr/bin/stat -f '%z' "$archive_path" 2>/dev/null) ||
  fail "Could not read the bundled runtime archive size: $archive_path"
[ "$actual_bytes" = "$EXPECTED_BYTES" ] ||
  fail "Bundled runtime archive size mismatch for $ARCHIVE_NAME. Restore the committed archive and retry."
actual_sha=$(/usr/bin/shasum -a 256 "$archive_path" 2>/dev/null) ||
  fail "Could not hash the bundled runtime archive: $archive_path"
actual_sha=${actual_sha%% *}
[ "$actual_sha" = "$EXPECTED_SHA256" ] ||
  fail "Bundled runtime archive SHA-256 mismatch for $ARCHIVE_NAME. Restore the committed archive and retry."
[ -f "$serve_demo" ] && [ ! -L "$serve_demo" ] ||
  fail "WebDemo server entry point is missing or unsafe: $serve_demo"

if [ -L "$cache_root" ] || { [ -e "$cache_root" ] && [ ! -d "$cache_root" ]; }; then
  fail "Runtime cache root must be a non-symlink directory: $cache_root"
fi
if [ ! -d "$cache_root" ]; then
  /bin/mkdir "$cache_root" 2>/dev/null || [ -d "$cache_root" ] ||
    fail "Could not create the runtime cache: $cache_root"
fi
[ -d "$cache_root" ] && [ ! -L "$cache_root" ] ||
  fail "Runtime cache root is unsafe: $cache_root"

cache_state=''
acquire_lock
if test_runtime_cache "$fixed_cache"; then
  cache_state='reused'
else
  remove_invalid_fixed_cache
fi
release_lock

if [ -z "$cache_state" ]; then
  temp_cache=$(/usr/bin/mktemp -d "$cache_root/$CACHE_NAME.tmp.XXXXXXXX") ||
    fail "Could not create a private extraction directory in $cache_root"
  [ -d "$temp_cache" ] && [ ! -L "$temp_cache" ] &&
    [ "$(/usr/bin/dirname -- "$temp_cache")" = "$cache_root" ] ||
    fail "Temporary runtime directory is unsafe: $temp_cache"

  /usr/bin/tar -xzf "$archive_path" -C "$temp_cache" ||
    fail "Could not extract the bundled runtime archive: $archive_path"
  temp_python="$temp_cache/$ENTRYPOINT"
  if ! test_bundled_python "$temp_python"; then
    fail "Bundled interpreter failed its CPython 3.12 arm64 self-test: $temp_python. If macOS blocked it, open System Settings -> Privacy & Security -> Open Anyway, then retry. $last_probe_error"
  fi
  printf '%s\n' "$EXPECTED_SHA256" > "$temp_cache/.complete-sha256" ||
    fail "Could not mark the extracted runtime complete: $temp_cache"

  acquire_lock
  if test_runtime_cache "$fixed_cache"; then
    cache_state='reused'
  else
    remove_invalid_fixed_cache
    /bin/mv "$temp_cache" "$fixed_cache" ||
      fail "Could not install the bundled runtime cache: $fixed_cache"
    temp_cache=''
    cache_state='created'
  fi
  release_lock

  if [ -n "$temp_cache" ]; then
    [ -d "$temp_cache" ] && [ ! -L "$temp_cache" ] &&
      [ "$(/usr/bin/dirname -- "$temp_cache")" = "$cache_root" ] ||
      fail "Refusing to clean an unsafe temporary runtime directory: $temp_cache"
    /bin/rm -rf "$temp_cache" ||
      fail "Could not clean the temporary runtime directory: $temp_cache"
    temp_cache=''
  fi
fi

if ! test_runtime_cache "$fixed_cache"; then
  fail "Bundled runtime cache failed final validation: $fixed_cache. If macOS blocked $fixed_cache/$ENTRYPOINT, open System Settings -> Privacy & Security -> Open Anyway, then retry. $last_probe_error"
fi
bundled_python="$fixed_cache/$ENTRYPOINT"

cd "$web_demo" || fail "Could not open the WebDemo directory: $web_demo"
printf '%s\n' 'RUNTIME bundled CPython 3.12.14 (macOS arm64)'
printf '%s\n' "CACHE $cache_state"
printf '%s\n' 'ISOLATION inherited Python and DYLD environments disabled'

"$bundled_python" -E -s -B -X utf8 "$serve_demo" "$@"
server_status=$?
exit "$server_status"
