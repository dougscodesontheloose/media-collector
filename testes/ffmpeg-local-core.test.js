const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'ffmpeg', 'const.js'), 'utf8');

test('FFmpeg usa o core incluído na extensão como padrão, sem fallback de CDN', () => {
  assert.match(source, /CORE_VERSION\s*=\s*["']0\.12\.10["']/);
  assert.match(source, /CORE_URL\s*=\s*new URL\(["']\.\/ffmpeg-core\.js["'],\s*import\.meta\.url\)\.href/);
  assert.doesNotMatch(source, /https?:\/\//);
});
