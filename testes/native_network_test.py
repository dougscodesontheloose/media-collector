"""Testes da fronteira de rede pública do auxiliar nativo, sem tráfego externo."""
import importlib.util
import io
import json
import pathlib
import socket
import sys
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST_PATH = ROOT / "native" / "host.py"
sys.path.insert(0, str(HOST_PATH.parent))
spec = importlib.util.spec_from_file_location("media_collector_host", HOST_PATH)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


def addr(ip, port=443, family=socket.AF_INET):
    sockaddr = (ip, port) if family == socket.AF_INET else (ip, port, 0, 0)
    return family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr


class FakeResponseSocket:
    def __init__(self, response):
        self.response = response
        self.sent = bytearray()
    def settimeout(self, _timeout):
        pass
    def sendall(self, data):
        self.sent.extend(data)
    def makefile(self, *_args, **_kwargs):
        return io.BytesIO(self.response)
    def close(self):
        pass


class NativeNetworkTests(unittest.TestCase):
    def test_public_literal_is_accepted_without_dns(self):
        self.assertEqual(host.validate_public_http_url("https://93.184.216.34/clip.mp4"),
                         "https://93.184.216.34/clip.mp4")

    def test_private_and_special_address_literals_are_rejected(self):
        for address in ("127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "fc00::1", "192.0.2.5",
                        "2002:0808:0808::1", "64:ff9b::a00:1"):
            with self.subTest(address=address), self.assertRaises(ValueError):
                host.validate_public_http_url(f"https://[{address}]/media") if ":" in address else host.validate_public_http_url(f"https://{address}/media")

    def test_dns_mixed_public_and_private_answers_are_rejected(self):
        with mock.patch.object(host.socket, "getaddrinfo", return_value=[addr("93.184.216.34"), addr("10.0.0.8")]):
            with self.assertRaisesRegex(ValueError, "locais ou privados"):
                host.validate_public_http_url("https://media.example.test/clip.mp4")

    def test_public_dns_answers_are_pinned_to_the_connection(self):
        expected = addr("93.184.216.34", 443)
        connection = mock.Mock()
        with mock.patch.object(host, "public_addresses", return_value=[expected]), \
                mock.patch.object(host.socket, "socket", return_value=connection):
            self.assertIs(host.connect_public("media.example.test", 443), connection)
        connection.connect.assert_called_once_with(expected[4])
        connection.settimeout.assert_called_once_with(30)

    def test_direct_opener_uses_public_connection_and_reads_response(self):
        response_socket = FakeResponseSocket(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ndata")
        with mock.patch.object(host, "public_addresses", return_value=[addr("93.184.216.34", 80)]), \
                mock.patch.object(host, "connect_public", return_value=response_socket) as connect:
            with host.OPENER.open("http://media.example.test/clip.mp4", timeout=2) as response:
                self.assertEqual(response.read(), b"data")
        connect.assert_called_once_with("media.example.test", 80, 2)
        self.assertIn(b"GET /clip.mp4 HTTP/1.1", response_socket.sent)

    def test_https_connection_wraps_the_pinned_socket_with_original_hostname(self):
        raw_socket = mock.Mock()
        context = mock.Mock()
        context.wrap_socket.return_value = raw_socket
        connection = host.PublicHTTPSConnection("media.example.test", context=context)
        with mock.patch.object(host, "connect_public", return_value=raw_socket) as connect:
            connection.connect()
        connect.assert_called_once_with("media.example.test", 443, connection.timeout)
        context.wrap_socket.assert_called_once_with(raw_socket, server_hostname="media.example.test")

    def test_https_handler_uses_context_api_without_private_attributes(self):
        handler = host.PublicHTTPSHandler()
        request = mock.Mock()
        with mock.patch.object(handler, "do_open", return_value="response") as do_open:
            self.assertEqual(handler.https_open(request), "response")
        do_open.assert_called_once_with(host.PublicHTTPSConnection, request, context=handler._context)

    def test_direct_download_rejects_private_source_before_open(self):
        job = {"cancel": mock.Mock(is_set=lambda: False), "resume": mock.Mock(wait=lambda _delay: True)}
        with mock.patch.object(host.OPENER, "open") as open_request:
            with self.assertRaisesRegex(ValueError, "locais ou privados"):
                host.download(job, {"url": "http://127.0.0.1:8123/clip.mp4"}, mock.Mock(), {"bytes": 0}, {})
        open_request.assert_not_called()

    def test_redirect_to_private_destination_is_rejected(self):
        redirect = host.SafeRedirect()
        with self.assertRaisesRegex(ValueError, "locais ou privados"):
            redirect.redirect_request(mock.Mock(), mock.Mock(), 302, "Found", {}, "http://169.254.169.254/latest/meta-data/")

    def test_page_analyzer_rejects_private_destination(self):
        with self.assertRaisesRegex(ValueError, "páginas locais ou privadas"):
            host.page_url("http://127.0.0.1/admin")

    def test_public_proxy_denies_private_target_before_connecting(self):
        proxy = host.PublicOnlyProxy()
        proxy_url = proxy.__enter__()
        self.addCleanup(proxy.__exit__, None, None, None)
        opener = host.urllib.request.build_opener(host.urllib.request.ProxyHandler({"http": proxy_url}))
        with mock.patch.object(host.urllib.request, "proxy_bypass", return_value=False):
            with self.assertRaises(host.urllib.error.HTTPError) as result:
                opener.open("http://127.0.0.1:8123/private", timeout=3)
        self.assertEqual(result.exception.code, 403)
        result.exception.close()
        self.assertEqual(proxy.server.denied_requests, 1)

    def test_ytdlp_page_flow_is_routed_through_restricted_proxy(self):
        calls = []
        class FakeProxy:
            def __enter__(self):
                return "http://random:token@127.0.0.1:43210"
            def __exit__(self, *_args):
                calls.append("proxy-closed")

        def fake_ytdlp(_job, args, output):
            calls.append(args)
            output.write(json.dumps({"formats": [{"format_id": "720p", "vcodec": "h264", "acodec": "aac",
                                                    "width": 1280, "height": 720, "ext": "mp4"}],
                                     "duration": 4}).encode())

        with mock.patch.object(host, "binary", side_effect=lambda name: f"/bin/{name}"), \
                mock.patch.object(host, "page_url", return_value="https://media.example.test/post"), \
                mock.patch.object(host, "PublicOnlyProxy", FakeProxy), \
                mock.patch.object(host, "yt_process", side_effect=fake_ytdlp), \
                mock.patch.object(host, "send"):
            host.run_page_job({"id": "test-page", "cancel": mock.Mock(is_set=lambda: False),
                               "resume": mock.Mock(wait=lambda _delay: True), "process": None},
                              {"action": "page-analyze", "url": "https://media.example.test/post"})
        args = calls[0]
        self.assertIn("--proxy", args)
        proxy_index = args.index("--proxy")
        self.assertTrue(args[proxy_index + 1].startswith("http://random:token@127.0.0.1:"))
        self.assertEqual(args[args.index("--downloader") + 1], "native")
        self.assertEqual(calls[-1], "proxy-closed")


if __name__ == "__main__":
    unittest.main()
