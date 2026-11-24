"""Testa o destino do auxiliar em uma pasta temporária."""
import base64
import hashlib
import json
import os
import sys
import importlib.util
import pathlib
import struct
import subprocess
import tempfile
import threading
import unittest
import uuid
from unittest import mock


HOST = pathlib.Path(__file__).resolve().parents[1] / "native" / "host.py"
spec = importlib.util.spec_from_file_location("media_collector_host", HOST)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


def box(kind, content):
    return struct.pack(">I4s", len(content) + 8, kind) + content


MP4_BOXES = box(b"ftyp", b"isom\0\0\0\0") + box(b"moov", b"x") + box(b"mdat", b"media")


class NativeDestinationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = pathlib.Path(temp.name).resolve()
        patch = mock.patch.object(pathlib.Path, "home", return_value=self.home)
        patch.start()
        self.addCleanup(patch.stop)

    def choose(self, folder, remember):
        folder.mkdir()
        result = subprocess.CompletedProcess([], 0, stdout=str(folder) + "\n", stderr="")
        with mock.patch.object(host.subprocess, "run", return_value=result):
            return host.choose_destination(remember)

    def staged(self, content=MP4_BOXES):
        id_ = str(uuid.uuid4())
        source = self.home / "Browser Downloads" / host.STAGING_FOLDER / id_ / "clip-video-42.mp4"
        source.parent.mkdir(parents=True)
        source.write_bytes(content)
        return {
            "id": id_, "source": str(source), "filename": source.name, "category": "X.com",
            "destination": "documents", "expectedBytes": len(content),
        }

    def test_publish_default_and_retry_without_duplicate(self):
        request = self.staged()
        folder = host.default_destination() / "X.com"
        folder.mkdir(parents=True)
        collision = folder / request["filename"]
        collision.write_bytes(b"already exists")
        target = host.publish_download(request)
        self.assertEqual(target.parent, folder)
        self.assertEqual(target.read_bytes(), MP4_BOXES)
        self.assertEqual(collision.read_bytes(), b"already exists")
        self.assertNotEqual(target, collision)
        self.assertFalse(pathlib.Path(request["source"]).exists())
        self.assertEqual(host.publish_download(request), target)
        self.assertEqual(len(list(folder.iterdir())), 2)

    def test_remembered_destination_and_one_time_destination(self):
        first = self.choose(self.home / "Remember", True)
        once = self.choose(self.home / "One time", False)
        self.assertEqual(host.get_destination(), first)
        result = host.publish_download({**self.staged(), "destination": once["destination"]})
        self.assertEqual(result.parent, self.home / "One time" / "X.com")
        self.assertEqual(host.get_destination(), first)

    def test_downloads_destination_is_stable_and_does_not_replace_custom_default(self):
        custom = self.choose(self.home / "Remember", True)
        first = host.downloads_destination()
        second = host.downloads_destination()
        self.assertEqual(pathlib.Path(first["folder"]), self.home / "Downloads")
        self.assertTrue((self.home / "Downloads").is_dir())
        self.assertEqual(first["destination"], second["destination"])
        self.assertEqual(pathlib.Path(second["folder"]), self.home / "Downloads")
        self.assertEqual(host.get_destination(), custom)

    def test_image_validation_rejects_html_and_accepts_matching_png_signature(self):
        png = b"\x89PNG\r\n\x1a\n" + b"fixture"
        with tempfile.TemporaryFile() as file:
            file.write(png)
            file.flush()
            host.verify_staged(file, "fixture", {"kind": "image", "expectedBytes": len(png)}, "sample.png")

        html = b"<!doctype html><html><body>login</body></html>"
        with tempfile.TemporaryFile() as file:
            file.write(html)
            file.flush()
            with self.assertRaisesRegex(host.InvalidMedia, "HTML"):
                host.verify_staged(file, "fixture", {"kind": "image", "expectedBytes": len(html)}, "sample.png")

    def test_publish_recovers_after_rename_before_journal_commit(self):
        request = self.staged()
        move = host.exclusive_move
        def crash_after_move(source, target):
            move(source, target)
            raise RuntimeError("simulated interruption")
        with mock.patch.object(host, "exclusive_move", side_effect=crash_after_move):
            with self.assertRaises(RuntimeError):
                host.publish_download(request)
        result = host.publish_download(request)
        self.assertEqual(result.read_bytes(), MP4_BOXES)
        self.assertEqual(len(list(result.parent.iterdir())), 1)
        self.assertFalse(pathlib.Path(request["source"]).exists())
        self.assertEqual(host.publish_download(request), result)

    def test_retry_cleans_staging_after_journal_commit(self):
        request = self.staged()
        with mock.patch.object(host, "cleanup_published_download"):
            result = host.publish_download(request)
        self.assertTrue(pathlib.Path(request["source"]).exists())
        self.assertEqual(host.publish_download(request), result)
        self.assertFalse(pathlib.Path(request["source"]).exists())
        self.assertEqual([item.name for item in result.parent.iterdir()], [result.name])

    def test_missing_ffprobe_does_not_claim_known_audio_or_duration(self):
        request = {**self.staged(), "kind": "video", "expectedAudio": True}
        with mock.patch.object(host, "binary", return_value=None):
            with self.assertRaisesRegex(host.InvalidMedia, "ffprobe"):
                host.publish_download(request)
        self.assertTrue(pathlib.Path(request["source"]).exists())

    def test_missing_destination_preserves_staged_file(self):
        folder = self.home / "Removable"
        selected = self.choose(folder, True)
        request = {**self.staged(), "destination": selected["destination"]}
        folder.rmdir()
        with self.assertRaisesRegex(ValueError, "indisponível"):
            host.publish_download(request)
        self.assertTrue(pathlib.Path(request["source"]).is_file())
        folder.mkdir()
        target = host.publish_download(request)
        self.assertEqual(target.read_bytes(), MP4_BOXES)

    def test_reject_staging_redirect_and_truncated_video(self):
        partial = self.staged(MP4_BOXES[:-2])
        with self.assertRaisesRegex(host.InvalidMedia, "incompleto"):
            host.publish_download(partial)
        self.assertFalse((host.default_destination() / "X.com" / partial["filename"]).exists())
        source = pathlib.Path(partial["source"])
        source.unlink()
        outside = self.home / "outro.mp4"
        outside.write_bytes(MP4_BOXES)
        source.symlink_to(outside)
        with self.assertRaisesRegex(host.InvalidMedia, "redirecionado"):
            host.publish_download({**partial, "expectedBytes": len(MP4_BOXES)})
        self.assertEqual(outside.read_bytes(), MP4_BOXES)

    def stream_request(self, content=MP4_BOXES):
        return {"action": "stream-start", "id": str(uuid.uuid4()), "filename": "clip.mp4",
                "category": "X.com", "destination": "documents", "expectedBytes": len(content)}

    def test_stream_finish_over_persistent_native_connection(self):
        request = self.stream_request()
        env = dict(os.environ, HOME=str(self.home))
        process = subprocess.Popen([sys.executable, str(HOST)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        def exchange(packet):
            data = json.dumps(packet).encode()
            process.stdin.write(struct.pack("=I", len(data)) + data)
            process.stdin.flush()
            header = process.stdout.read(4)
            self.assertEqual(len(header), 4)
            return json.loads(process.stdout.read(struct.unpack("=I", header)[0]))
        self.assertEqual(exchange(request)["event"], "stream-ready")
        self.assertEqual(exchange({"action": "stream-append", "id": request["id"], "offset": 0,
                                   "data": base64.b64encode(MP4_BOXES).decode()})["event"], "stream-ack")
        result = exchange({"action": "stream-finish", "id": request["id"], "expectedBytes": len(MP4_BOXES),
                           "sha256": hashlib.sha256(MP4_BOXES).hexdigest()})
        self.assertEqual(result["event"], "done")
        self.assertEqual(pathlib.Path(result["filename"]).read_bytes(), MP4_BOXES)
        self.assertEqual(exchange({"action": "stream-status", "id": request["id"]})["status"], "saved")
        process.stdin.close()
        process.wait(timeout=5)
        process.stdout.close()
        process.stderr.close()

    def test_stream_framed_native_connection_and_disconnect_cleanup(self):
        request = self.stream_request()
        packets = [request, {"action": "stream-append", "id": request["id"], "offset": 0,
                             "data": base64.b64encode(MP4_BOXES).decode()}]
        encoded = b""
        for packet in packets:
            data = json.dumps(packet).encode()
            encoded += struct.pack("=I", len(data)) + data
        env = dict(os.environ, HOME=str(self.home))
        process = subprocess.run([sys.executable, str(HOST)], input=encoded, capture_output=True, env=env, timeout=10)
        self.assertEqual(process.returncode, 0)
        data = process.stdout
        events = []
        while data:
            size = struct.unpack("=I", data[:4])[0]
            events.append(json.loads(data[4:4 + size]))
            data = data[4 + size:]
        self.assertEqual([event["event"] for event in events], ["stream-ready", "stream-ack"])
        self.assertFalse(list((self.home / "Documents" / "Media Collector" / "Mídias" / "X.com").iterdir()))

    def test_cancel_during_final_validation_never_publishes(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        stream.dispatch({"action": "stream-append", "id": request["id"], "offset": 0,
                         "data": base64.b64encode(MP4_BOXES).decode()})
        started, resume, outcomes = threading.Event(), threading.Event(), []
        def slow_verify(*args):
            started.set()
            self.assertTrue(resume.wait(5))
        finish = {"action": "stream-finish", "id": request["id"], "expectedBytes": len(MP4_BOXES),
                  "sha256": hashlib.sha256(MP4_BOXES).hexdigest()}
        with mock.patch.object(host, "verify_staged", side_effect=slow_verify):
            worker = threading.Thread(target=lambda: outcomes.append(stream.dispatch(finish)))
            worker.start()
            self.assertTrue(started.wait(5))
            self.assertEqual(stream.dispatch({"action": "stream-cancel", "id": request["id"]})["event"], "stream-cancelling")
            resume.set()
            worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(outcomes[0]["event"], "cancelled")
        self.assertEqual(host.stream_status(request["id"])["status"], "cancelled")
        self.assertFalse(list((host.default_destination() / "X.com").iterdir()))

    def test_reconcile_publication_after_lost_journal_update(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        temp = stream.transfer["path"]
        temp.write_bytes(MP4_BOXES)
        target = temp.parent / "clip.mp4"
        os.link(temp, target)
        result = host.stream_status(request["id"])
        self.assertEqual(result["status"], "saved")
        self.assertEqual(pathlib.Path(result["filename"]).read_bytes(), MP4_BOXES)
        stream.cleanup()
        self.assertEqual(host.stream_status(request["id"])["status"], "saved")
        self.assertEqual(stream.dispatch({"action": "stream-start", **{k: v for k, v in request.items() if k != "action"}})["event"], "error")

    def test_stream_publish_and_ack(self):
        stream = host.NativeStream()
        self.addCleanup(stream.cleanup)
        request = self.stream_request()
        self.assertEqual(stream.dispatch(request)["event"], "stream-ready")
        for offset, chunk in ((0, MP4_BOXES[:8]), (8, MP4_BOXES[8:])):
            response = stream.dispatch({"action": "stream-append", "id": request["id"], "offset": offset,
                                        "data": base64.b64encode(chunk).decode()})
            self.assertEqual(response, {"id": request["id"], "event": "stream-ack", "offset": offset + len(chunk)})
        result = stream.dispatch({"action": "stream-finish", "id": request["id"], "expectedBytes": len(MP4_BOXES),
                                  "sha256": hashlib.sha256(MP4_BOXES).hexdigest()})
        self.assertEqual(result["event"], "done")
        self.assertEqual(pathlib.Path(result["filename"]).read_bytes(), MP4_BOXES)
        self.assertEqual(pathlib.Path(result["filename"]).parent, host.default_destination() / "X.com")
        self.assertEqual(len(list(pathlib.Path(result["filename"]).parent.iterdir())), 1)

    def test_permission_failure_records_only_safe_step(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        stream.dispatch({"action": "stream-append", "id": request["id"], "offset": 0,
                         "data": base64.b64encode(MP4_BOXES).decode()})
        with mock.patch.object(host, "exclusive_move", side_effect=PermissionError(1, "blocked", "/private/path")):
            result = stream.dispatch({"action": "stream-finish", "id": request["id"],
                                      "expectedBytes": len(MP4_BOXES), "sha256": hashlib.sha256(MP4_BOXES).hexdigest()})
        self.assertEqual(result["event"], "error")
        diagnostic = host.stream_status(request["id"])["diagnostic"]
        self.assertEqual((diagnostic["step"], diagnostic["errno"]), ("publish", 1))
        self.assertNotIn("/private/path", json.dumps(diagnostic))

    def test_stream_collision_never_overwrites(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        target = host.default_destination() / "X.com" / request["filename"]
        target.write_bytes(b"existing")
        stream.dispatch({"action": "stream-append", "id": request["id"], "offset": 0,
                         "data": base64.b64encode(MP4_BOXES).decode()})
        result = stream.dispatch({"action": "stream-finish", "id": request["id"],
                                  "expectedBytes": len(MP4_BOXES), "sha256": hashlib.sha256(MP4_BOXES).hexdigest()})
        self.assertEqual(target.read_bytes(), b"existing")
        self.assertEqual(pathlib.Path(result["filename"]).read_bytes(), MP4_BOXES)
        self.assertNotEqual(result["filename"], str(target))

    def test_stream_recovers_after_atomic_move_before_journal(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        source = stream.transfer["path"]
        source.write_bytes(MP4_BOXES)
        info = source.stat()
        target = source.parent / "clip.mp4"
        with host.local_state("stream-" + request["id"]) as (state, journal):
            state.update(candidate=str(target), source_stat=[info.st_dev, info.st_ino, info.st_size])
            host.persist(journal, state)
        os.rename(source, target)
        result = host.stream_status(request["id"])
        self.assertEqual(result["status"], "saved")
        self.assertEqual(pathlib.Path(result["filename"]).read_bytes(), MP4_BOXES)
        stream.cleanup()

    def test_stream_recovery_rejects_unrelated_candidate(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        source = stream.transfer["path"]
        info = source.stat()
        target = source.parent / "clip.mp4"
        target.write_bytes(b"unrelated")
        with host.local_state("stream-" + request["id"]) as (state, journal):
            state.update(candidate=str(target), source_stat=[info.st_dev, info.st_ino, info.st_size])
            host.persist(journal, state)
        source.unlink()
        self.assertNotEqual(host.stream_status(request["id"])["status"], "saved")
        stream.cleanup()

    def test_stream_rejects_corruption_and_cleans_temporary(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        folder = host.default_destination() / "X.com"
        stream.dispatch({"action": "stream-append", "id": request["id"], "offset": 0,
                         "data": base64.b64encode(MP4_BOXES).decode()})
        result = stream.dispatch({"action": "stream-finish", "id": request["id"], "expectedBytes": len(MP4_BOXES), "sha256": "0" * 64})
        self.assertEqual(result["event"], "error")
        status = host.stream_status(request["id"])
        self.assertEqual(status["diagnostic"]["phase"], "stream-finish")
        self.assertEqual(status["diagnostic"]["type"], "InvalidMedia")
        self.assertIn("integridade", status["diagnostic"]["message"])
        self.assertNotIn(str(self.home), json.dumps(status))
        self.assertFalse(list(folder.iterdir()))

    def test_stream_rejects_wrong_offset_and_cancels(self):
        stream = host.NativeStream()
        request = self.stream_request()
        stream.dispatch(request)
        folder = host.default_destination() / "X.com"
        result = stream.dispatch({"action": "stream-append", "id": request["id"], "offset": 1,
                                  "data": base64.b64encode(b"x").decode()})
        self.assertEqual(result["event"], "error")
        self.assertFalse(list(folder.iterdir()))
        request = self.stream_request()
        stream.dispatch(request)
        self.assertEqual(stream.dispatch({"action": "stream-cancel", "id": request["id"]})["event"], "cancelled")
        self.assertFalse(list(folder.iterdir()))

    def test_stream_disallows_oversized_chunks_and_invalid_media(self):
        stream = host.NativeStream()
        data = b"x" * (stream.MAX_CHUNK + 1)
        request = self.stream_request(data)
        stream.dispatch(request)
        result = stream.dispatch({"action": "stream-append", "id": request["id"], "offset": 0,
                                  "data": base64.b64encode(data).decode()})
        self.assertEqual(result["event"], "error")
        request = self.stream_request(b"<html>erro</html>")
        stream.dispatch(request)
        data = b"<html>erro</html>"
        stream.dispatch({"action": "stream-append", "id": request["id"], "offset": 0, "data": base64.b64encode(data).decode()})
        result = stream.dispatch({"action": "stream-finish", "id": request["id"], "expectedBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        self.assertEqual(result["event"], "error")
        self.assertFalse(list((host.default_destination() / "X.com").iterdir()))

    def test_cancel_folder_selection(self):
        result = subprocess.CompletedProcess([], 1, stdout="", stderr="User canceled. (-128)")
        with mock.patch.object(host.subprocess, "run", return_value=result):
            with self.assertRaises(InterruptedError):
                host.choose_destination(True)
        self.assertEqual(host.get_destination()["destination"], "documents")


if __name__ == "__main__":
    unittest.main()
