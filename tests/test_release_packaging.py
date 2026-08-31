import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = REPOSITORY_ROOT / "tools" / "package_local_release.py"
LICENSE_BUNDLE_ROOT = REPOSITORY_ROOT / "third_party" / "browser-runtime-licenses"
LICENSE_INVENTORY_PATH = LICENSE_BUNDLE_ROOT / "inventory.json"
STABLE_EPOCH = 1_700_000_000
WINDOWS_ASSET = "LingShu-WebDemo-Windows-x64-v1.2.0.zip"
MACOS_ASSET = "LingShu-WebDemo-macOS-Apple-Silicon-v1.2.0.zip"
WINDOWS_ROOT = "LingShu-WebDemo-Windows-x64"
MACOS_ROOT = "LingShu-WebDemo-macOS-Apple-Silicon"
MODEL_BYTES = 88_123_029
MODEL_SHA256 = "e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69"
RUNTIME_IDENTITIES = {
    "windows-x86_64-python.zip": (
        11_133_606,
        "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3",
    ),
    "macos-arm64-python.tar.gz": (
        24_970_238,
        "8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6",
    ),
}
LICENSE_HASHES = {
    "README.md": "__README_TEXT__",
    "onnxruntime/LICENSE": "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
    "onnxruntime/ThirdPartyNotices.txt": "53d3fa5821ac016ac24dd35775c996efec86e2ae0841e9a3a5e146c0ae916845",
    "react/LICENSE": "da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93",
    "react-dom/LICENSE": "da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93",
    "scheduler/LICENSE": "da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93",
    "jsquash-jpeg/LICENSE": "8c3690b09c168f196446cf5904332023bbc15eb92b6a7cee470ac829e6a65d20",
    "jsquash-jpeg/codec/LICENSE.codec.md": "8213556ea36ce3a0f2883db06238463e2452fdad68e3d2e2e4ace2189477a37e",
    "jsquash-png/LICENSE": "8c3690b09c168f196446cf5904332023bbc15eb92b6a7cee470ac829e6a65d20",
    "jsquash-png/codec/LICENSE.codec.md": "e293d1dddc9785200b1f58a4f5293543cf8566d9e0b8a3c02fad955035b19f42",
    "jsquash-webp/LICENSE": "8c3690b09c168f196446cf5904332023bbc15eb92b6a7cee470ac829e6a65d20",
    "jsquash-webp/codec/LICENSE.codec.md": "e293d1dddc9785200b1f58a4f5293543cf8566d9e0b8a3c02fad955035b19f42",
    "jsquash-resize/LICENSE": "8c3690b09c168f196446cf5904332023bbc15eb92b6a7cee470ac829e6a65d20",
    "jsquash-resize/lib/hqx/LICENSE.codec.md": "43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1",
    "jsquash-resize/lib/magic-kernel/LICENSE.codec.md": "21e492c2fb8be34abe00c1b5c4b15139e061ddfaa236adc4c0d4ff70ccd329b2",
    "jsquash-resize/lib/resize/LICENSE.codec.md": "373fec335329f8e4c9c8839871606e6ed5bfaa513a4dea2ebee4b7a418853320",
    "flatbuffers/LICENSE": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    "guid-typescript/package.json": "ed86856ee95fe87eadd8552b6803a85b7fb4f6cce08603bf9c8385972b5badb6",
    "long/LICENSE": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    "platform/LICENSE": "4a161ebed4f1ef933e16ccfa00d86c718703f5d015a9987ea7ce1bb72a43cd22",
    "protobufjs-aspromise/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-base64/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-codegen/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-eventemitter/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-fetch/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-float/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-path/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-pool/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs-utf8/LICENSE": "a67b34a24a5daddcce46aea68c5004e4442bbfb63690329fa607bf4de4269794",
    "protobufjs/LICENSE": "49d6a1c9a623784c61c6cb70f773f3457faceb1914a13c8560a9823b7631950c",
    "protobufjs/google/LICENSE": "4ab87e6e3c0c0b78e47c77d49ec10c048f8a519fb8062e6e3217e3e6e9b0c6e9",
    "types-node/LICENSE": "c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383",
    "undici-types/LICENSE": "a6db8096b2707bc0102d256917d4d33f298ba36d8c3f25de067a2b5bb379db27",
    "wasm-feature-detect/LICENSE": "bcf29b4fd3ec2cb5f9d40a0866da446f6da62170d2ccedf4aeca9cf9406dd20c",
}


def _load_builder(test_case: unittest.TestCase):
    test_case.assertTrue(
        BUILDER_PATH.is_file(),
        "Expected the deterministic release builder to exist",
    )
    spec = importlib.util.spec_from_file_location("package_local_release", BUILDER_PATH)
    test_case.assertIsNotNone(spec)
    test_case.assertIsNotNone(spec.loader)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _license_inventory(test_case: unittest.TestCase) -> dict:
    test_case.assertTrue(LICENSE_INVENTORY_PATH.is_file(), LICENSE_INVENTORY_PATH)
    return json.loads(LICENSE_INVENTORY_PATH.read_text(encoding="utf-8"))


