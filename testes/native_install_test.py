"""Valida o registro do auxiliar em HOME temporário, sem tocar no perfil real."""
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "native" / "install.py"
HOST_SOURCE = ROOT / "native" / "host.py"


class NativeInstallTests(unittest.TestCase):
    def test_brave_uses_shared_macos_registration_and_preserves_origins(self):
        with tempfile.TemporaryDirectory() as temp_home:
            env = dict(os.environ, HOME=temp_home)
            folder = (
                pathlib.Path(temp_home)
                / "Library" / "Application Support" / "Google" / "Chrome"
                / "NativeMessagingHosts"
            )
            manifest_path = folder / "com.media_collector.processor.json"
            host_path = folder / "media_collector_host.py"

            for browser, extension_id in (
                ("brave", "a" * 32),
                ("chrome", "b" * 32),
            ):
                result = subprocess.run(
                    [
                        sys.executable, str(INSTALLER), "--browser", browser,
                        "--extension-id", extension_id,
                    ],
                    env=env,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(str(manifest_path), result.stdout)

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["name"], "com.media_collector.processor")
            self.assertEqual(manifest["type"], "stdio")
            self.assertEqual(manifest["path"], str(host_path))
            self.assertEqual(
                set(manifest["allowed_origins"]),
                {
                    f"chrome-extension://{'a' * 32}/",
                    f"chrome-extension://{'b' * 32}/",
                },
            )
            self.assertEqual(host_path.read_bytes(), HOST_SOURCE.read_bytes())
            self.assertTrue(host_path.stat().st_mode & stat.S_IXUSR)

    def test_rejects_invalid_browser_extension_id_without_writing(self):
        with tempfile.TemporaryDirectory() as temp_home:
            result = subprocess.run(
                [
                    sys.executable, str(INSTALLER), "--browser", "brave",
                    "--extension-id", "invalid-id",
                ],
                env=dict(os.environ, HOME=temp_home),
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("32 letras entre a e p", result.stderr)
            self.assertFalse((pathlib.Path(temp_home) / "Library").exists())


if __name__ == "__main__":
    unittest.main()
