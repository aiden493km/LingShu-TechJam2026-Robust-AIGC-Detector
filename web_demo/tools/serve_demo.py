"""Serve the verified WebDemo from an exclusive loopback-only HTTP server."""

from __future__ import annotations

import argparse
import mimetypes
import os
import re
import shutil
import socket
import sys
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Sequence
from urllib.parse import unquote_to_bytes, urlsplit

if __package__:
    from .verify_distribution import verify_distribution
else:
    from verify_distribution import verify_distribution


DEFAULT_PORTS = tuple(range(8765, 8785))
STREAM_CHUNK_BYTES = 64 * 1024
INVALID_PERCENT_ESCAPE = re.compile(r"%(?![0-9A-Fa-f]{2})")

SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
        "style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; "
        "worker-src 'self' blob:; font-src 'self'; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    ),
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}

MIME_OVERRIDES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".onnx": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
}

MODEL_ROUTES = {
    "/models/manifest.json": "manifest.json",
    "/models/baseline2_njr_fp32.onnx": "baseline2_njr_fp32.onnx",
}


def _decode_request_path(request_target: str) -> str | None:
    """Decode only the URL path, rejecting ambiguous or malformed encodings."""

    try:
        parsed = urlsplit(request_target)
    except ValueError:
        return None
    if parsed.scheme or parsed.netloc:
        return None

    raw_path = parsed.path
    if not raw_path.startswith("/") or raw_path.startswith("//"):
        return None
    if INVALID_PERCENT_ESCAPE.search(raw_path):
        return None

    try:
        decoded_path = unquote_to_bytes(raw_path).decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return None

    if "%" in decoded_path:
        return None
    if "\x00" in decoded_path or "\\" in decoded_path:
        return None
    if not decoded_path.startswith("/") or decoded_path.startswith("//"):
        return None
    return decoded_path


def _resolved_container(repository_root: Path, relative_path: str) -> Path | None:
    resolved_root = repository_root.resolve()
    try:
        resolved_container = (resolved_root / relative_path).resolve()
        resolved_container.relative_to(resolved_root)
    except (OSError, RuntimeError, ValueError):
        return None
    return resolved_container


def _contained_file(container: Path, components: tuple[str, ...]) -> Path | None:
    candidate = container
    for component in components:
        try:
            exact_entry = next(
                (entry for entry in candidate.iterdir() if entry.name == component),
                None,
            )
            if exact_entry is None:
                return None
            candidate = exact_entry.resolve()
            candidate.relative_to(container)
        except (OSError, RuntimeError, ValueError):
            return None
    if not candidate.is_file():
        return None
    return candidate


def resolve_request_target(request_target: str, repository_root: Path) -> Path | None:
    """Resolve one safe explicit route, or return ``None`` for a 404 response."""

    decoded_path = _decode_request_path(request_target)
    if decoded_path is None:
        return None

    root = Path(repository_root).resolve()
    if decoded_path == "/":
        dist = _resolved_container(root, "web_demo/dist")
        return None if dist is None else _contained_file(dist, ("index.html",))

    components = tuple(decoded_path[1:].split("/"))
    if any(component in {"", ".", ".."} for component in components):
        return None
    if any(":" in component for component in components):
        return None

    model_file = MODEL_ROUTES.get(decoded_path)
    if model_file is not None:
        models = _resolved_container(root, "web_demo/models")
        return None if models is None else _contained_file(models, (model_file,))
    if components[0] == "models":
        return None

    if not PurePosixPath(components[-1]).suffix:
        return None
    dist = _resolved_container(root, "web_demo/dist")
    return None if dist is None else _contained_file(dist, components)


