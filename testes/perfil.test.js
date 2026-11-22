const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function load(href) {
  const u = new URL(href);
  const c = vm.createContext({URL,location:{href,hostname:u.hostname,origin:u.origin,pathname:u.pathname}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','profile.js'),'utf8'),c);
  return c.ProfileCollector;
}
test('aceita somente a grade de um perfil do Instagram', () => {
  assert.equal(load('https://www.instagram.com/perfil/').profileUrl(),true);
  assert.equal(load('https://www.instagram.com/perfil/reels/').profileUrl(),true);
  assert.equal(load('https://www.instagram.com/p/abc/').profileUrl(),false);
  assert.equal(load('https://www.instagram.com/reels/').profileUrl(),false);
  assert.equal(load('https://x.com/perfil/').profileUrl(),false);
});
test('reconhece publicações e rejeita outros links ou domínios', () => {
  const p = load('https://www.instagram.com/perfil/');
  assert.equal(p.matchPost('https://www.instagram.com/perfil/p/abc_12/'),'abc_12');
  assert.equal(p.matchPost('/p/xyz-3/?img_index=2'),'xyz-3');
  assert.equal(p.matchPost('/perfil/reel/xyz/'),'xyz');
  assert.equal(p.matchPost('/reels/xyz/'),'xyz');
  assert.equal(p.matchPost('https://example.org/p/xyz/'),null);
});