def _production_dependency_closure() -> dict[str, str]:
    lock = json.loads(
        (REPOSITORY_ROOT / "web_demo" / "package-lock.json").read_text(
            encoding="utf-8"
        )
    )
    packages = lock["packages"]
    pending = list(packages[""]["dependencies"])
    closure = {}
    while pending:
        package_name = pending.pop()
        if package_name in closure:
            continue
        package = packages[f"node_modules/{package_name}"]
        closure[package_name] = package["version"]
        pending.extend(package.get("dependencies", {}))
    return closure


def _create_directory_link(
    test_case: unittest.TestCase, target: Path, link: Path
) -> None:
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except OSError as symlink_error:
        junction = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if junction.returncode != 0:
            test_case.skipTest(
                f"This Windows account cannot create symlinks or junctions: {symlink_error}"
            )


def _create_file_symlink(
    test_case: unittest.TestCase, target: Path, link: Path
) -> bool:
    try:
        os.symlink(target, link, target_is_directory=False)
        return True
    except OSError:
        symlink = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", str(link), str(target)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        return symlink.returncode == 0


def _write_minimal_release_sources(repository_root: Path) -> None:
    for relative_path in (
        "web_demo/dist/index.html",
        "third_party/browser-runtime-licenses/README.md",
        "web_demo/models/baseline2_njr_fp32.onnx",
        "web_demo/models/manifest.json",
        "web_demo/tools/serve_demo.py",
        "web_demo/tools/verify_distribution.py",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "third_party/Community-Forensics-LICENSE",
        "web_demo/start-demo.bat",
        "web_demo/tools/bootstrap_windows.ps1",
        "web_demo/runtimes/windows-x86_64-python.zip",
        "web_demo/start-demo.command",
        "web_demo/tools/bootstrap_macos.sh",
        "web_demo/runtimes/macos-arm64-python.tar.gz",
    ):
        path = repository_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture")