class DemoRequestHandler(BaseHTTPRequestHandler):
    """Static handler restricted to verified dist files and two model routes."""

    protocol_version = "HTTP/1.1"
    server_version = "LingShuLoopback/1"

    def __getattr__(self, name: str):
        if name.startswith("do_"):
            return self._method_not_allowed
        raise AttributeError(name)

    def end_headers(self) -> None:
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()

    def do_GET(self) -> None:
        self._serve(send_body=True)

    def do_HEAD(self) -> None:
        self._serve(send_body=False)

    def _serve(self, *, send_body: bool) -> None:
        repository_root = Path(self.server.repository_root)
        target = resolve_request_target(self.path, repository_root)
        if target is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            source = target.open("rb")
            byte_count = os.fstat(source.fileno()).st_size
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        with source:
            suffix = target.suffix.lower()
            content_type = MIME_OVERRIDES.get(suffix)
            if content_type is None:
                content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(byte_count))
            self.end_headers()
            if send_body:
                try:
                    shutil.copyfileobj(source, self.wfile, length=STREAM_CHUNK_BYTES)
                except (BrokenPipeError, ConnectionResetError):
                    return

    def _method_not_allowed(self) -> None:
        body = b"Method Not Allowed\n"
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
        self.send_header("Allow", "GET, HEAD")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def log_message(self, format: str, *args: object) -> None:
        return


class ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    """Threaded HTTP server that never opts into address reuse."""

    allow_reuse_address = False
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        request_handler_class: type[BaseHTTPRequestHandler] = DemoRequestHandler,
        bind_and_activate: bool = True,
        *,
        repository_root: Path | None = None,
    ) -> None:
        self.repository_root = (
            Path(__file__).resolve().parents[2]
            if repository_root is None
            else Path(repository_root).resolve()
        )
        super().__init__(server_address, request_handler_class, bind_and_activate)

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def _new_server(repository_root: Path, port: int) -> ExclusiveThreadingHTTPServer:
    return ExclusiveThreadingHTTPServer(
        ("127.0.0.1", port),
        DemoRequestHandler,
        repository_root=repository_root,
    )


def bind_server(
    repository_root: Path,
    port: int | None = None,
) -> ExclusiveThreadingHTTPServer:
    """Bind a real exclusive loopback server without a probe-and-rebind race."""

    root = Path(repository_root).resolve()
    if port is not None:
        if type(port) is not int or not 0 <= port <= 65535:
            raise ValueError("port must be an integer from 0 through 65535")
        try:
            return _new_server(root, port)
        except OSError as error:
            raise RuntimeError(
                f"Could not bind loopback demo server to 127.0.0.1:{port}: {error}"
            ) from error

    for candidate_port in DEFAULT_PORTS:
        try:
            return _new_server(root, candidate_port)
        except OSError:
            continue

    try:
        return _new_server(root, 0)
    except OSError as error:
        raise RuntimeError(
            f"Could not bind loopback demo server to an available port: {error}"
        ) from error


def validate_runtime(repository_root: Path) -> None:
    """Raise with every Task 2 verification error before the server starts."""

    root = Path(repository_root).resolve()
    errors = verify_distribution(root)
    if errors:
        details = "\n".join(f"- {error}" for error in errors)
        raise RuntimeError(f"Distribution verification failed:\n{details}")


def _port_argument(value: str) -> int:
    try:
        port = int(value, 10)
    except ValueError as error:
        raise argparse.ArgumentTypeError("port must be an integer") from error
    if not 0 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be from 0 through 65535")
    return port


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="serve in the foreground without opening the default browser",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate the model and static distribution, then exit",
    )
    parser.add_argument(
        "--port",
        type=_port_argument,
        help="bind only this explicit loopback port",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    repository_root: Path | None = None,
) -> int:
    """Validate, bind, announce readiness, and serve until interrupted."""

    arguments = _argument_parser().parse_args(argv)
    root = (
        Path(__file__).resolve().parents[2]
        if repository_root is None
        else Path(repository_root).resolve()
    )

    try:
        validate_runtime(root)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1

    if arguments.check:
        print("Distribution verification passed.")
        return 0

    try:
        server = bind_server(root, port=arguments.port)
    except (RuntimeError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1

    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/"
    try:
        print(f"READY {url}", flush=True)
        if not arguments.no_browser:
            try:
                webbrowser.open(url)
            except Exception as error:
                print(f"Could not open the browser automatically: {error}", file=sys.stderr)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
