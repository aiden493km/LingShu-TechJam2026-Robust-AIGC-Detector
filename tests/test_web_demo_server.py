import contextlib
import http.client
import io
import os
import subprocess
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from web_demo.tools import serve_demo as serve_demo_module
from web_demo.tools.serve_demo import (
    DemoRequestHandler,
    ExclusiveThreadingHTTPServer,
    bind_server,
    main,
    resolve_request_target,
    validate_runtime,
)


EXPECTED_SECURITY_HEADERS = {
    "cache-control": "no-store",
    "content-security-policy": (
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
        "style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; "
        "worker-src 'self' blob:; font-src 'self'; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    ),
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
}


def _write_demo_tree(root: Path) -> None:
    dist = root / "web_demo" / "dist"
    models = root / "web_demo" / "models"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    models.mkdir(parents=True)

    (dist / "index.html").write_bytes(b"<!doctype html><title>demo</title>\n")
    (dist / "route").write_bytes(b"extensionless files are not routes\n")
    (assets / "app.js").write_bytes(b"console.log('demo');\n")
    (assets / "module.mjs").write_bytes(b"export const demo = true;\n")
    (assets / "style.css").write_bytes(b"body { color: #123; }\n")
    (assets / "runtime.wasm").write_bytes(b"\x00asm\x01\x00\x00\x00")
    (assets / "data.json").write_bytes(b'{"ok":true}\n')
    (assets / "image.png").write_bytes(b"png")
    (assets / "image.jpg").write_bytes(b"jpg")
    (assets / "image.jpeg").write_bytes(b"jpeg")
    (assets / "image.webp").write_bytes(b"webp")
    (assets / "image.gif").write_bytes(b"gif")
    (assets / "image.svg").write_bytes(b"<svg></svg>\n")
    (assets / "image.ico").write_bytes(b"ico")
    (assets / "image.avif").write_bytes(b"avif")
    (models / "manifest.json").write_bytes(b'{"schema_version":1}\n')
    (models / "baseline2_njr_fp32.onnx").write_bytes(b"tiny onnx stand-in\n")


def _request(
    server: ExclusiveThreadingHTTPServer,
    method: str,
    target: str,
    body: bytes | None = None,
) -> tuple[int, dict[str, str], bytes]:
    host, port = server.server_address[:2]
    connection = http.client.HTTPConnection(host, port, timeout=5)
    headers = {"Content-Length": str(len(body))} if body is not None else {}
    try:
        connection.request(method, target, body=body, headers=headers)
        response = connection.getresponse()
        response_body = response.read()
        response_headers = {key.lower(): value for key, value in response.getheaders()}
        return response.status, response_headers, response_body
    finally:
        connection.close()


class LiveServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        _write_demo_tree(self.root)
        self.server = ExclusiveThreadingHTTPServer(
            ("127.0.0.1", 0),
            DemoRequestHandler,
            repository_root=self.root,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temporary_directory.cleanup()


class RequestRoutingTests(LiveServerTestCase):
    def test_routes_only_dist_and_exact_model_files(self):
        cases = {
            "/": b"<!doctype html><title>demo</title>\n",
            "/?judge=local": b"<!doctype html><title>demo</title>\n",
            "/index.html": b"<!doctype html><title>demo</title>\n",
            "/assets/app.js?build=verified": b"console.log('demo');\n",
            "/models/manifest.json?cache=bust": b'{"schema_version":1}\n',
            "/models/baseline2_njr_fp32.onnx": b"tiny onnx stand-in\n",
        }
        for target, expected_body in cases.items():
            with self.subTest(target=target):
                status, _, body = _request(self.server, "GET", target)
                self.assertEqual(status, 200)
                self.assertEqual(body, expected_body)

        rejected = (
            "/models/alternate.onnx",
            "/models/MANIFEST.JSON",
            "/models/nested/manifest.json",
            "/dist/index.html",
            "/INDEX.HTML",
            "/assets/APP.JS",
            "/assets/",
        )
        for target in rejected:
            with self.subTest(target=target):
                status, _, _ = _request(self.server, "GET", target)
                self.assertEqual(status, 404)

    def test_resolve_request_target_ignores_query_for_a_safe_route(self):
        expected = (self.root / "web_demo" / "dist" / "assets" / "app.js").resolve()
        self.assertEqual(
            resolve_request_target("/assets/app.js?version=one", self.root),
            expected,
        )

    def test_rejects_encoded_parent_traversal_and_duplicate_decoding(self):
        outside = self.root / "outside.js"
        outside.write_bytes(b"secret\n")
        disguised = self.root / "web_demo" / "dist" / "assets" / "%2e%2e"
        disguised.mkdir()
        (disguised / "outside.js").write_bytes(b"must not be served\n")

        targets = (
            "/../outside.js",
            "/%2e%2e/outside.js",
            "/assets/%2E%2E/outside.js",
            "/assets/%252e%252e/outside.js",
        )
        for target in targets:
            with self.subTest(target=target):
                status, _, _ = _request(self.server, "GET", target)
                self.assertEqual(status, 404)

    def test_rejects_malformed_or_ambiguous_paths(self):
        ambiguous_name = self.root / "web_demo" / "dist" / "assets" / "bad%2.js"
        ambiguous_name.write_bytes(b"must not be reached by duplicate decoding\n")
        targets = (
            "/assets/bad%2.js",
            "/assets/bad%GG.js",
            "/assets/bad%252.js",
            "/assets/%00app.js",
            "/assets\\app.js",
            "/assets/%5capp.js",
            "//example.invalid/assets/app.js",
            "/%2f%2fexample.invalid/assets/app.js",
            "/assets//app.js",
            "/assets/./app.js",
            "/assets/%2e/app.js",
            "/assets/app.js.",
            "/assets/app.js%20",
            "/C:/Windows/app.js",
        )
        for target in targets:
            with self.subTest(target=target):
                status, _, _ = _request(self.server, "GET", target)
                self.assertEqual(status, 404)

    def test_rejects_a_symlink_that_escapes_dist(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "secret.js").write_bytes(b"secret\n")
        link = self.root / "web_demo" / "dist" / "linked"
        try:
            link.symlink_to(outside, target_is_directory=True)
        except (NotImplementedError, OSError) as error:
            if os.name != "nt":
                self.skipTest(f"directory symlinks are unavailable: {error}")
            junction = subprocess.run(
                ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(outside)],
                check=False,
                capture_output=True,
                text=True,
            )
            if junction.returncode != 0:
                self.fail(
                    "could not create a Windows junction for the containment test: "
                    f"{junction.stdout}{junction.stderr}"
                )

        status, _, _ = _request(self.server, "GET", "/linked/secret.js")
        self.assertEqual(status, 404)

    def test_returns_404_for_non_root_extensionless_routes(self):
        for target in ("/route", "/assets", "/judge", "/nested/path"):
            with self.subTest(target=target):
                status, _, _ = _request(self.server, "GET", target)
                self.assertEqual(status, 404)

    def test_returns_404_for_missing_js_wasm_or_model(self):
        for target in (
            "/assets/missing.js",
            "/assets/missing.wasm",
            "/models/missing.onnx",
            "/models/baseline2_njr_fp32.onnx.js",
        ):
            with self.subTest(target=target):
                status, _, _ = _request(self.server, "GET", target)
                self.assertEqual(status, 404)


class ResponseBehaviorTests(LiveServerTestCase):
    def test_streams_onnx_with_octet_stream_mime(self):
        status, headers, body = _request(
            self.server,
            "GET",
            "/models/baseline2_njr_fp32.onnx",
        )

        self.assertEqual(status, 200)
        self.assertEqual(headers["content-type"], "application/octet-stream")
        self.assertEqual(body, b"tiny onnx stand-in\n")

    def test_mime_overrides_cover_local_runtime_and_images(self):
        expected = {
            "/index.html": "text/html; charset=utf-8",
            "/assets/style.css": "text/css; charset=utf-8",
            "/assets/app.js": "text/javascript; charset=utf-8",
            "/assets/module.mjs": "text/javascript; charset=utf-8",
            "/assets/data.json": "application/json; charset=utf-8",
            "/assets/runtime.wasm": "application/wasm",
            "/assets/image.png": "image/png",
            "/assets/image.jpg": "image/jpeg",
            "/assets/image.jpeg": "image/jpeg",
            "/assets/image.webp": "image/webp",
            "/assets/image.gif": "image/gif",
            "/assets/image.svg": "image/svg+xml",
            "/assets/image.ico": "image/x-icon",
            "/assets/image.avif": "image/avif",
        }
        for target, expected_mime in expected.items():
            with self.subTest(target=target):
                status, headers, _ = _request(self.server, "GET", target)
                self.assertEqual(status, 200)
                self.assertEqual(headers["content-type"], expected_mime)

    def test_sends_every_security_header_on_success_and_errors(self):
        responses = (
            _request(self.server, "GET", "/"),
            _request(self.server, "GET", "/missing.js"),
            _request(self.server, "POST", "/", body=b"ignored"),
        )
        self.assertEqual([response[0] for response in responses], [200, 404, 405])
        for status, headers, _ in responses:
            with self.subTest(status=status):
                for name, expected_value in EXPECTED_SECURITY_HEADERS.items():
                    self.assertEqual(headers.get(name), expected_value, name)

    def test_head_sends_metadata_without_a_body(self):
        status, headers, body = _request(self.server, "HEAD", "/assets/app.js")

        self.assertEqual(status, 200)
        self.assertEqual(headers["content-length"], str(len(b"console.log('demo');\n")))
        self.assertEqual(headers["content-type"], "text/javascript; charset=utf-8")
        self.assertEqual(body, b"")

    def test_non_get_or_head_returns_405_with_allow_header(self):
        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS", "BREW"):
            with self.subTest(method=method):
                status, headers, _ = _request(self.server, method, "/")
                self.assertEqual(status, 405)
                self.assertEqual(headers.get("allow"), "GET, HEAD")

    def test_streaming_copy_uses_a_bounded_chunk_size(self):
        content = bytes(range(256)) * 2048
        large_asset = self.root / "web_demo" / "dist" / "assets" / "large.bin"
        large_asset.write_bytes(content)
        lengths: list[int] = []
        original_copy = serve_demo_module.shutil.copyfileobj

        def recording_copy(source, destination, length=0):
            lengths.append(length)
            return original_copy(source, destination, length=length)

        with mock.patch.object(
            serve_demo_module.shutil,
            "copyfileobj",
            side_effect=recording_copy,
        ):
            status, _, body = _request(self.server, "GET", "/assets/large.bin")

        self.assertEqual(status, 200)
        self.assertEqual(body, content)
        self.assertEqual(len(lengths), 1)
        self.assertGreater(lengths[0], 0)
        self.assertLessEqual(lengths[0], 1024 * 1024)


class BindingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        _write_demo_tree(self.root)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    @unittest.skipUnless(os.name == "nt", "Windows exclusive-bind semantics")
    def test_exclusive_server_rejects_second_bind_on_windows(self):
        first = ExclusiveThreadingHTTPServer(
            ("127.0.0.1", 0),
            DemoRequestHandler,
            repository_root=self.root,
        )
        port = first.server_address[1]
        try:
            with self.assertRaises(OSError):
                ExclusiveThreadingHTTPServer(
                    ("127.0.0.1", port),
                    DemoRequestHandler,
                    repository_root=self.root,
                )
        finally:
            first.server_close()

    def test_port_selection_falls_forward_from_8765(self):
        holder = None
        try:
            holder = ExclusiveThreadingHTTPServer(
                ("127.0.0.1", 8765),
                DemoRequestHandler,
                repository_root=self.root,
            )
        except OSError:
            pass

        selected = None
        try:
            selected = bind_server(self.root)
            self.assertEqual(selected.server_address[0], "127.0.0.1")
            self.assertNotEqual(selected.server_address[1], 8765)
            self.assertGreater(selected.server_address[1], 0)
        finally:
            if selected is not None:
                selected.server_close()
            if holder is not None:
                holder.server_close()

    def test_exhausted_candidates_fall_back_to_one_real_ephemeral_server(self):
        holder = ExclusiveThreadingHTTPServer(
            ("127.0.0.1", 0),
            DemoRequestHandler,
            repository_root=self.root,
        )
        held_port = holder.server_address[1]
        selected = None
        try:
            with mock.patch.object(serve_demo_module, "DEFAULT_PORTS", (held_port,)):
                selected = bind_server(self.root)
            self.assertEqual(selected.server_address[0], "127.0.0.1")
            self.assertGreater(selected.server_address[1], 0)
            self.assertNotEqual(selected.server_address[1], held_port)
        finally:
            if selected is not None:
                selected.server_close()
            holder.server_close()

    def test_explicit_port_failure_is_clear_and_does_not_fall_forward(self):
        holder = ExclusiveThreadingHTTPServer(
            ("127.0.0.1", 0),
            DemoRequestHandler,
            repository_root=self.root,
        )
        held_port = holder.server_address[1]
        try:
            with self.assertRaisesRegex(RuntimeError, rf"127\.0\.0\.1:{held_port}"):
                bind_server(self.root, port=held_port)
        finally:
            holder.server_close()


class RuntimeAndCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_validate_runtime_calls_task2_verifier_and_reports_all_errors(self):
        with mock.patch.object(
            serve_demo_module,
            "verify_distribution",
            return_value=[],
        ) as verifier:
            validate_runtime(self.root)
        verifier.assert_called_once_with(self.root.resolve())

        errors = ["model hash mismatch", "dist/integrity.json is missing"]
        with mock.patch.object(
            serve_demo_module,
            "verify_distribution",
            return_value=errors,
        ):
            with self.assertRaisesRegex(RuntimeError, "model hash mismatch") as raised:
                validate_runtime(self.root)
        self.assertIn("dist/integrity.json is missing", str(raised.exception))

    def test_check_validates_and_exits_without_listening_or_opening_browser(self):
        stdout = io.StringIO()
        with (
            mock.patch.object(serve_demo_module, "validate_runtime") as validate,
            mock.patch.object(
                serve_demo_module,
                "bind_server",
                side_effect=AssertionError("--check must not bind"),
            ) as binder,
            mock.patch.object(serve_demo_module.webbrowser, "open") as browser_open,
            contextlib.redirect_stdout(stdout),
        ):
            result = main(["--check"], repository_root=self.root)

        self.assertEqual(result, 0)
        validate.assert_called_once_with(self.root.resolve())
        binder.assert_not_called()
        browser_open.assert_not_called()
        self.assertIn("Distribution verification passed.", stdout.getvalue())

    def test_check_returns_nonzero_with_actionable_validation_errors(self):
        stderr = io.StringIO()
        with (
            mock.patch.object(
                serve_demo_module,
                "validate_runtime",
                side_effect=RuntimeError("Distribution verification failed:\n- missing model"),
            ),
            mock.patch.object(serve_demo_module, "bind_server") as binder,
            contextlib.redirect_stderr(stderr),
        ):
            result = main(["--check"], repository_root=self.root)

        self.assertEqual(result, 1)
        binder.assert_not_called()
        self.assertIn("missing model", stderr.getvalue())

    def test_normal_mode_prints_ready_then_serves_foreground_and_closes(self):
        events: list[str] = []

        class FakeServer:
            server_address = ("127.0.0.1", 43210)

            def serve_forever(self):
                events.append("serve")
                raise KeyboardInterrupt

            def server_close(self):
                events.append("close")

        fake_server = FakeServer()

        def record_validation(root):
            self.assertEqual(root, self.root.resolve())
            events.append("validate")

        def record_bind(root, *, port=None):
            self.assertEqual(root, self.root.resolve())
            self.assertEqual(port, 43210)
            events.append("bind")
            return fake_server

        def record_open(url):
            self.assertEqual(url, "http://127.0.0.1:43210/")
            events.append("browser")
            return True

        with (
            mock.patch.object(
                serve_demo_module,
                "validate_runtime",
                side_effect=record_validation,
            ),
            mock.patch.object(serve_demo_module, "bind_server", side_effect=record_bind),
            mock.patch.object(
                serve_demo_module.webbrowser,
                "open",
                side_effect=record_open,
            ),
            mock.patch("builtins.print") as print_mock,
        ):
            result = main(["--port", "43210"], repository_root=self.root)

        self.assertEqual(result, 0)
        self.assertEqual(events, ["validate", "bind", "browser", "serve", "close"])
        print_mock.assert_any_call("READY http://127.0.0.1:43210/", flush=True)

    def test_no_browser_mode_never_opens_a_browser(self):
        class FakeServer:
            server_address = ("127.0.0.1", 45678)

            def serve_forever(self):
                raise KeyboardInterrupt

            def server_close(self):
                pass

        with (
            mock.patch.object(serve_demo_module, "validate_runtime"),
            mock.patch.object(serve_demo_module, "bind_server", return_value=FakeServer()),
            mock.patch.object(serve_demo_module.webbrowser, "open") as browser_open,
            mock.patch("builtins.print"),
        ):
            result = main(["--no-browser"], repository_root=self.root)

        self.assertEqual(result, 0)
        browser_open.assert_not_called()


if __name__ == "__main__":
    unittest.main()
