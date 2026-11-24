#!/usr/bin/python3
"""Local native messaging worker. All protocol messages are JSON, never logs."""
import base64
import binascii
import contextlib
import ctypes
import hashlib
import hmac
import http.client
import http.server
import ipaddress
import fcntl
import json
import math
import os
import pathlib
import re
import select
import secrets
import shutil
import signal
import socket
import socketserver
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

HOST = "com.media_collector.processor"
MAX_MESSAGE = 1024 * 1024
MAX_PARTS = 100000
MAX_BYTES = 50 * 1024 * 1024 * 1024
WRITE_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()
active = None
page_analyses = {}


def send(event):
    data = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with WRITE_LOCK:
        sys.stdout.buffer.write(struct.pack("=I", len(data)) + data)
        sys.stdout.buffer.flush()


def read_message():
    header = sys.stdin.buffer.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError("Cabeçalho de mensagem incompleto.")
    length, = struct.unpack("=I", header)
    if not 0 < length <= MAX_MESSAGE:
        raise ValueError("Mensagem inválida ou grande demais.")
    data = sys.stdin.buffer.read(length)
    if len(data) != length:
        raise ValueError("Mensagem incompleta.")
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError("Mensagem inválida.")
    return result


def public_addresses(host, port):
    """Resolve once, reject non-public answers, and return addresses to pin."""
    if not isinstance(host, str) or not host or "%" in host or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("Destino de rede inválido.")
    host = host.rstrip(".")
    try:
        literal = ipaddress.ip_address(host)
        addresses = [(socket.AF_INET6 if literal.version == 6 else socket.AF_INET,
                      socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (str(literal), port, 0, 0)
                      if literal.version == 6 else (str(literal), port))]
    except ValueError:
        try:
            ascii_host = host.encode("idna").decode("ascii")
            addresses = socket.getaddrinfo(ascii_host, port, type=socket.SOCK_STREAM)
        except (UnicodeError, OSError):
            raise ValueError("O destino não pôde ser validado como endereço público.") from None
    if not addresses:
        raise ValueError("O destino não pôde ser validado como endereço público.")
    # Reject mixed public/private DNS answers too; otherwise DNS rotation could
    # select an internal address after a preflight check.
    try:
        for family, _, _, _, sockaddr in addresses:
            address = ipaddress.ip_address(sockaddr[0])
            translated_ipv6 = address.version == 6 and (
                address.ipv4_mapped is not None or address.sixtofour is not None or address.teredo is not None or
                address in ipaddress.ip_network("64:ff9b::/96") or address in ipaddress.ip_network("64:ff9b:1::/48")
            )
            if not address.is_global or address.is_multicast or address.is_unspecified or translated_ipv6:
                raise ValueError("Acesso a endereços locais ou privados não é permitido.")
            if family not in (socket.AF_INET, socket.AF_INET6):
                raise ValueError("Família de rede não permitida.")
    except (IndexError, TypeError, ValueError) as error:
        if isinstance(error, ValueError) and str(error).startswith("Acesso a endereços"):
            raise
        raise ValueError("O destino não pôde ser validado como endereço público.") from None
    return addresses


def connect_public(host, port, timeout=30):
    """Connect to one of the already validated IPs, without a second DNS lookup."""
    failures = []
    for family, socktype, proto, _, sockaddr in public_addresses(host, port):
        connection = socket.socket(family, socktype, proto)
        connection.settimeout(timeout)
        try:
            connection.connect(sockaddr)
            return connection
        except OSError as error:
            failures.append(error)
            connection.close()
    raise ValueError("Não foi possível conectar ao endereço público.") from (failures[-1] if failures else None)


def validate_public_http_url(value):
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError("Endereço de mídia inválido.")
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Endereço de mídia inválido.")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        public_addresses(parsed.hostname, port)
    except ValueError as error:
        if str(error).startswith(("Acesso a endereços", "O destino", "Família de rede")):
            raise
        raise ValueError("Endereço de mídia inválido.") from None
    return value


class PublicHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        if self._tunnel_host:
            raise ValueError("Túneis HTTP locais não são permitidos.")
        self.sock = connect_public(self.host, self.port, self.timeout)


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        if self._tunnel_host:
            raise ValueError("Túneis HTTPS locais não são permitidos.")
        connection = connect_public(self.host, self.port, self.timeout)
        try:
            self.sock = self._context.wrap_socket(connection, server_hostname=self.host)
        except Exception:
            connection.close()
            raise


class PublicHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, request):
        return self.do_open(PublicHTTPConnection, request)


class PublicHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, request):
        return self.do_open(PublicHTTPSConnection, request, context=self._context)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_public_http_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), PublicHTTPHandler(), PublicHTTPSHandler(), SafeRedirect())


class PublicProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    MAX_REQUEST_BODY = 16 * 1024 * 1024

    def log_message(self, *_args):
        # Native Messaging stdout is protocol data; never log requested URLs.
        return

    def _deny_destination(self):
        self.server.denied_requests += 1
        self.send_error(403, "Destino de rede não permitido")

    def _authorized(self):
        token = self.server.proxy_token
        expected = "Basic " + base64.b64encode(f"{token}:{token}".encode()).decode("ascii")
        if hmac.compare_digest(self.headers.get("Proxy-Authorization", ""), expected):
            return True
        self.send_response(407)
        self.send_header("Proxy-Authenticate", 'Basic realm="Media Collector local proxy"')
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        return False

    def _authority(self, target):
        if target.startswith("["):
            end = target.find("]")
            if end < 0 or target[end + 1:end + 2] != ":":
                raise ValueError("Destino de proxy inválido.")
            host, port_text = target[1:end], target[end + 2:]
        else:
            host, separator, port_text = target.rpartition(":")
            if not separator:
                raise ValueError("Destino de proxy inválido.")
        if not port_text.isdecimal():
            raise ValueError("Destino de proxy inválido.")
        port = int(port_text)
        public_addresses(host, port)
        return host, port

    def do_CONNECT(self):
        if not self._authorized():
            return
        upstream = None
        established = False
        try:
            host, port = self._authority(self.path)
            upstream = connect_public(host, port, timeout=30)
            self.send_response(200, "Connection Established")
            self.end_headers()
            established = True
            self.close_connection = True
            self._tunnel(upstream)
        except (OSError, ValueError):
            if upstream:
                upstream.close()
            if not established:
                self._deny_destination()

    def _tunnel(self, upstream):
        peers = (self.connection, upstream)
        try:
            while True:
                readable, _, exceptional = select.select(peers, (), peers, 60)
                if exceptional or not readable:
                    return
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    target = upstream if source is self.connection else self.connection
                    target.sendall(data)
        except OSError:
            return
        finally:
            upstream.close()

    def _copy_exact(self, source, target, size):
        copied = 0
        while copied < size:
            chunk = source.read(min(65536, size - copied))
            if not chunk:
                raise ValueError("Corpo de solicitação incompleto.")
            target.sendall(chunk)
            copied += len(chunk)

    def _copy_chunked_request(self, upstream):
        total = 0
        while True:
            line = self.rfile.readline(8193)
            if not line or len(line) > 8192:
                raise ValueError("Solicitação chunked inválida.")
            upstream.sendall(line)
            size_text = line.split(b";", 1)[0].strip()
            try:
                size = int(size_text, 16)
            except ValueError:
                raise ValueError("Solicitação chunked inválida.") from None
            if size < 0 or total + size > self.MAX_REQUEST_BODY:
                raise ValueError("Corpo de solicitação excede o limite.")
            if size == 0:
                while True:
                    trailer = self.rfile.readline(8193)
                    if not trailer or len(trailer) > 8192:
                        raise ValueError("Trailer de solicitação inválido.")
                    upstream.sendall(trailer)
                    if trailer in (b"\r\n", b"\n"):
                        return
            self._copy_exact(self.rfile, upstream, size + 2)
            total += size

    def _forward_http(self):
        if not self._authorized():
            return
        upstream = None
        try:
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.scheme != "http" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Somente destinos HTTP(S) públicos são permitidos.")
            port = parsed.port or 80
            upstream = connect_public(parsed.hostname, port, timeout=30)
            path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
            transfer_encoding = self.headers.get("Transfer-Encoding", "").strip().lower()
            content_length = self.headers.get("Content-Length")
            if transfer_encoding and content_length:
                raise ValueError("Cabeçalhos de solicitação inconsistentes.")
            if transfer_encoding not in ("", "chunked"):
                raise ValueError("Codificação de solicitação não suportada.")
            if content_length:
                if not content_length.isdecimal() or int(content_length) > self.MAX_REQUEST_BODY:
                    raise ValueError("Corpo de solicitação excede o limite.")
            if self.headers.get("Expect", "").lower() == "100-continue":
                self.connection.sendall(b"HTTP/1.1 100 Continue\r\n\r\n")
            upstream.sendall(f"{self.command} {path} HTTP/1.1\r\n".encode("ascii"))
            for key, value in self.headers.items():
                if key.lower() not in {"proxy-authorization", "proxy-connection", "connection", "keep-alive", "expect"}:
                    upstream.sendall(f"{key}: {value}\r\n".encode("latin-1"))
            upstream.sendall(b"Connection: close\r\n\r\n")
            if transfer_encoding == "chunked":
                self._copy_chunked_request(upstream)
            elif content_length:
                self._copy_exact(self.rfile, upstream, int(content_length))
            self.close_connection = True
            while True:
                data = upstream.recv(65536)
                if not data:
                    break
                self.connection.sendall(data)
        except (OSError, UnicodeError, ValueError):
            if not self.wfile.closed:
                self._deny_destination()
        finally:
            if upstream:
                upstream.close()

    do_GET = _forward_http
    do_HEAD = _forward_http
    do_POST = _forward_http
    do_PUT = _forward_http
    do_PATCH = _forward_http
    do_DELETE = _forward_http
    do_OPTIONS = _forward_http


class PublicOnlyProxy:
    """Per-job loopback proxy that allows only pinned, globally routable IPs."""
    def __init__(self):
        handler = PublicProxyHandler
        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler, bind_and_activate=True)
        self.server.daemon_threads = True
        self.server.block_on_close = False
        self.server.proxy_token = secrets.token_urlsafe(32)
        self.server.denied_requests = 0
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        host, port = self.server.server_address
        return f"http://{self.server.proxy_token}:{self.server.proxy_token}@{host}:{port}"

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def binary(name):
    for candidate in (f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}", f"/usr/bin/{name}"):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    found = shutil.which(name)
    if found or name != "yt-dlp":
        return found
    for directory in (".local/bin", ".pyenv/shims"):
        candidate = pathlib.Path.home() / directory / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def checkpoint(job):
    while not job["resume"].wait(.2):
        if job["cancel"].is_set():
            raise InterruptedError("Cancelado.")
    if job["cancel"].is_set():
        raise InterruptedError("Cancelado.")


def probe(ffprobe, file):
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
         "-of", "json", str(file)], capture_output=True, text=True, timeout=90, check=True,
    )
    info = json.loads(result.stdout)
    return info


def ffmpeg_run(job, ffmpeg, args, duration, phase):
    checkpoint(job)
    process = subprocess.Popen(
        [ffmpeg, "-nostdin", "-v", "error", *args, "-progress", "pipe:1", "-nostats"],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    with STATE_LOCK:
        job["process"] = process
        if not job["resume"].is_set():
            os.kill(process.pid, signal.SIGSTOP)
        if job["cancel"].is_set():
            os.kill(process.pid, signal.SIGCONT)
            process.terminate()
    try:
        for line in process.stdout:
            if line.startswith("out_time_us="):
                try:
                    seconds = int(line.split("=", 1)[1]) / 1000000
                    send({"id": job["id"], "event": "progress", "phase": phase,
                          "completed": seconds, "total": duration or 0, "unit": "seconds"})
                except ValueError:
                    pass
        result = process.wait()
    finally:
        with STATE_LOCK:
            job["process"] = None
    checkpoint(job)
    if result:
        raise ValueError("Falha ao processar ou validar as faixas de mídia.")


def download(job, part, file, totals, seen_resources):
    url = validate_public_http_url(part.get("url"))
    parsed = urllib.parse.urlsplit(url or "")
    headers = {"Accept-Encoding": "identity"}
    range_ = part.get("range")
    if range_ is not None:
        if not isinstance(range_, dict):
            raise ValueError("Intervalo de mídia inválido.")
        offset, length = range_.get("offset", 0), range_.get("length")
        if not isinstance(offset, int) or not isinstance(length, int) or offset < 0 or length <= 0:
            raise ValueError("Intervalo de mídia inválido.")
        headers["Range"] = f"bytes={offset}-{offset+length-1}"
    request = urllib.request.Request(url, headers=headers)
    with OPENER.open(request, timeout=30) as response:
        code = response.status
        if (range_ is None and code != 200) or (range_ is not None and code != 206):
            raise ValueError(f"Resposta parcial ou inválida da origem ({code}).")
        if range_ is not None:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""), re.I)
            if not match or int(match[1]) != offset or int(match[2]) != offset + length - 1 or int(match[3]) <= int(match[2]):
                raise ValueError("Intervalo de mídia inconsistente.")
            info = (int(match[3]), response.headers.get("ETag"), response.headers.get("Last-Modified"))
            previous = seen_resources.get(url)
            if previous and (previous[0] != info[0] or any(a and b and a != b for a, b in zip(previous[1:], info[1:]))):
                raise ValueError("A origem mudou entre intervalos.")
            seen_resources[url] = (info[0], info[1] or (previous and previous[1]), info[2] or (previous and previous[2]))
        declared = response.headers.get("Content-Length")
        declared = int(declared) if declared and declared.isdecimal() else None
        written = 0
        while True:
            checkpoint(job)
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            file.write(chunk)
            written += len(chunk)
            totals["bytes"] += len(chunk)
            if totals["bytes"] > MAX_BYTES:
                raise ValueError("Mídia excede o limite local de 50 GB.")
        if (declared is not None and declared != written) or (range_ and written != length) or written == 0:
            raise ValueError("Arquivo ou intervalo incompleto.")


def unique_publish(source, directory, name):
    directory.mkdir(parents=True, exist_ok=True)
    stem, suffix = pathlib.Path(name).stem, pathlib.Path(name).suffix
    for number in range(10000):
        target = directory / (f"{stem} ({number}){suffix}" if number else name)
        try:
            exclusive_move(source, target)
            return target
        except FileExistsError:
            continue
    raise ValueError("Não foi possível criar um nome único.")