def _commit_fixture_repository(repository_root: Path) -> None:
    commands = (
        ("init", "--quiet"),
        ("config", "user.name", "Release Test"),
        ("config", "user.email", "release-test@example.invalid"),
        ("config", "core.autocrlf", "false"),
        ("add", "--all"),
        ("commit", "--quiet", "-m", "test fixture"),
    )
    for arguments in commands:
        result = subprocess.run(
            ["git", *arguments],
            cwd=repository_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode != 0:
            raise AssertionError(result.stderr or result.stdout)


class ReleasePackagingTests(unittest.TestCase):
    def test_v1_2_metadata_and_license_exist(self) -> None:
        package_json = json.loads(
            (REPOSITORY_ROOT / "web_demo" / "package.json").read_text(
                encoding="utf-8"
            )
        )
        package_lock = json.loads(
            (REPOSITORY_ROOT / "web_demo" / "package-lock.json").read_text(
                encoding="utf-8"
            )
        )
        license_path = REPOSITORY_ROOT / "LICENSE"

        self.assertEqual(package_json["version"], "1.2.0")
        self.assertEqual(package_lock["version"], "1.2.0")
        self.assertEqual(package_lock["packages"][""]["version"], "1.2.0")
        self.assertTrue(license_path.is_file(), "Expected root LICENSE to exist")

        license_text = license_path.read_text(encoding="utf-8")
        self.assertIn("MIT License", license_text)
        self.assertIn("LingShu Intelligence contributors", license_text)

    def test_readme_keeps_evidence_and_exposes_release(self) -> None:
        readme_text = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn('<div align="center">', readme_text)
        self.assertIn("releases/tag/v1.2.0", readme_text)
        self.assertIn("0.973977", readme_text)
        self.assertIn("0.927090", readme_text)
        self.assertIn("0.993124", readme_text)
        self.assertIn("## License", readme_text)
        self.assertIn("THIRD_PARTY_NOTICES.md", readme_text)
        self.assertIn("Community-Forensics-LICENSE", readme_text)

        centered_div_index = readme_text.index('<div align="center">')
        at_a_glance_index = readme_text.index("## At a Glance")
        third_party_index = readme_text.rindex("## Third-Party Attribution")
        license_index = readme_text.rindex("## License")

        self.assertLess(centered_div_index, at_a_glance_index)
        self.assertGreater(license_index, third_party_index)


class BrowserRuntimeLicenseBundleTests(unittest.TestCase):
    def test_complete_vendored_license_bundle_exists_with_frozen_bytes(self) -> None:
        inventory = _license_inventory(self)
        referenced_notices = {
            notice["path"]
            for package in inventory["packages"].values()
            for notice in package["notices"]
        }
        actual = {
            path.relative_to(LICENSE_BUNDLE_ROOT).as_posix()
            for path in LICENSE_BUNDLE_ROOT.rglob("*")
            if path.is_file()
        } if LICENSE_BUNDLE_ROOT.is_dir() else set()

        self.assertEqual(referenced_notices | {"README.md", "inventory.json"}, actual)
        for relative_path, expected_sha256 in LICENSE_HASHES.items():
            if expected_sha256 == "__README_TEXT__":
                continue
            with self.subTest(path=relative_path):
                self.assertEqual(
                    expected_sha256,
                    _sha256_bytes((LICENSE_BUNDLE_ROOT / relative_path).read_bytes()),
                )

    def test_inventory_covers_exact_lockfile_production_closure_and_notice_hashes(self) -> None:
        inventory = _license_inventory(self)
        closure = _production_dependency_closure()
        packages = inventory["packages"]
        self.assertEqual(set(closure), set(packages))
        for package_name, version in closure.items():
            with self.subTest(package=package_name):
                package = packages[package_name]
                self.assertEqual(version, package["version"])
                self.assertTrue(package["source"])
                self.assertTrue(package["notices"])
                for notice in package["notices"]:
                    notice_path = LICENSE_BUNDLE_ROOT / notice["path"]
                    self.assertTrue(notice_path.is_file(), notice_path)
                    self.assertRegex(notice["sha256"], r"^[0-9a-f]{64}$")
                    self.assertEqual(
                        notice["sha256"], _sha256_bytes(notice_path.read_bytes())
                    )

        for package_name in ("onnxruntime-web", "onnxruntime-common"):
            source = packages[package_name]["source"]
            self.assertIn("microsoft/onnxruntime", source.casefold())
            self.assertIn("v1.29.0", source)

    def test_all_notice_files_have_independent_frozen_hashes(self) -> None:
        inventory = _license_inventory(self)
        notice_paths = {
            notice["path"]
            for package in inventory["packages"].values()
            for notice in package["notices"]
        }
        frozen_hashes = {
            path: sha256
            for path, sha256 in LICENSE_HASHES.items()
            if sha256 != "__README_TEXT__"
        }
        self.assertEqual(notice_paths, set(frozen_hashes))
        self.assertEqual(33, len(frozen_hashes))
        for relative_path, expected_sha256 in frozen_hashes.items():
            with self.subTest(path=relative_path):
                self.assertEqual(
                    expected_sha256,
                    _sha256_bytes((LICENSE_BUNDLE_ROOT / relative_path).read_bytes()),
                )

    def test_vendored_license_bytes_are_exempt_from_git_text_conversion(self) -> None:
        inventory = _license_inventory(self)
        relative_paths = {
            notice["path"]
            for package in inventory["packages"].values()
            for notice in package["notices"]
        }
        for relative_path in sorted(relative_paths):
            repository_path = (
                "third_party/browser-runtime-licenses/" + relative_path
            )
            result = subprocess.run(
                ["git", "check-attr", "text", "diff", "--", repository_path],
                cwd=REPOSITORY_ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            with self.subTest(path=relative_path):
                self.assertEqual(0, result.returncode, result.stderr)
                lines = result.stdout.splitlines()
                self.assertEqual(2, len(lines), result.stdout)
                self.assertTrue(lines[0].endswith(": text: unset"), result.stdout)
                self.assertTrue(lines[1].endswith(": diff: unset"), result.stdout)

    def test_license_inventory_names_exact_versions_sources_and_boundary(self) -> None:
        readme = (
            REPOSITORY_ROOT
            / "third_party"
            / "browser-runtime-licenses"
            / "README.md"
        )
        self.assertTrue(readme.is_file(), readme)
        content = readme.read_text(encoding="utf-8")
        for package, version, source in (
            ("ONNX Runtime", "1.29.0", "github.com/microsoft/onnxruntime/tree/v1.29.0"),
            ("React", "19.2.8", "web_demo/node_modules/react/"),
            ("react-dom", "19.2.8", "web_demo/node_modules/react-dom/"),
            ("scheduler", "0.27.0", "web_demo/node_modules/scheduler/"),
            ("@jsquash/jpeg", "1.6.0", "web_demo/node_modules/@jsquash/jpeg/"),
            ("@jsquash/png", "3.1.1", "web_demo/node_modules/@jsquash/png/"),
            ("@jsquash/webp", "1.5.0", "web_demo/node_modules/@jsquash/webp/"),
            ("@jsquash/resize", "2.1.1", "web_demo/node_modules/@jsquash/resize/"),
        ):
            with self.subTest(package=package):
                self.assertIn(package, content)
                self.assertIn(version, content)
                self.assertIn(source, content)
        self.assertIn("Windows", content)
        self.assertIn("macOS", content)
        self.assertRegex(content, r"(?i)internal license trees")
        self.assertRegex(content, r"(?i)not a legal certification")


class DeterministicReleaseBuilderTests(unittest.TestCase):
    _temporary_directory = None
    _module = None
    _first = None
    _second = None
    _cli_output = None

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._temporary_directory is not None:
            cls._temporary_directory.cleanup()

    def _ensure_archives(self):
        cls = type(self)
        if cls._first is not None:
            return cls._first, cls._second
        cls._module = _load_builder(self)
        cls._temporary_directory = tempfile.TemporaryDirectory()
        temporary_root = Path(cls._temporary_directory.name)
        cls._first = cls._module.build_release_archives(
            REPOSITORY_ROOT,
            temporary_root / "first",
            "1.2.0",
            source_date_epoch=STABLE_EPOCH,
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = cls._module.main(
                [
                    "--repository-root",
                    str(REPOSITORY_ROOT),
                    "--output-dir",
                    str(temporary_root / "second"),
                    "--version",
                    "1.2.0",
                    "--source-date-epoch",
                    str(STABLE_EPOCH),
                ]
            )
        self.assertEqual(0, exit_code)
        cls._cli_output = output.getvalue()
        cls._second = tuple(
            cls._module.BuiltArchive(
                platform=archive.platform,
                path=temporary_root / "second" / archive.path.name,
                bytes=(temporary_root / "second" / archive.path.name).stat().st_size,
                sha256=_sha256_bytes(
                    (temporary_root / "second" / archive.path.name).read_bytes()
                ),
            )
            for archive in cls._first
        )
        return cls._first, cls._second

    def _archive_for(self, platform: str):
        first, _ = self._ensure_archives()
        return next(archive for archive in first if archive.platform == platform)

    @staticmethod
    def _file_members(archive: zipfile.ZipFile) -> set[str]:
        return {info.filename for info in archive.infolist() if not info.is_dir()}

    @staticmethod
    def _expected_common_files(root_name: str) -> set[str]:
        result = {
            f"{root_name}/LICENSE",
            f"{root_name}/THIRD_PARTY_NOTICES.md",
            f"{root_name}/third_party/Community-Forensics-LICENSE",
            f"{root_name}/web_demo/models/baseline2_njr_fp32.onnx",
            f"{root_name}/web_demo/models/manifest.json",
            f"{root_name}/web_demo/tools/serve_demo.py",
            f"{root_name}/web_demo/tools/verify_distribution.py",
        }
        for path in (REPOSITORY_ROOT / "web_demo" / "dist").rglob("*"):
            if path.is_file():
                result.add(f"{root_name}/{path.relative_to(REPOSITORY_ROOT).as_posix()}")
        bundle = REPOSITORY_ROOT / "third_party" / "browser-runtime-licenses"
        for path in bundle.rglob("*"):
            if path.is_file():
                result.add(f"{root_name}/{path.relative_to(REPOSITORY_ROOT).as_posix()}")
        return result

    def test_asset_names_cli_tsv_and_repeated_builds_are_identical(self) -> None:
        first, second = self._ensure_archives()
        self.assertEqual([WINDOWS_ASSET, MACOS_ASSET], [item.path.name for item in first])
        self.assertEqual(
            [(item.platform, item.bytes, item.sha256) for item in first],
            [(item.platform, item.bytes, item.sha256) for item in second],
        )
        expected_lines = [
            f"{item.path.name}\t{item.bytes}\t{item.sha256}" for item in first
        ]
        self.assertEqual(expected_lines, type(self)._cli_output.splitlines())
        for item in first:
            self.assertRegex(item.sha256, r"^[0-9a-f]{64}$")

    def test_existing_output_assets_are_not_silently_overwritten(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository_root = temporary_root / "repository"
            output_dir = temporary_root / "output"
            _write_minimal_release_sources(repository_root)
            _commit_fixture_repository(repository_root)
            first = module.build_release_archives(
                repository_root, output_dir, "1.2.0", STABLE_EPOCH
            )
            before = {archive.path.name: archive.path.read_bytes() for archive in first}
            with self.assertRaises(FileExistsError):
                module.build_release_archives(
                    repository_root,
                    output_dir,
                    "1.2.0",
                    source_date_epoch=STABLE_EPOCH,
                )
            self.assertEqual(
                before,
                {archive.path.name: archive.path.read_bytes() for archive in first},
            )

    def test_dangling_output_symlink_is_not_replaced(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository_root = temporary_root / "repository"
            output_dir = temporary_root / "output"
            _write_minimal_release_sources(repository_root)
            _commit_fixture_repository(repository_root)
            output_dir.mkdir()
            dangling_target = temporary_root / "missing-target.zip"
            windows_output = output_dir / WINDOWS_ASSET
            if not _create_file_symlink(self, dangling_target, windows_output):
                dangling_target.mkdir()
                _create_directory_link(self, dangling_target, windows_output)
                dangling_target.rmdir()

            try:
                module.build_release_archives(
                    repository_root, output_dir, "1.2.0", STABLE_EPOCH
                )
            except FileExistsError:
                pass
            except OSError as error:
                self.fail(f"expected atomic FileExistsError, got {error!r}")
            else:
                self.fail("dangling output link was overwritten")

            self.assertTrue(module._is_link(windows_output))
            self.assertFalse((output_dir / MACOS_ASSET).exists())

    def test_output_created_after_validation_is_not_overwritten(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository_root = temporary_root / "repository"
            output_dir = temporary_root / "output"
            windows_output = output_dir / WINDOWS_ASSET
            _write_minimal_release_sources(repository_root)
            _commit_fixture_repository(repository_root)
            original_prevalidate = module._prevalidate_release_sources

            def create_racing_output(root: Path) -> None:
                original_prevalidate(root)
                output_dir.mkdir(parents=True, exist_ok=True)
                windows_output.write_bytes(b"racer-owned")

            with mock.patch.object(
                module,
                "_prevalidate_release_sources",
                side_effect=create_racing_output,
            ):
                with self.assertRaises(FileExistsError):
                    module.build_release_archives(
                        repository_root, output_dir, "1.2.0", STABLE_EPOCH
                    )

            self.assertEqual(b"racer-owned", windows_output.read_bytes())
            self.assertFalse((output_dir / MACOS_ASSET).exists())

    def test_archives_stream_raw_head_blobs_despite_autocrlf_worktree_bytes(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository_root = temporary_root / "repository"
            source = repository_root / "web_demo" / "dist" / "index.html"
            _write_minimal_release_sources(repository_root)
            source.write_bytes(b"first\nsecond\n")
            _commit_fixture_repository(repository_root)

            baseline = module.build_release_archives(
                repository_root,
                temporary_root / "output-lf",
                "1.2.0",
                STABLE_EPOCH,
            )
            subprocess.run(
                ["git", "config", "core.autocrlf", "true"],
                cwd=repository_root,
                check=True,
            )
            source.write_bytes(b"first\r\nsecond\r\n")
            raw_head = subprocess.run(
                ["git", "show", "HEAD:web_demo/dist/index.html"],
                cwd=repository_root,
                capture_output=True,
                check=True,
            ).stdout
            clean = subprocess.run(
                ["git", "diff", "--quiet", "HEAD", "--", "web_demo/dist/index.html"],
                cwd=repository_root,
                check=False,
            )
            self.assertEqual(0, clean.returncode)
            self.assertEqual(b"first\nsecond\n", raw_head)
            self.assertNotEqual(raw_head, source.read_bytes())

            converted = module.build_release_archives(
                repository_root,
                temporary_root / "output-crlf",
                "1.2.0",
                STABLE_EPOCH,
            )
            self.assertEqual(
                [(item.bytes, item.sha256) for item in baseline],
                [(item.bytes, item.sha256) for item in converted],
            )
            for archive, root_name in zip(converted, (WINDOWS_ROOT, MACOS_ROOT)):
                with zipfile.ZipFile(archive.path) as release_zip:
                    self.assertEqual(
                        raw_head,
                        release_zip.read(f"{root_name}/web_demo/dist/index.html"),
                    )

    def test_staged_deletion_cannot_omit_a_committed_recursive_member(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository_root = temporary_root / "repository"
            committed_name = "web_demo/dist/committed.js"
            _write_minimal_release_sources(repository_root)
            committed = repository_root / committed_name
            committed.write_bytes(b"committed-head-bytes")
            _commit_fixture_repository(repository_root)

            clean = module.build_release_archives(
                repository_root,
                temporary_root / "clean-output",
                "1.2.0",
                STABLE_EPOCH,
            )
            for archive, root_name in zip(clean, (WINDOWS_ROOT, MACOS_ROOT)):
                with zipfile.ZipFile(archive.path) as release_zip:
                    self.assertEqual(
                        b"committed-head-bytes",
                        release_zip.read(f"{root_name}/{committed_name}"),
                    )

            subprocess.run(
                ["git", "rm", "--quiet", "--", committed_name],
                cwd=repository_root,
                check=True,
            )
            dirty_output = temporary_root / "dirty-output"
            with self.assertRaises((FileNotFoundError, ValueError)):
                module.build_release_archives(
                    repository_root, dirty_output, "1.2.0", STABLE_EPOCH
                )
            self.assertFalse(dirty_output.exists())

    def test_replaced_reserved_output_identity_fails_and_preserves_racer(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository_root = temporary_root / "repository"
            output_dir = temporary_root / "output"
            windows_output = output_dir / WINDOWS_ASSET
            _write_minimal_release_sources(repository_root)
            _commit_fixture_repository(repository_root)
            original_write_archive = module._write_archive
            original_stat = module.Path.stat
            replaced = False

            def replace_after_write(*arguments, **keywords) -> None:
                nonlocal replaced
                original_write_archive(*arguments, **keywords)
                if not replaced:
                    windows_output.write_bytes(b"racer-owned")
                    replaced = True

            def stat_with_replaced_identity(path, *arguments, **keywords):
                result = original_stat(path, *arguments, **keywords)
                if replaced and Path(path) == windows_output:
                    return mock.Mock(st_dev=result.st_dev, st_ino=result.st_ino + 1)
                return result

            with mock.patch.object(
                module, "_write_archive", side_effect=replace_after_write
            ), mock.patch.object(module.Path, "stat", new=stat_with_replaced_identity):
                with self.assertRaisesRegex(RuntimeError, r"(?i)identity"):
                    module.build_release_archives(
                        repository_root, output_dir, "1.2.0", STABLE_EPOCH
                    )

            self.assertEqual(b"racer-owned", windows_output.read_bytes())
            macos_output = output_dir / MACOS_ASSET
            self.assertTrue(macos_output.exists(), "macOS reservation was unlinked")
            self.assertEqual(b"", macos_output.read_bytes())

    def test_failure_preserves_original_error_and_leaves_both_reservations(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            repository_root = temporary_root / "repository"
            output_dir = temporary_root / "output"
            windows_output = output_dir / WINDOWS_ASSET
            _write_minimal_release_sources(repository_root)
            _commit_fixture_repository(repository_root)
            with mock.patch.object(
                module, "_write_archive", side_effect=RuntimeError("original build failure")
            ):
                try:
                    module.build_release_archives(
                        repository_root, output_dir, "1.2.0", STABLE_EPOCH
                    )
                except RuntimeError as error:
                    self.assertEqual("original build failure", str(error))
                except BaseException as error:
                    self.fail(f"cleanup masked the original exception: {error!r}")
                else:
                    self.fail("expected the original build failure")

            macos_output = output_dir / MACOS_ASSET
            self.assertTrue(windows_output.exists(), "Windows reservation was unlinked")
            self.assertTrue(macos_output.exists(), "macOS reservation was unlinked")
            self.assertEqual(b"", windows_output.read_bytes())
            self.assertEqual(b"", macos_output.read_bytes())

    def test_cleanup_never_unlinks_racer_replaced_after_identity_check(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory) / "output"
            output_paths = (
                output_dir / WINDOWS_ASSET,
                output_dir / MACOS_ASSET,
            )
            reservations = module._reserve_output_paths(output_paths)
            original_stat = module.Path.stat
            racer = b"racer-owned-after-identity-check"
            replaced = False

            def replace_after_stat(path, *arguments, **keywords):
                nonlocal replaced
                result = original_stat(path, *arguments, **keywords)
                if Path(path) == output_paths[0] and not replaced:
                    output_paths[0].unlink()
                    output_paths[0].write_bytes(racer)
                    replaced = True
                return result

            with mock.patch.object(module.Path, "stat", new=replace_after_stat):
                module._cleanup_owned_reservations(reservations)

            if not replaced:
                output_paths[0].unlink()
                output_paths[0].write_bytes(racer)
            self.assertTrue(output_paths[0].exists(), "cleanup deleted racer content")
            self.assertEqual(racer, output_paths[0].read_bytes())

    def test_archives_have_one_safe_root_sorted_members_and_strict_allowlist(self) -> None:
        platform_contracts = {
            "windows-x64": (
                WINDOWS_ROOT,
                {
                    f"{WINDOWS_ROOT}/START-HERE-WINDOWS.bat",
                    f"{WINDOWS_ROOT}/web_demo/start-demo.bat",
                    f"{WINDOWS_ROOT}/web_demo/tools/bootstrap_windows.ps1",
                    f"{WINDOWS_ROOT}/web_demo/runtimes/windows-x86_64-python.zip",
                },
            ),
            "macos-apple-silicon": (
                MACOS_ROOT,
                {
                    f"{MACOS_ROOT}/START-HERE-MAC.command",
                    f"{MACOS_ROOT}/web_demo/start-demo.command",
                    f"{MACOS_ROOT}/web_demo/tools/bootstrap_macos.sh",
                    f"{MACOS_ROOT}/web_demo/runtimes/macos-arm64-python.tar.gz",
                },
            ),
        }
        for platform, (root_name, platform_files) in platform_contracts.items():
            with self.subTest(platform=platform):
                built = self._archive_for(platform)
                with zipfile.ZipFile(built.path) as archive:
                    infos = archive.infolist()
                    names = [info.filename for info in infos]
                    files = self._file_members(archive)
                self.assertEqual(sorted(names), names)
                self.assertEqual(
                    self._expected_common_files(root_name) | platform_files,
                    files,
                )
                for portrait in (
                    "jingxuan-qian.png",
                    "mingxuan-chen.png",
                    "tianshi-bu.png",
                    "zhiyi-li.png",
                ):
                    self.assertIn(
                        f"{root_name}/web_demo/dist/team/{portrait}", files
                    )
                roots = {name.rstrip("/").split("/", 1)[0] for name in names}
                self.assertEqual({root_name}, roots)
                self.assertEqual(len(names), len({name.casefold() for name in names}))
                for name in names:
                    clean_name = name.rstrip("/")
                    self.assertNotIn("\\", name)
                    self.assertNotIn("\x00", name)
                    self.assertFalse(clean_name.startswith("/"))
                    self.assertIsNone(re.match(r"^[A-Za-z]:", clean_name))
                    self.assertNotIn("..", clean_name.split("/"))
                    clean_name.encode("utf-8")
                    lowered_parts = {part.casefold() for part in clean_name.split("/")}
                    self.assertTrue(lowered_parts.isdisjoint({
                        ".git", "node_modules", ".runtime-cache", "runtime-cache",
                        "generated-tests", ".env", "env",
                    }))
                    self.assertFalse(clean_name.casefold().endswith(".map"))

    def test_launchers_platform_files_timestamps_and_unix_modes_are_exact(self) -> None:
        expected_windows = (
            b"@echo off\r\n"
            b'call "%~dp0web_demo\\start-demo.bat" %*\r\n'
            b"exit /b %ERRORLEVEL%\r\n"
        )
        expected_macos = (
            b"#!/bin/sh\n"
            b'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\n'
            b'exec "$SCRIPT_DIR/web_demo/start-demo.command" "$@"\n'
        )
        expected_timestamp = datetime.fromtimestamp(
            STABLE_EPOCH, tz=timezone.utc
        ).timetuple()[:6]
        for platform, root_name, launcher_name, launcher_bytes in (
            ("windows-x64", WINDOWS_ROOT, "START-HERE-WINDOWS.bat", expected_windows),
            ("macos-apple-silicon", MACOS_ROOT, "START-HERE-MAC.command", expected_macos),
        ):
            with self.subTest(platform=platform):
                built = self._archive_for(platform)
                with zipfile.ZipFile(built.path) as archive:
                    self.assertEqual(
                        launcher_bytes,
                        archive.read(f"{root_name}/{launcher_name}"),
                    )
                    for info in archive.infolist():
                        self.assertEqual(3, info.create_system)
                        self.assertEqual(expected_timestamp, info.date_time)
                        mode = (info.external_attr >> 16) & 0o777
                        if info.is_dir() or info.filename.endswith((".command", ".sh")):
                            self.assertEqual(0o755, mode, info.filename)
                        else:
                            self.assertEqual(0o644, mode, info.filename)
                    if platform == "macos-apple-silicon":
                        for name in (
                            f"{root_name}/START-HERE-MAC.command",
                            f"{root_name}/web_demo/start-demo.command",
                            f"{root_name}/web_demo/tools/bootstrap_macos.sh",
                        ):
                            content = archive.read(name)
                            self.assertNotIn(b"\r", content)
                            self.assertTrue(content.endswith(b"\n"))

    def test_model_runtime_and_internal_runtime_licenses_are_frozen(self) -> None:
        for platform, root_name, runtime_name in (
            ("windows-x64", WINDOWS_ROOT, "windows-x86_64-python.zip"),
            ("macos-apple-silicon", MACOS_ROOT, "macos-arm64-python.tar.gz"),
        ):
            with self.subTest(platform=platform):
                built = self._archive_for(platform)
                with zipfile.ZipFile(built.path) as archive:
                    model = archive.read(
                        f"{root_name}/web_demo/models/baseline2_njr_fp32.onnx"
                    )
                    runtime = archive.read(
                        f"{root_name}/web_demo/runtimes/{runtime_name}"
                    )
                self.assertEqual(MODEL_BYTES, len(model))
                self.assertEqual(MODEL_SHA256, _sha256_bytes(model))
                expected_bytes, expected_sha256 = RUNTIME_IDENTITIES[runtime_name]
                self.assertEqual(expected_bytes, len(runtime))
                self.assertEqual(expected_sha256, _sha256_bytes(runtime))
                archive_path = Path(type(self)._temporary_directory.name) / runtime_name
                archive_path.write_bytes(runtime)
                if runtime_name.endswith(".zip"):
                    with zipfile.ZipFile(archive_path) as runtime_archive:
                        self.assertIn("LICENSE.txt", runtime_archive.namelist())
                else:
                    with tarfile.open(archive_path, "r:gz") as runtime_archive:
                        names = runtime_archive.getnames()
                    self.assertIn("python/lib/python3.12/LICENSE.txt", names)
                    self.assertTrue(any(
                        name.startswith("python/lib/python3.12/site-packages/pip-")
                        and "/licenses/src/pip/_vendor/" in name
                        for name in names
                    ))

    def test_each_archive_contains_every_vendored_notice(self) -> None:
        inventory = _license_inventory(self)
        notice_paths = {
            notice["path"]
            for package in inventory["packages"].values()
            for notice in package["notices"]
        }
        for platform, root_name in (
            ("windows-x64", WINDOWS_ROOT),
            ("macos-apple-silicon", MACOS_ROOT),
        ):
            with self.subTest(platform=platform):
                built = self._archive_for(platform)
                with zipfile.ZipFile(built.path) as archive:
                    files = self._file_members(archive)
                for relative_path in notice_paths:
                    self.assertIn(
                        f"{root_name}/third_party/browser-runtime-licenses/{relative_path}",
                        files,
                    )

    def test_invalid_versions_and_missing_sources_are_rejected(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temp = Path(temporary_directory)
            for version in ("v1.2.0", "1.2", "1.02.0", "01.2.0", "1.2.0-rc1"):
                with self.subTest(version=version):
                    with self.assertRaises(ValueError):
                        module.build_release_archives(
                            REPOSITORY_ROOT, temp / "out", version, STABLE_EPOCH
                        )
            with self.assertRaises(FileNotFoundError):
                module.build_release_archives(temp / "empty", temp / "out", "1.2.0", STABLE_EPOCH)

    def test_untracked_files_in_recursive_allowlists_are_rejected_without_output(self) -> None:
        module = _load_builder(self)
        for untracked_name in (
            "web_demo/dist/untracked.js",
            "third_party/browser-runtime-licenses/untracked.txt",
        ):
            with self.subTest(path=untracked_name), tempfile.TemporaryDirectory() as temporary_directory:
                temporary_root = Path(temporary_directory)
                repository_root = temporary_root / "repository"
                _write_minimal_release_sources(repository_root)
                _commit_fixture_repository(repository_root)
                untracked = repository_root / untracked_name
                untracked.parent.mkdir(parents=True, exist_ok=True)
                untracked.write_bytes(b"untracked")
                output_dir = temporary_root / "output"

                with self.assertRaisesRegex(ValueError, r"(?i)untracked"):
                    module.build_release_archives(
                        repository_root, output_dir, "1.2.0", STABLE_EPOCH
                    )
                self.assertFalse(output_dir.exists())

    def test_modified_tracked_inputs_are_rejected_without_output(self) -> None:
        module = _load_builder(self)
        for modified_name in ("web_demo/dist/index.html", "LICENSE"):
            with self.subTest(path=modified_name), tempfile.TemporaryDirectory() as temporary_directory:
                temporary_root = Path(temporary_directory)
                repository_root = temporary_root / "repository"
                _write_minimal_release_sources(repository_root)
                _commit_fixture_repository(repository_root)
                (repository_root / modified_name).write_bytes(b"modified")
                output_dir = temporary_root / "output"

                with self.assertRaisesRegex(ValueError, r"(?i)(?:modified|HEAD)"):
                    module.build_release_archives(
                        repository_root, output_dir, "1.2.0", STABLE_EPOCH
                    )
                self.assertFalse(output_dir.exists())

    def test_windows_unsafe_member_components_and_normalized_collisions_are_rejected(self) -> None:
        module = _load_builder(self)
        for unsafe_name in (
            "CON",
            "con.txt",
            "PRN.json",
            "AUX",
            "NUL.bin",
            "CLOCK$",
            "COM1.txt",
            "com9",
            "COM\u00b9",
            "com\u00b2.txt",
            "LPT\u00b3.log",
            "LPT1.log",
            "lpt9",
            "file.",
            "file ",
            "x:y",
            "x<y",
            "x>y",
            'x"y',
            "x|y",
            "x?y",
            "x*y",
            "e\u0301.txt",
        ):
            with self.subTest(name=unsafe_name):
                with self.assertRaises(ValueError):
                    module._validate_relative_name(f"web_demo/dist/{unsafe_name}")

        for codepoint in range(1, 32):
            with self.subTest(control=codepoint):
                with self.assertRaises(ValueError):
                    module._validate_relative_name(
                        f"web_demo/dist/x{chr(codepoint)}y"
                    )

        for first_name, second_name in (
            ("a", "a."),
            ("caf\u00e9.txt", "cafe\u0301.txt"),
        ):
            with self.subTest(collision=(first_name, second_name)):
                with self.assertRaises(ValueError):
                    module._validated_entries(
                        "Release",
                        [
                            module._Entry(first_name, content=b"first"),
                            module._Entry(second_name, content=b"second"),
                        ],
                    )

    def test_symlinked_source_tree_is_rejected(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            fake_root = Path(temporary_directory)
            (fake_root / "web_demo").mkdir()
            _create_directory_link(
                self,
                REPOSITORY_ROOT / "web_demo" / "dist",
                fake_root / "web_demo" / "dist",
            )
            with self.assertRaisesRegex(ValueError, r"(?i)symlink"):
                module.build_release_archives(
                    fake_root, fake_root / "out", "1.2.0", STABLE_EPOCH
                )

    def test_linked_ancestor_of_required_file_is_rejected_by_builder_and_cli(self) -> None:
        module = _load_builder(self)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            fake_root = temporary_root / "repository"
            external_models = temporary_root / "external-models"
            external_models.mkdir(parents=True)
            for filename in ("baseline2_njr_fp32.onnx", "manifest.json"):
                (external_models / filename).write_bytes(b"external")

            _write_minimal_release_sources(fake_root)
            for filename in ("baseline2_njr_fp32.onnx", "manifest.json"):
                (fake_root / "web_demo" / "models" / filename).unlink()
            (fake_root / "web_demo" / "models").rmdir()
            _create_directory_link(
                self, external_models, fake_root / "web_demo" / "models"
            )

            with self.assertRaisesRegex(ValueError, r"(?i)(?:link|junction)"):
                module.build_release_archives(
                    fake_root,
                    temporary_root / "builder-output",
                    "1.2.0",
                    STABLE_EPOCH,
                )

            cli = subprocess.run(
                [
                    sys.executable,
                    str(BUILDER_PATH),
                    "--repository-root",
                    str(fake_root),
                    "--output-dir",
                    str(temporary_root / "cli-output"),
                    "--version",
                    "1.2.0",
                    "--source-date-epoch",
                    str(STABLE_EPOCH),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            self.assertNotEqual(0, cli.returncode)
            self.assertRegex(cli.stdout + cli.stderr, r"(?i)(?:link|junction)")


if __name__ == "__main__":
    unittest.main()
