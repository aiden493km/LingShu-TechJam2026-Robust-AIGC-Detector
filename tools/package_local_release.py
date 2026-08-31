"""Build the two deterministic, allowlisted LingShu local release archives."""

import argparse
import hashlib
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


_VERSION_RE = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
_DRIVE_RE = re.compile(r"^[A-Za-z]:")
_ZIP_MIN_EPOCH = 315_532_800  # 1980-01-01T00:00:00Z
_ZIP_MAX_EPOCH = 4_354_819_198  # 2107-12-31T23:59:58Z
_WINDOWS_ROOT = "LingShu-WebDemo-Windows-x64"
_MACOS_ROOT = "LingShu-WebDemo-macOS-Apple-Silicon"
_WINDOWS_LAUNCHER = (
    b"@echo off\r\n"
    b'call "%~dp0web_demo\\start-demo.bat" %*\r\n'
    b"exit /b %ERRORLEVEL%\r\n"
)
_MACOS_LAUNCHER = (
    b"#!/bin/sh\n"
    b'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\n'
    b'exec "$SCRIPT_DIR/web_demo/start-demo.command" "$@"\n'
)


@dataclass(frozen=True)
class BuiltArchive:
    platform: str
    path: Path
    bytes: int
    sha256: str


@dataclass(frozen=True)
class _Entry:
    name: str
    source: Path | None = None
    content: bytes | None = None


class _Utf8ZipInfo(zipfile.ZipInfo):
    def _encodeFilenameFlags(self):
        return self.filename.encode("utf-8"), self.flag_bits | 0x800


def _validate_version(version: str) -> None:
    if not _VERSION_RE.fullmatch(version):
        raise ValueError(
            f"version must be a canonical x.y.z semantic version without a v prefix: {version!r}"
        )


def _validate_relative_name(name: str) -> None:
    if not name or "\x00" in name or "\\" in name:
        raise ValueError(f"unsafe archive member name: {name!r}")
    if name.startswith("/") or _DRIVE_RE.match(name):
        raise ValueError(f"unsafe archive member name: {name!r}")
    parts = PurePosixPath(name).parts
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"unsafe archive member name: {name!r}")
    name.encode("utf-8")