def exclusive_move(source, target):
    """Publish atomically without replacing an existing name on macOS."""
    if sys.platform != "darwin":
        os.link(source, target)
        return
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renamex_np
    rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(os.fsencode(source), os.fsencode(target), 0x00000004) != 0:  # RENAME_EXCL
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(target))


def publish_stream(transfer):
    """Journal the candidate and inode before a no-overwrite atomic move."""
    source, folder = transfer["path"], transfer["folder"]
    stem, suffix = pathlib.Path(transfer["filename"]).stem, pathlib.Path(transfer["filename"]).suffix
    info = os.fstat(transfer["file"].fileno())
    for number in range(10000):
        target = folder / (f"{stem} ({number}){suffix}" if number else transfer["filename"])
        with local_state("stream-" + transfer["id"]) as (state, journal):
            state.update(candidate=str(target), source_stat=[info.st_dev, info.st_ino, info.st_size])
            persist(journal, state)
        try:
            exclusive_move(source, target)
            return target
        except FileExistsError:
            continue
    raise ValueError("Não foi possível criar um nome único.")



STAGING_FOLDER = "Media Collector Temporarios"
CATEGORIES = {"Instagram", "X.com", "Reddit", "Web geral"}
EXTENSION = r"mp4|webm|m4v|mov|ogv|mkv|mp3|m4a|aac|opus|ogg|wav|flac|jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff|jxl"


class InvalidMedia(ValueError):
    pass


def state_directory():
    return pathlib.Path.home() / "Library" / "Application Support" / "Media Collector"


def default_destination():
    return pathlib.Path.home() / "Documents" / "Media Collector" / "Mídias"


def downloads_destination():
    folder = pathlib.Path.home() / "Downloads"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    folder = folder.resolve(strict=True)
    if not folder.is_dir() or not os.access(folder, os.W_OK | os.X_OK):
        raise ValueError("A pasta Downloads não permite gravação.")
    with local_state("destinations") as (state, target):
        folders = state.setdefault("folders", {})
        token = next((key for key, value in folders.items() if value == str(folder)), None)
        if token is None:
            token = str(uuid.uuid4())
            folders[token] = str(folder)
            persist(target, state)
    return {"destination": token, "folder": str(folder)}


def validate_filename(name):
    if not isinstance(name, str) or not re.fullmatch(rf"[A-Za-z0-9][A-Za-z0-9_. ()-]{{0,99}}\.(?:{EXTENSION})", name, re.I):
        raise InvalidMedia("Nome de arquivo inválido.")
    return name


def task_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", value):
        raise InvalidMedia("Identificador de transferência inválido.")
    return value


@contextlib.contextmanager
def local_state(name):
    directory = state_directory()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = directory / (name + ".json")
    with (directory / (name + ".lock")).open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            data = json.loads(target.read_text(encoding="utf-8"))
        except FileNotFoundError:
            data = {}
        yield data, target


def persist(target, data):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as work:
        temp = pathlib.Path(work.name)
        try:
            json.dump(data, work, ensure_ascii=False)
            work.flush()
            os.fsync(work.fileno())
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)


def destination_folder(token, category):
    if category not in CATEGORIES:
        raise InvalidMedia("Origem da mídia inválida.")
    if token in ("documents", None):
        root = default_destination()
    else:
        task_id(token)
        with local_state("destinations") as (state, _):
            root = state.get("folders", {}).get(token)
        if not root:
            raise ValueError("A pasta escolhida não está mais autorizada.")
        root = pathlib.Path(root)
        if not root.is_dir():
            raise ValueError("A pasta escolhida está indisponível.")
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve(strict=True)
    folder = root / category
    folder.mkdir(exist_ok=True)
    if folder.resolve(strict=True) != folder:
        raise ValueError("A subpasta de origem aponta para fora do destino.")
    return folder


def get_destination():
    with local_state("destinations") as (state, _):
        token = state.get("current", "documents")
        folder = state.get("folders", {}).get(token, str(default_destination()))
    return {"destination": token, "folder": folder}


