const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));

test('manifest limita a permissão de hosts a HTTP/HTTPS e remove acessos não usados',()=>{
 assert.deepEqual(manifest.host_permissions,['http://*/*','https://*/*']);
 assert.equal(manifest.permissions.includes('activeTab'),false);
 assert.equal(manifest.permissions.some(permission=>['cookies','history','browsingData'].includes(permission)),false);
 for(const script of manifest.content_scripts){
  assert.equal(script.matches.some(pattern=>pattern.startsWith('file:')),false);
 }
});