def _is_link(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", None)
    return path.is_symlink() or (is_junction is not None and is_junction())


def _resolved_source_path(repository_root: Path, path: Path) -> Path:
    try:
        lexical_relative = path.relative_to(repository_root)
    except ValueError:
        raise ValueError(f"release source escapes repository root: {path}") from None
    if any(part in ("", ".", "..") for part in lexical_relative.parts):
        raise ValueError(f"release source escapes repository root: {path}")

    component = repository_root
    for part in lexical_relative.parts:
        component = component / part
        if _is_link(component):
            raise ValueError(
                f"symlink or junction source component is not allowed: {component}"
            )

    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError:
        raise FileNotFoundError(f"required release source is missing: {path}") from None
    try:
        resolved.relative_to(repository_root)
    except ValueError:
        raise ValueError(f"resolved release source escapes repository root: {path}") from None
    return resolved


def _require_regular_file(repository_root: Path, path: Path) -> Path:
    resolved = _resolved_source_path(repository_root, path)
    source_stat = resolved.stat()
    if not stat.S_ISREG(source_stat.st_mode):
        raise ValueError(f"release source must be a regular file: {path}")
    return resolved


def _require_directory(repository_root: Path, path: Path) -> Path:
    resolved = _resolved_source_path(repository_root, path)
    if not resolved.is_dir():
        raise ValueError(f"release source tree must be a directory: {path}")
    return resolved


def _walk_regular_files(repository_root: Path, root: Path) -> list[Path]:
    root = _require_directory(repository_root, root)

    files: list[Path] = []
    for current, directories, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        directories.sort()
        filenames.sort()
        for directory in directories:
            directory_path = current_path / directory
            _require_directory(repository_root, directory_path)
        for filename in filenames:
            files.append(
                _require_regular_file(repository_root, current_path / filename)
            )
    return files


def _source_entry(repository_root: Path, relative_name: str) -> _Entry:
    _validate_relative_name(relative_name)
    return _Entry(
        relative_name,
        source=_require_regular_file(repository_root, repository_root / relative_name),
    )


def _tree_entries(repository_root: Path, relative_root: str) -> list[_Entry]:
    _validate_relative_name(relative_root)
    tree_root = repository_root / relative_root
    entries = []
    for path in _walk_regular_files(repository_root, tree_root):
        relative_name = path.relative_to(repository_root).as_posix()
        _validate_relative_name(relative_name)
        entries.append(_Entry(relative_name, source=path))
    return entries


def _common_entries(repository_root: Path) -> list[_Entry]:
    entries = []
    entries.extend(_tree_entries(repository_root, "web_demo/dist"))
    entries.extend(_tree_entries(repository_root, "third_party/browser-runtime-licenses"))
    for relative_name in (
        "web_demo/models/baseline2_njr_fp32.onnx",
        "web_demo/models/manifest.json",
        "web_demo/tools/serve_demo.py",
        "web_demo/tools/verify_distribution.py",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "third_party/Community-Forensics-LICENSE",
    ):
        entries.append(_source_entry(repository_root, relative_name))
    return entries


def _platform_entries(repository_root: Path, platform: str) -> tuple[str, str, list[_Entry]]:
    if platform == "windows-x64":
        root_name = _WINDOWS_ROOT
        asset_stem = _WINDOWS_ROOT
        entries = [
            _Entry("START-HERE-WINDOWS.bat", content=_WINDOWS_LAUNCHER),
            _source_entry(repository_root, "web_demo/start-demo.bat"),
            _source_entry(repository_root, "web_demo/tools/bootstrap_windows.ps1"),
            _source_entry(repository_root, "web_demo/runtimes/windows-x86_64-python.zip"),
        ]
    elif platform == "macos-apple-silicon":
        root_name = _MACOS_ROOT
        asset_stem = _MACOS_ROOT
        entries = [
            _Entry("START-HERE-MAC.command", content=_MACOS_LAUNCHER),
            _source_entry(repository_root, "web_demo/start-demo.command"),
            _source_entry(repository_root, "web_demo/tools/bootstrap_macos.sh"),
            _source_entry(repository_root, "web_demo/runtimes/macos-arm64-python.tar.gz"),
        ]
    else:
        raise ValueError(f"unsupported release platform: {platform}")
    return root_name, asset_stem, entries


def _validated_entries(root_name: str, entries: list[_Entry]) -> tuple[list[str], list[_Entry]]:
    _validate_relative_name(root_name)
    files_by_case: dict[str, str] = {}
    files_by_name: dict[str, _Entry] = {}
    for entry in entries:
        _validate_relative_name(entry.name)
        if (entry.source is None) == (entry.content is None):
            raise ValueError(f"archive entry must have exactly one content source: {entry.name}")
        folded = entry.name.casefold()
        previous = files_by_case.get(folded)
        if previous is not None:
            raise ValueError(
                f"case-insensitive archive member collision: {previous!r} and {entry.name!r}"
            )
        files_by_case[folded] = entry.name
        files_by_name[entry.name] = entry

    directory_names = {root_name}
    directories_by_case = {root_name.casefold(): root_name}
    for entry_name in files_by_name:
        parts = entry_name.split("/")
        for end in range(1, len(parts)):
            relative_directory = "/".join(parts[:end])
            folded = relative_directory.casefold()
            if folded in files_by_case:
                raise ValueError(
                    f"archive path is both a file and directory: {relative_directory!r}"
                )
            previous = directories_by_case.get(folded)
            if previous is not None and previous != relative_directory:
                raise ValueError(
                    f"case-insensitive archive directory collision: {previous!r} and {relative_directory!r}"
                )
            directories_by_case[folded] = relative_directory
            directory_names.add(f"{root_name}/{relative_directory}")

    sorted_directories = sorted(f"{name}/" for name in directory_names)
    sorted_entries = sorted(files_by_name.values(), key=lambda item: f"{root_name}/{item.name}")
    return sorted_directories, sorted_entries


def _git_head_epoch(repository_root: Path) -> int:
    result = subprocess.run(
        ["git", "-C", str(repository_root), "log", "-1", "--format=%ct", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0 or not result.stdout.strip().isdigit():
        detail = result.stderr.strip() or result.stdout.strip() or "no timestamp returned"
        raise RuntimeError(f"could not read git HEAD commit timestamp: {detail}")
    return int(result.stdout.strip())


def _zip_timestamp(epoch: int) -> tuple[int, int, int, int, int, int]:
    if isinstance(epoch, bool) or not isinstance(epoch, int):
        raise ValueError("source_date_epoch must be an integer Unix timestamp")
    clamped = min(max(epoch, _ZIP_MIN_EPOCH), _ZIP_MAX_EPOCH)
    date_time = list(datetime.fromtimestamp(clamped, tz=timezone.utc).timetuple()[:6])
    date_time[5] -= date_time[5] % 2
    return tuple(date_time)


def _zip_info(name: str, timestamp: tuple[int, int, int, int, int, int], directory: bool) -> zipfile.ZipInfo:
    info = _Utf8ZipInfo(name, timestamp)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_DEFLATED
    mode = 0o755 if directory or name.endswith((".command", ".sh")) else 0o644
    file_type = stat.S_IFDIR if directory else stat.S_IFREG
    info.external_attr = ((file_type | mode) & 0xFFFF) << 16
    if directory:
        info.external_attr |= 0x10
    return info


def _write_archive(
    output_path: Path,
    root_name: str,
    directories: list[str],
    entries: list[_Entry],
    timestamp: tuple[int, int, int, int, int, int],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = tempfile.NamedTemporaryFile(
        prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent, delete=False
    )
    temporary_path = Path(temporary.name)
    temporary.close()
    try:
        with zipfile.ZipFile(
            temporary_path,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=False,
        ) as archive:
            names_and_entries: list[tuple[str, _Entry | None]] = [
                (name, None) for name in directories
            ]
            names_and_entries.extend((f"{root_name}/{entry.name}", entry) for entry in entries)
            for archive_name, entry in sorted(names_and_entries, key=lambda item: item[0]):
                if entry is None:
                    archive.writestr(_zip_info(archive_name, timestamp, True), b"")
                    continue
                info = _zip_info(archive_name, timestamp, False)
                if entry.content is not None:
                    archive.writestr(info, entry.content)
                else:
                    with entry.source.open("rb") as source, archive.open(
                        info, "w", force_zip64=True
                    ) as destination:
                        shutil.copyfileobj(source, destination, length=1024 * 1024)
        os.replace(temporary_path, output_path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_release_archives(
    repository_root: Path,
    output_dir: Path,
    version: str,
    source_date_epoch: int | None = None,
) -> tuple[BuiltArchive, BuiltArchive]:
    """Build the Windows x64 and Apple Silicon macOS release ZIPs."""

    _validate_version(version)
    requested_repository_root = Path(repository_root)
    if _is_link(requested_repository_root):
        raise ValueError(
            f"repository root must not be a symlink or junction: {requested_repository_root}"
        )
    try:
        repository_root = requested_repository_root.resolve(strict=True)
    except FileNotFoundError:
        raise FileNotFoundError(
            f"repository root is missing: {requested_repository_root}"
        ) from None
    if not repository_root.is_dir():
        raise ValueError(f"repository root must be a directory: {requested_repository_root}")
    output_dir = Path(output_dir).resolve()
    epoch = _git_head_epoch(repository_root) if source_date_epoch is None else source_date_epoch
    timestamp = _zip_timestamp(epoch)

    common_entries = _common_entries(repository_root)
    prepared = []
    for platform in ("windows-x64", "macos-apple-silicon"):
        root_name, asset_stem, platform_entries = _platform_entries(repository_root, platform)
        directories, entries = _validated_entries(root_name, common_entries + platform_entries)
        prepared.append((platform, root_name, asset_stem, directories, entries))

    built = []
    for platform, root_name, asset_stem, directories, entries in prepared:
        output_path = output_dir / f"{asset_stem}-v{version}.zip"
        _write_archive(output_path, root_name, directories, entries, timestamp)
        built.append(
            BuiltArchive(
                platform=platform,
                path=output_path,
                bytes=output_path.stat().st_size,
                sha256=_sha256(output_path),
            )
        )
    return built[0], built[1]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-date-epoch", type=int, help=argparse.SUPPRESS)
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    archives = build_release_archives(
        arguments.repository_root,
        arguments.output_dir,
        arguments.version,
        arguments.source_date_epoch,
    )
    for archive in archives:
        print(f"{archive.path.name}\t{archive.bytes}\t{archive.sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