def choose_destination(remember):
    # O texto do diálogo é fixo. Nenhum conteúdo da página entra no AppleScript.
    result = subprocess.run(
        ["/usr/bin/osascript", "-e", 'POSIX path of (choose folder with prompt "Escolha a pasta do Media Collector")'],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode:
        if "(-128)" in result.stderr:
            raise InterruptedError("Escolha de pasta cancelada.")
        raise ValueError("Não foi possível abrir o seletor de pastas do macOS.")
    folder = pathlib.Path(result.stdout.rstrip("\r\n")).resolve(strict=True)
    if not folder.is_dir() or not os.access(folder, os.W_OK | os.X_OK):
        raise ValueError("A pasta escolhida não permite gravação.")
    token = str(uuid.uuid4())
    with local_state("destinations") as (state, target):
        state.setdefault("folders", {})[token] = str(folder)
        if remember:
            state["current"] = token
        persist(target, state)
    return {"destination": token, "folder": str(folder)}


def staging_source(path, id_):
    if not isinstance(path, str) or not path or "\0" in path:
        raise InvalidMedia("Arquivo temporário inválido.")
    candidate = pathlib.Path(path)
    if not candidate.is_absolute() or ".." in candidate.parts:
        raise InvalidMedia("Caminho temporário inválido.")
    validate_filename(candidate.name)
    if candidate.parent.name != id_ or candidate.parent.parent.name != STAGING_FOLDER:
        raise InvalidMedia("O arquivo não pertence à área temporária desta transferência.")
    physical = candidate.resolve(strict=True)
    if physical.parts[-3:] != candidate.parts[-3:] or candidate.parent.parent.is_symlink() or candidate.parent.is_symlink() or candidate.is_symlink():
        raise InvalidMedia("O caminho temporário foi redirecionado.")
    if not stat.S_ISREG(physical.stat().st_mode):
        raise InvalidMedia("O arquivo temporário não é um arquivo regular.")
    return physical


def verify_mp4(file, size):
    required = {b"moov", b"mdat"}
    offset = 0
    brand = False
    while offset < size:
        file.seek(offset)
        header = file.read(8)
        if len(header) != 8:
            raise InvalidMedia("Arquivo MP4 incompleto.")
        length, kind = struct.unpack(">I4s", header)
        header_size = 8
        if length == 1:
            extended = file.read(8)
            if len(extended) != 8:
                raise InvalidMedia("Arquivo MP4 incompleto.")
            length, = struct.unpack(">Q", extended)
            header_size = 16
        elif length == 0:
            length = size - offset
        if length < header_size or length > size - offset:
            raise InvalidMedia("O servidor entregou um arquivo MP4 incompleto.")
        if kind == b"ftyp" and length >= header_size + 8:
            brand = True
        if length > header_size:
            required.discard(kind)
        offset += length
    if required or not brand:
        raise InvalidMedia("O arquivo recebido não é um MP4 completo.")


def verify_staged(file, source, payload, filename):
    size = os.fstat(file.fileno()).st_size
    expected_bytes = payload.get("expectedBytes")
    if size <= 0 or size > MAX_BYTES or (type(expected_bytes) is int and expected_bytes > 0 and size != expected_bytes):
        raise InvalidMedia("O tamanho do arquivo recebido é inválido ou incompleto.")
    suffix = pathlib.Path(filename).suffix.lower()
    file.seek(0)
    header = file.read(512)
    text_start = header.removeprefix(b"\xef\xbb\xbf").lstrip().lower()
    if text_start.startswith((b"<!doctype html", b"<html", b"<head", b"<body")):
        raise InvalidMedia("O servidor entregou uma página HTML no lugar da mídia.")
    if suffix in (".mp4", ".m4v", ".m4a"):
        verify_mp4(file, size)
    elif suffix == ".gif":
        file.seek(-1, os.SEEK_END)
        if not header.startswith((b"GIF87a", b"GIF89a")) or file.read() != b";":
            raise InvalidMedia("O GIF recebido é inválido ou incompleto.")
    elif payload.get("kind") == "image":
        file.seek(0)
        header = file.read(512)
        valid = {
            ".jpg": header.startswith(b"\xff\xd8\xff"),
            ".jpeg": header.startswith(b"\xff\xd8\xff"),
            ".png": header.startswith(b"\x89PNG\r\n\x1a\n"),
            ".webp": len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP",
            ".bmp": header.startswith(b"BM"),
            ".ico": header.startswith(b"\x00\x00\x01\x00"),
            ".tiff": header.startswith((b"II*\x00", b"MM\x00*")),
            ".avif": header.startswith(b"\x00\x00") and b"ftyp" in header[:16] and any(brand in header[:64] for brand in (b"avif", b"avis")),
            ".jxl": header.startswith(b"\xff\x0a") or (b"ftyp" in header[:16] and b"jxl " in header[:64]),
            ".svg": b"<svg" in header.lower(),
        }.get(suffix)
        if valid is False or valid is None:
            raise InvalidMedia("O conteúdo recebido não corresponde ao formato da imagem.")
    ffprobe = binary("ffprobe")
    kind = payload.get("kind")
    if kind in ("audio", "video") and not ffprobe and (payload.get("expectedAudio") is True or payload.get("expectedDuration")):
        raise InvalidMedia("Instale ffprobe para verificar a duração e as faixas deste arquivo.")
    if not ffprobe or kind not in ("audio", "video"):
        return
    result = subprocess.run(
        [ffprobe, "-v", "error", "-count_packets", "-show_entries",
         "format=duration:stream=codec_type,nb_read_packets", "-of", "json", str(source)],
        capture_output=True, text=True, timeout=180,
    )
    if result.returncode or result.stderr.strip():
        raise InvalidMedia("O arquivo recebido contém faixas incompletas ou ilegíveis.")
    info = json.loads(result.stdout)
    streams = [s for s in info.get("streams", []) if str(s.get("nb_read_packets", "")).isdecimal() and int(s["nb_read_packets"]) > 0]
    types = {s.get("codec_type") for s in streams}
    if kind not in types or (payload.get("expectedAudio") is True and "audio" not in types):
        raise InvalidMedia("O arquivo recebido não contém as faixas esperadas.")
    expected = payload.get("expectedDuration")
    if type(expected) in (int, float) and math.isfinite(expected) and expected > 0:
        try:
            duration = float(info.get("format", {}).get("duration", "nan"))
        except (TypeError, ValueError):
            duration = math.nan
        if not math.isfinite(duration) or abs(duration - expected) > max(.75, expected*.05):
            raise InvalidMedia("A duração do arquivo não corresponde à origem.")


def cleanup_published_download(target, source_path, id_):
    """Remove only staging files belonging to a confirmed publication."""
    published = target.parent / (".media-collector-" + id_ + ".part")
    try:
        if not published.is_symlink() and published.is_file() and published.samefile(target):
            published.unlink()
    except OSError:
        pass
    try:
        source = staging_source(source_path, id_)
        source.unlink()
        source.parent.rmdir()
    except (OSError, InvalidMedia):
        pass


def publish_download(payload):
    id_ = task_id(payload.get("id"))
    filename = validate_filename(payload.get("filename"))
    category = payload.get("category")
    token = payload.get("destination")
    source_path = payload.get("source")
    intent = [source_path, token, category, filename]
    # Uma transferência tem registro próprio. Isso também impede publicação dupla concorrente.
    with local_state("transfer-" + id_) as (state, journal):
        if state.get("intent", intent) != intent:
            raise InvalidMedia("O destino desta transferência foi alterado.")
        if state.get("target"):
            target = pathlib.Path(state["target"])
            if target.is_file() and not target.is_symlink():
                info = target.stat()
                if state.get("target_stat") == [info.st_dev, info.st_ino, info.st_size]:
                    cleanup_published_download(target, source_path, id_)
                    return target
            raise ValueError("O arquivo salvo foi movido ou removido.")
        # Reconcile a crash after an atomic rename but before recording the result.
        if state.get("candidate") and state.get("source_stat"):
            candidate = pathlib.Path(state["candidate"])
            if candidate.is_file() and not candidate.is_symlink():
                info = candidate.stat()
                current = [info.st_dev, info.st_ino, info.st_size]
                if current == state["source_stat"]:
                    state.update(target=str(candidate), target_stat=current)
                    persist(journal, state)
                    cleanup_published_download(candidate, source_path, id_)
                    return candidate
        try:
            source = staging_source(source_path, id_)
        except FileNotFoundError:
            raise InvalidMedia("O arquivo temporário não está mais disponível.") from None
        folder = destination_folder(token, category)
        published = folder / (".media-collector-" + id_ + ".part")
        if published.is_symlink() or (published.exists() and not published.is_file()):
            raise ValueError("O arquivo temporário do destino é inválido.")
        if not state:
            state["intent"] = intent
            persist(journal, state)
        with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as data:
            if not stat.S_ISREG(os.fstat(data.fileno()).st_mode):
                raise InvalidMedia("O arquivo temporário não é um arquivo regular.")
            verify_staged(data, source, payload, filename)
            if not published.exists():
                with tempfile.NamedTemporaryFile(dir=folder, prefix=".media-collector-", delete=False) as temp:
                    copy = pathlib.Path(temp.name)
                    try:
                        data.seek(0)
                        shutil.copyfileobj(data, temp, 1024 * 1024)
                        if temp.tell() != os.fstat(data.fileno()).st_size:
                            raise InvalidMedia("O arquivo mudou durante a gravação.")
                        temp.flush()
                        os.fsync(temp.fileno())
                        copy.replace(published)
                    finally:
                        copy.unlink(missing_ok=True)
        # Preserve recovery for transfers from versions that published by hard link.
        target = next((item for item in folder.iterdir() if item != published
                       and item.is_file() and not item.is_symlink() and item.samefile(published)), None)
        if target is None:
            info = published.stat()
            stem, suffix = pathlib.Path(filename).stem, pathlib.Path(filename).suffix
            for number in range(10000):
                candidate = folder / (f"{stem} ({number}){suffix}" if number else filename)
                state.update(candidate=str(candidate), source_stat=[info.st_dev, info.st_ino, info.st_size])
                persist(journal, state)
                try:
                    exclusive_move(published, candidate)
                    target = candidate
                    break
                except FileExistsError:
                    continue
            if target is None:
                raise ValueError("Não foi possível criar um nome único.")
        state["target"] = str(target)
        info = target.stat()
        state["target_stat"] = [info.st_dev, info.st_ino, info.st_size]
        persist(journal, state)
        cleanup_published_download(target, source_path, id_)
        return target



class NativeStream:
    """One acknowledged, bounded upload, confined to an authorized destination."""
    MAX_CHUNK = 256 * 1024

    def __init__(self):
        self.transfer = None
        self.lock = threading.Lock()
        self.worker = None

    def cleanup(self):
        transfer, self.transfer = self.transfer, None
        if transfer:
            try:
                transfer["file"].close()
            finally:
                transfer["path"].unlink(missing_ok=True)

    def handle(self, payload):
        action, id_ = payload.get("action"), payload.get("id")
        if action == "stream-start":
            task_id(id_)
            if self.transfer:
                raise ValueError("Já existe uma transferência ativa nesta conexão.")
            filename = validate_filename(payload.get("filename"))
            expected = payload.get("expectedBytes")
            if expected is not None and (type(expected) is not int or not 0 < expected <= MAX_BYTES):
                raise InvalidMedia("Tamanho esperado inválido.")
            kind = payload.get("kind")
            if kind not in (None, "image", "video", "audio"):
                raise InvalidMedia("Tipo de mídia inválido.")
            folder = destination_folder(payload.get("destination"), payload.get("category"))
            with local_state("stream-" + id_) as (state, journal):
                if state:
                    raise InvalidMedia("Esta transferência já foi iniciada; consulte seu estado.")
                file = tempfile.NamedTemporaryFile(mode="w+b", prefix=".media-collector-stream-", dir=folder, delete=False)
                try:
                    state.update(status="processing", pid=os.getpid(), temporary=file.name, folder=str(folder))
                    persist(journal, state)
                except BaseException:
                    file.close()
                    pathlib.Path(file.name).unlink(missing_ok=True)
                    raise
            self.transfer = {"id": id_, "filename": filename, "folder": folder, "file": file,
                             "path": pathlib.Path(file.name), "offset": 0, "digest": hashlib.sha256(),
                             "cancel": threading.Event(), "finishing": False,
                             "metadata": {key: payload.get(key) for key in
                                 ("kind", "expectedBytes", "expectedDuration", "expectedAudio")}}
            return {"id": id_, "event": "stream-ready", "offset": 0}
        transfer = self.transfer
        if not transfer or id_ != transfer["id"]:
            if action == "stream-cancel":
                return stream_status(id_)
            raise InvalidMedia("Transferência não encontrada nesta conexão.")
        if action == "stream-cancel":
            with self.lock:
                if self.transfer is not transfer:
                    return stream_status(id_)
                transfer["cancel"].set()
                if transfer["finishing"]:
                    return {"id": id_, "event": "stream-cancelling"}
                self.mark_terminal(id_, "cancelled")
                self.cleanup()
                return {"id": id_, "event": "cancelled"}
        if action == "stream-append":
            if type(payload.get("offset")) is not int or payload["offset"] != transfer["offset"]:
                raise InvalidMedia("Posição do fragmento inválida.")
            data = payload.get("data")
            if not isinstance(data, str) or not data or len(data) > ((self.MAX_CHUNK + 2) // 3) * 4:
                raise InvalidMedia("Fragmento de mídia inválido.")
            try:
                chunk = base64.b64decode(data, validate=True)
            except (ValueError, binascii.Error):
                raise InvalidMedia("Fragmento de mídia inválido.") from None
            if not 0 < len(chunk) <= self.MAX_CHUNK or transfer["offset"] + len(chunk) > MAX_BYTES:
                raise InvalidMedia("Fragmento ou tamanho total inválido.")
            expected = transfer["metadata"]["expectedBytes"]
            if expected is not None and transfer["offset"] + len(chunk) > expected:
                raise InvalidMedia("Arquivo maior que o tamanho esperado.")
            transfer["file"].write(chunk)
            transfer["digest"].update(chunk)
            transfer["offset"] += len(chunk)
            return {"id": id_, "event": "stream-ack", "offset": transfer["offset"]}
        if action == "stream-finish":
            with self.lock:
                if transfer["finishing"]:
                    raise InvalidMedia("Esta transferência já está finalizando.")
                transfer["finishing"] = True
            total, digest = payload.get("expectedBytes"), payload.get("sha256")
            if type(total) is not int or total != transfer["offset"] or not 0 < total <= MAX_BYTES:
                raise InvalidMedia("Arquivo incompleto ou tamanho inconsistente.")
            if transfer["metadata"]["expectedBytes"] not in (None, total):
                raise InvalidMedia("Arquivo incompleto ou tamanho inconsistente.")
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or digest != transfer["digest"].hexdigest():
                raise InvalidMedia("A verificação de integridade do arquivo falhou.")
            transfer["step"] = "flush"
            transfer["file"].flush()
            transfer["step"] = "fsync"
            os.fsync(transfer["file"].fileno())
            transfer["step"] = "verify"
            verify_staged(transfer["file"], transfer["path"], {**transfer["metadata"], "expectedBytes": total}, transfer["filename"])
            with self.lock:
                if transfer["cancel"].is_set():
                    self.mark_terminal(id_, "cancelled")
                    self.cleanup()
                    return {"id": id_, "event": "cancelled"}
                transfer["step"] = "publish"
                target = publish_stream(transfer)
                transfer["published"] = True
                transfer["step"] = "stat"
                info = target.stat()
                transfer["step"] = "journal"
                with local_state("stream-" + id_) as (state, journal):
                    state.update(status="saved", target=str(target), target_stat=[info.st_dev, info.st_ino, info.st_size])
                    persist(journal, state)
                self.cleanup()
                return {"id": id_, "event": "done", "filename": str(target)}
        raise InvalidMedia("Operação de transferência inválida.")

    def mark_terminal(self, id_, status, diagnostic=None):
        with local_state("stream-" + id_) as (state, journal):
            state["status"] = status
            if diagnostic:
                state["diagnostic"] = diagnostic
            persist(journal, state)

    def dispatch(self, payload):
        try:
            return self.handle(payload)
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            message = str(error) if isinstance(error, InvalidMedia) else "Não foi possível gravar no destino escolhido."
            if self.transfer and payload.get("id") == self.transfer["id"] and not self.transfer.get("published"):
                action = payload.get("action")
                phase = action if action in ("stream-start", "stream-append", "stream-finish", "stream-cancel") else "stream-unknown"
                diagnostic = {"phase": phase, "type": type(error).__name__, "message": message,
                              "step": self.transfer.get("step", "unknown"),
                              "errno": error.errno if isinstance(error, OSError) else None}
                self.mark_terminal(payload["id"], "failed", diagnostic)
                self.cleanup()
            return {"id": payload.get("id"), "event": "error", "error": message}


def stream_status(id_):
    task_id(id_)
    with local_state("stream-" + id_) as (state, journal):
        if not state:
            return {"id": id_, "event": "stream-status", "status": "unknown"}
        target = pathlib.Path(state["target"]) if state.get("target") else None
        temp = pathlib.Path(state["temporary"]) if state.get("temporary") else None
        candidate = pathlib.Path(state["candidate"]) if state.get("candidate") else None
        # An atomic move can complete before the saved journal update. Match the
        # original inode and size, never a colliding pre-existing file.
        if not target and candidate and temp and not temp.exists() and candidate.is_file() and not candidate.is_symlink():
            info = candidate.stat()
            if state.get("source_stat") == [info.st_dev, info.st_ino, info.st_size]:
                target = candidate
                state.update(status="saved", target=str(target), target_stat=state["source_stat"])
                persist(journal, state)
        # A hard link survives a crash between publication and journal update.
        if not target and temp and temp.is_file() and not temp.is_symlink():
            folder = pathlib.Path(state["folder"])
            target = next((p for p in folder.iterdir() if p != temp and p.is_file() and not p.is_symlink()
                           and p.samefile(temp)), None)
            if target:
                info = target.stat()
                state.update(status="saved", target=str(target), target_stat=[info.st_dev, info.st_ino, info.st_size])
                persist(journal, state)
        if target and target.is_file() and not target.is_symlink():
            info = target.stat()
            if state.get("target_stat") == [info.st_dev, info.st_ino, info.st_size]:
                return {"id": id_, "event": "stream-status", "status": "saved", "filename": str(target)}
        status = state.get("status", "unknown")
        if status == "processing":
            try:
                pid = int(state.get("pid", 0))
                if pid <= 0:
                    raise ValueError("PID inválido")
                os.kill(pid, 0)
            except (OSError, ValueError):
                status = "interrupted"
        result = {"id": id_, "event": "stream-status", "status": status}
        if status == "failed" and isinstance(state.get("diagnostic"), dict):
            result["diagnostic"] = state["diagnostic"]
        return result

def reveal_file(filename):
    if not isinstance(filename, str):
        raise InvalidMedia("Arquivo salvo inválido.")
    path = pathlib.Path(filename).resolve(strict=True)
    validate_filename(path.name)
    with local_state("destinations") as (state, _):
        origins = [default_destination(), *map(pathlib.Path, state.get("folders", {}).values())]
    if not path.is_file() or path.parent.name not in CATEGORIES or path.parent.parent not in {folder.resolve() for folder in origins}:
        raise InvalidMedia("O arquivo não pertence a uma pasta do Media Collector.")
    subprocess.run(["/usr/bin/open", "-R", str(path)], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run_destination_action(action, payload):
    id_ = payload.get("id")
    result = {"id": id_, "event": "done"}
    try:
        if action == "destination-get":
            result.update(get_destination())
        elif action == "destination-downloads":
            result.update(downloads_destination())
        elif action == "destination-choose":
            result.update(choose_destination(payload.get("remember") is True))
        elif action == "publish-download":
            result["filename"] = str(publish_download(payload))
        elif action == "reveal-file":
            reveal_file(payload.get("filename"))
    except InterruptedError:
        result["event"] = "cancelled"
    except PermissionError as error:
        source = payload.get("source")
        if action == "publish-download" and error.filename == source:
            message = "O macOS bloqueou a leitura do arquivo temporário em Downloads. O vídeo continua disponível para tentar gravar novamente."
        else:
            message = "O macOS bloqueou o acesso a uma pasta do auxiliar. Confira o destino ou use o seletor do navegador."
        result.update(event="error", retryable=True, error=message)
    except (InvalidMedia, ValueError, OSError, subprocess.SubprocessError) as error:
        retryable = not isinstance(error, InvalidMedia)
        message = str(error) if isinstance(error, ValueError) else "A operação local não foi concluída. Verifique o destino e tente novamente."
        result.update(event="error", retryable=retryable, error=message)
    send(result)


def run_job(job, payload):
    try:
        ffmpeg, ffprobe = binary("ffmpeg"), binary("ffprobe")
        if not ffmpeg or not ffprobe:
            raise ValueError("Instale FFmpeg e ffprobe localmente para usar o auxiliar.")
        tracks = payload.get("tracks")
        if not isinstance(tracks, list) or len(tracks) not in (1, 2) or any(not isinstance(t, list) or not t for t in tracks) or sum(map(len, tracks)) > MAX_PARTS:
            raise ValueError("Faixas de mídia inválidas.")
        if any(not isinstance(part, dict) for track in tracks for part in track):
            raise ValueError("Segmento de mídia inválido.")
        output = payload.get("output")
        if output not in ("mp4", "webm", "mp3", "m4a", "original"):
            raise ValueError("Formato de saída inválido.")
        filename = payload.get("filename", "")
        if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_. ()-]{1,100}\.(?:mp4|webm|mp3|m4a|aac|opus|ogg|wav|flac)", filename, re.I):
            raise ValueError("Nome de arquivo inválido.")
        if output != "original" and pathlib.Path(filename).suffix.lower() != "." + output:
            raise ValueError("Extensão e formato de saída não correspondem.")
        expected = payload.get("expectedDuration")
        if expected is not None and (isinstance(expected, bool) or not isinstance(expected, (int, float)) or not math.isfinite(expected) or expected <= 0):
            raise ValueError("Duração esperada inválida.")
        expect_audio = payload.get("expectAudio")
        if expect_audio not in (True, False, None):
            raise ValueError("Indicação de áudio inválida.")
        folder = destination_folder(payload.get("destination"), payload.get("category", "Web geral"))
        folder.mkdir(parents=True, exist_ok=True)
        send({"id": job["id"], "event": "started"})
        with tempfile.TemporaryDirectory(prefix=".media-collector-", dir=folder) as tmp:
            tmp = pathlib.Path(tmp)
            totals, seen_resources = {"bytes": 0}, {}
            parts_total = sum(map(len, tracks))
            done = 0
            inputs = []
            for index, track in enumerate(tracks):
                input_file = tmp / f"input{index}.bin"
                with input_file.open("wb") as f:
                    for part in track:
                        checkpoint(job)
                        download(job, part, f, totals, seen_resources)
                        done += 1
                        send({"id": job["id"], "event": "progress", "phase": "Baixando segmentos", "completed": done, "total": parts_total, "unit": "segments", "bytes": totals["bytes"]})
                inputs.append(input_file)
            source_probe = probe(ffprobe, inputs[0])
            if expected is None:
                try:
                    source_duration = float(source_probe.get("format", {}).get("duration", "nan"))
                    if math.isfinite(source_duration) and source_duration > 0:
                        expected = source_duration
                except (ValueError, TypeError):
                    pass
            source_video = any(x.get("codec_type") == "video" for x in source_probe.get("streams", []))
            source_audio = any(x.get("codec_type") == "audio" for x in source_probe.get("streams", []))
            if len(inputs) == 2:
                source_audio |= any(x.get("codec_type") == "audio" for x in probe(ffprobe, inputs[1]).get("streams", []))
            if output in ("mp3", "m4a") or (output == "original" and pathlib.Path(filename).suffix.lower() not in (".mp4", ".webm")):
                if not source_audio:
                    raise ValueError("Não foi encontrada uma faixa de áudio.")
                if len(inputs) > 1:
                    args = ["-i", str(inputs[1]), "-map", "0:a:0"]
                else:
                    args = ["-i", str(inputs[0]), "-map", "0:a:0"]
                codec = {"mp3": "libmp3lame", "m4a": "aac", "original": "copy"}[output]
                args += ["-vn", "-c:a", codec]
            else:
                if not source_video:
                    raise ValueError("Não foi encontrada uma faixa de vídeo.")
                args = ["-i", str(inputs[0])]
                if len(inputs) > 1:
                    args += ["-i", str(inputs[1]), "-map", "0:v:0", "-map", "1:a:0"]
                if output == "mp4":
                    args += ["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart"]
                elif output == "webm":
                    args += ["-c:v", "libvpx-vp9", "-c:a", "libopus"]
                else:
                    args += ["-c", "copy"]
            result = tmp / ("resultado" + pathlib.Path(filename).suffix.lower())
            ffmpeg_run(job, ffmpeg, args + ["-y", str(result)], expected, "Convertendo")
            result_probe = probe(ffprobe, result)
            kinds = [s.get("codec_type") for s in result_probe.get("streams", [])]
            duration = float(result_probe.get("format", {}).get("duration", "nan"))
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("Não foi possível confirmar a duração do arquivo.")
            if expected and abs(duration-expected) > max(.75, expected*.05):
                raise ValueError("A duração do arquivo não corresponde à origem.")
            if source_video and output in ("mp4", "webm") and "video" not in kinds:
                raise ValueError("O arquivo final não contém vídeo.")
            if (source_audio or expect_audio is True) and "audio" not in kinds:
                raise ValueError("O arquivo final não contém a faixa de áudio esperada.")
            ffmpeg_run(job, ffmpeg, ["-xerror", "-i", str(result), "-f", "null", "-"], duration, "Verificando")
            checkpoint(job)
            target = unique_publish(result, folder, filename)
            send({"id": job["id"], "event": "done", "filename": str(target), "duration": duration, "hasAudio": "audio" in kinds, "hasVideo": "video" in kinds, "audioExpected": expect_audio})
    except InterruptedError:
        send({"id": job["id"], "event": "cancelled"})
    except Exception as error:
        # Do not forward URLs or stderr that may include signed addresses.
        safe = str(error) if isinstance(error, ValueError) else "Falha de rede ou processamento local. Verifique a origem e tente novamente."
        send({"id": job["id"], "event": "error", "error": safe})
    finally:
        global active
        with STATE_LOCK:
            if active is job:
                active = None


def yt_process(job, args, stdout):
    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=stdout,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    with STATE_LOCK:
        job["process"] = process
        job["process_group"] = True
        if not job["resume"].is_set():
            os.killpg(process.pid, signal.SIGSTOP)
        if job["cancel"].is_set():
            os.killpg(process.pid, signal.SIGTERM)
    try:
        result = process.wait(timeout=600)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise ValueError("A análise ou o download excedeu o tempo disponível.")
    finally:
        with STATE_LOCK:
            job["process"] = None
            job["process_group"] = False
    checkpoint(job)
    if result:
        raise ValueError("Não foi possível acessar ou processar esta página com o yt-dlp.")


def page_url(value):
    try:
        return validate_public_http_url(value)
    except ValueError as error:
        if str(error).startswith("Acesso a endereços"):
            raise ValueError("Análise de páginas locais ou privadas não é permitida.") from None
        raise ValueError("Endereço de página inválido ou não público.") from None


def finish_page_job(job, event):
    global active
    with STATE_LOCK:
        if active is job:
            active = None
    send(event)


def eligible_video_size(width, height):
    return all(isinstance(value, (int, float)) and math.isfinite(value) and value > 500
               for value in (width, height))


def run_page_job(job, payload):
    proxy = None
    try:
        ytdlp, ffmpeg, ffprobe = binary("yt-dlp"), binary("ffmpeg"), binary("ffprobe")
        if not ytdlp or not ffmpeg or not ffprobe:
            raise ValueError("Instale yt-dlp, FFmpeg e ffprobe para analisar páginas.")
        url = page_url(payload.get("url"))
        proxy = PublicOnlyProxy()
        proxy_url = proxy.__enter__()
        # Route HTTP(S) retrieval through a per-job proxy that resolves and pins
        # public addresses. The native downloader fails closed for protocols
        # that cannot use this HTTP(S)-only network boundary.
        args = [ytdlp, "--ignore-config", "--no-playlist", "--no-warnings",
                "--ffmpeg-location", ffmpeg, "--proxy", proxy_url, "--downloader", "native"]
        if payload["action"] == "page-analyze":
            send({"id": job["id"], "event": "started"})
            with tempfile.TemporaryFile(mode="w+b") as output:
                yt_process(job, args + ["--skip-download", "--dump-single-json", "--", url], output)
                if output.tell() > 20 * 1024 * 1024:
                    raise ValueError("A resposta de análise é grande demais.")
                output.seek(0)
                info = json.load(output)
            if info.get("_type") in ("playlist", "multi_video") or info.get("is_live") or info.get("has_drm"):
                raise ValueError("Esta página contém uma lista, transmissão ao vivo ou mídia protegida.")
            formats = []
            audio_only = payload.get("audioOnly") is True
            for item in info.get("formats") or [info]:
                fid = item.get("format_id")
                width, height = item.get("width") or 0, item.get("height") or 0
                if not isinstance(fid, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", fid):
                    continue
                if item.get("has_drm"):
                    continue
                if audio_only and item.get("acodec") in (None, "none"):
                    continue
                if not audio_only and (item.get("vcodec") == "none" or not eligible_video_size(width, height)):
                    continue
                formats.append({"id": fid, "width": width, "height": height,
                                "ext": str(item.get("ext") or "")[:12],
                                "audio": item.get("acodec") not in (None, "none"), "audioOnly": audio_only})
            formats = sorted(formats, key=lambda x: x["width"] * x["height"], reverse=True)[:100]
            if not formats:
                if audio_only:
                    raise ValueError("Nenhuma faixa de áudio identificada nesta página.")
                raise ValueError("Nenhum vídeo elegível com dimensões verificadas foi encontrado.")
            with STATE_LOCK:
                page_analyses.clear()
                page_analyses[job["id"]] = {"url": url, "formats": formats, "duration": info.get("duration"),
                    "audioOnly": audio_only, "audio": any(f.get("acodec") not in (None, "none") and not f.get("has_drm") for f in info.get("formats", []))}
            finish_page_job(job, {"id": job["id"], "event": "page-formats", "formats": formats})
            return
        with STATE_LOCK:
            analysis = page_analyses.get(payload.get("analysisId"))
        if not analysis or analysis["url"] != url:
            raise ValueError("Analise esta página novamente antes de baixar.")
        selected = next((f for f in analysis["formats"] if f["id"] == payload.get("formatId")), None)
        if not selected:
            raise ValueError("Formato não encontrado na análise desta página.")
        output_format = payload.get("output")
        if output_format not in ("mp4", "webm", "mp3", "m4a"):
            raise ValueError("Escolha MP4, WebM, MP3 ou M4A.")
        if analysis["audioOnly"] and output_format not in ("mp3", "m4a"):
            raise ValueError("Analise a página novamente com um formato de vídeo selecionado.")
        folder = destination_folder(payload.get("destination"), payload.get("category", "Web geral"))
        folder.mkdir(parents=True, exist_ok=True)
        send({"id": job["id"], "event": "started"})
        with tempfile.TemporaryDirectory(prefix=".media-collector-", dir=folder) as temp:
            temp = pathlib.Path(temp)
            format_id = selected["id"]
            if not selected["audio"] and analysis["audio"]:
                format_id += "+bestaudio"
            with tempfile.TemporaryFile(mode="w+b") as output:
                yt_process(job, args + ["--format", format_id, "--no-part", "--max-filesize", str(MAX_BYTES),
                    "--output", str(temp / "origem.%(ext)s"), "--", url], output)
            files = [p for p in temp.iterdir() if p.is_file() and p.name.startswith("origem.")]
            if len(files) != 1:
                raise ValueError("Não foi possível identificar o arquivo baixado.")
            source = probe(ffprobe, files[0])
            source_streams = source.get("streams", [])
            source_types = [v.get("codec_type") for v in source_streams]
            if (not analysis["audioOnly"] and "video" not in source_types) or ((selected["audio"] or analysis["audio"]) and "audio" not in source_types):
                raise ValueError("O arquivo recebido não contém as faixas esperadas.")
            if not analysis["audioOnly"] and not any(
                stream.get("codec_type") == "video" and eligible_video_size(stream.get("width"), stream.get("height"))
                for stream in source_streams
            ):
                raise ValueError("O vídeo recebido não ultrapassa 500 × 500 px.")
            expected = analysis.get("duration")
            expected = expected if isinstance(expected, (int, float)) and not isinstance(expected, bool) and math.isfinite(expected) and expected > 0 else None
            result = temp / ("resultado." + output_format)
            if output_format in ("mp3", "m4a"):
                if "audio" not in source_types:
                    raise ValueError("Não foi encontrada uma faixa de áudio.")
                convert = ["-i", str(files[0]), "-vn", "-c:a", "libmp3lame" if output_format == "mp3" else "aac"]
            else:
                convert = ["-i", str(files[0]), "-c:v", "libx264" if output_format == "mp4" else "libvpx-vp9", "-c:a", "aac" if output_format == "mp4" else "libopus"]
            ffmpeg_run(job, ffmpeg, convert + ["-y", str(result)], expected, "Convertendo")
            final = probe(ffprobe, result)
            kinds = [v.get("codec_type") for v in final.get("streams", [])]
            duration = float(final.get("format", {}).get("duration", "nan"))
            if not math.isfinite(duration) or duration <= 0 or (expected and abs(duration-expected) > max(.75, expected*.05)):
                raise ValueError("A duração do arquivo não corresponde à origem.")
            if output_format in ("mp4", "webm") and "video" not in kinds or "audio" in source_types and "audio" not in kinds:
                raise ValueError("O arquivo final não contém as faixas esperadas.")
            ffmpeg_run(job, ffmpeg, ["-xerror", "-i", str(result), "-f", "null", "-"], duration, "Verificando")
            checkpoint(job)
            filename = validate_filename(payload.get("filename") or "pagina-" + ("audio" if output_format in ("mp3", "m4a") else "video") + "-" + job["id"][:32] + "." + output_format)
            if pathlib.Path(filename).suffix.lower() != "." + output_format:
                raise ValueError("Extensão e formato de saída não correspondem.")
            target = unique_publish(result, folder, filename)
            finish_page_job(job, {"id": job["id"], "event": "done", "filename": str(target), "duration": duration,
                  "hasAudio": "audio" in kinds, "hasVideo": "video" in kinds})
    except InterruptedError:
        finish_page_job(job, {"id": job["id"], "event": "cancelled"})
    except Exception as error:
        safe = str(error) if isinstance(error, ValueError) else "Falha na análise ou no processamento local."
        finish_page_job(job, {"id": job["id"], "event": "error", "error": safe})
    finally:
        global active
        with STATE_LOCK:
            if active is job:
                active = None
        if proxy:
            proxy.__exit__(None, None, None)


def main():
    global active
    stream = NativeStream()
    while True:
        try:
            message = read_message()
        except (EOFError, ValueError, json.JSONDecodeError):
            break
        if message is None:
            break
        action, request_id = message.get("action"), message.get("id")
        if action == "ping":
            send({"id": request_id, "event": "pong", "ffmpeg": bool(binary("ffmpeg") and binary("ffprobe")), "version": 2})
        elif action == "stream-status":
            try:
                send(stream_status(request_id))
            except (ValueError, OSError):
                send({"id": request_id, "event": "error", "error": "Identificador de transferência inválido."})
        elif action == "stream-finish":
            if stream.worker and stream.worker.is_alive():
                send({"id": request_id, "event": "error", "error": "Esta transferência já está finalizando."})
            else:
                def finish_stream(payload=message):
                    try:
                        send(stream.dispatch(payload))
                    except (BrokenPipeError, OSError):
                        pass
                stream.worker = threading.Thread(target=finish_stream, daemon=True)
                stream.worker.start()
        elif action in ("stream-start", "stream-append", "stream-cancel"):
            send(stream.dispatch(message))
        elif action in ("destination-get", "destination-downloads", "destination-choose", "publish-download", "reveal-file"):
            run_destination_action(action, message)
        elif action in ("start", "page-analyze", "page-download"):
            if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", request_id):
                send({"id": "", "event": "error", "error": "Identificador inválido."})
                continue
            with STATE_LOCK:
                if active:
                    send({"id": request_id, "event": "error", "error": "Já existe um processamento ativo no auxiliar."})
                    continue
                job = {"id": request_id, "cancel": threading.Event(), "resume": threading.Event(), "process": None}
                job["resume"].set()
                active = job
            job["thread"] = threading.Thread(target=run_job if action == "start" else run_page_job, args=(job, message), daemon=True)
            job["thread"].start()
        elif action in ("cancel", "pause", "resume"):
            with STATE_LOCK:
                job = active if active and active["id"] == request_id else None
                if job:
                    process = job["process"]
                    if action == "cancel":
                        job["cancel"].set()
                        job["resume"].set()
                        if process and process.poll() is None:
                            os.killpg(process.pid, signal.SIGCONT) if job.get("process_group") else os.kill(process.pid, signal.SIGCONT)
                            os.killpg(process.pid, signal.SIGTERM) if job.get("process_group") else process.terminate()
                    elif action == "pause":
                        job["resume"].clear()
                        if process and process.poll() is None:
                            os.killpg(process.pid, signal.SIGSTOP) if job.get("process_group") else os.kill(process.pid, signal.SIGSTOP)
                    else:
                        job["resume"].set()
                        if process and process.poll() is None:
                            os.killpg(process.pid, signal.SIGCONT) if job.get("process_group") else os.kill(process.pid, signal.SIGCONT)
            send({"id": request_id, "event": "ack", "action": action, "accepted": bool(job)})
    if stream.transfer:
        stream.transfer["cancel"].set()
    if stream.worker and stream.worker.is_alive():
        stream.worker.join(timeout=190)
    if stream.transfer and not stream.transfer.get("published"):
        stream.mark_terminal(stream.transfer["id"], "cancelled")
        stream.cleanup()
    with STATE_LOCK:
        job = active
        if job:
            job["cancel"].set()
            job["resume"].set()
            if job["process"] and job["process"].poll() is None:
                os.killpg(job["process"].pid, signal.SIGCONT) if job.get("process_group") else os.kill(job["process"].pid, signal.SIGCONT)
                os.killpg(job["process"].pid, signal.SIGTERM) if job.get("process_group") else job["process"].terminate()
    if job and job.get("thread"):
        job["thread"].join(timeout=35)


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, EOFError, ValueError, json.JSONDecodeError):
        pass
