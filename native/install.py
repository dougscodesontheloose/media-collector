#!/usr/bin/env python3
"""Registra o auxiliar local para o navegador e a extensão informados."""
import argparse
import json
import pathlib
import re
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--extension-id', required=True, help='ID exibido na página de extensões')
parser.add_argument('--browser', required=True, choices=['chrome','comet'])
args = parser.parse_args()
if not re.fullmatch('[a-p]{32}', args.extension_id):
    parser.error('O ID da extensão deve conter 32 letras entre a e p.')
base = pathlib.Path.home() / 'Library' / 'Application Support'
# O Comet no macOS consulta o mesmo diretório que o Chrome.
folder = base / 'Google' / 'Chrome' / 'NativeMessagingHosts'
folder.mkdir(parents=True, exist_ok=True)
source = pathlib.Path(__file__).resolve().with_name('host.py')
host = folder / 'media_collector_host.py'
target = folder / 'com.media_collector.processor.json'


def replace_file(target, content, mode):
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as temp:
        path = pathlib.Path(temp.name)
        try:
            temp.write(content)
            temp.flush()
            path.chmod(mode)
            path.replace(target)
        finally:
            path.unlink(missing_ok=True)


origin = f'chrome-extension://{args.extension_id}/'
origins = {origin}
if target.exists():
    previous = json.loads(target.read_text(encoding='utf-8'))
    origins.update(value for value in previous.get('allowed_origins', [])
                   if isinstance(value, str) and re.fullmatch(r'chrome-extension://[a-p]{32}/', value))

# O navegador pode não ter acesso à pasta Documentos no macOS.
replace_file(host, source.read_bytes(), 0o700)
manifest = {
    'name': 'com.media_collector.processor',
    'description': 'Processador local opcional do Media Collector',
    'path': str(host),
    'type': 'stdio',
    'allowed_origins': sorted(origins),
}
replace_file(target, (json.dumps(manifest, indent=2) + '\n').encode('utf-8'), 0o600)
print(f'Registro para {args.browser}:', target)
