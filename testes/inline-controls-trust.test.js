const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');

test('botões de download injetados exigem evento de clique confiável',()=>{
 assert.match(source('content.js'),/control\.addEventListener\('click',[\s\S]{0,180}if\(!event\.isTrusted\)return;/);
 assert.match(source('instagram-inline.js'),/if\(!e\.isTrusted\|\|collecting\|\|b\.disabled\)return/);
 assert.match(source('reddit-inline.js'),/if\(!event\.isTrusted\)return;download\(button,post\)/);
 assert.match(source('x-inline.js'),/if\(!event\.isTrusted\)return;\s*download\(button,article\)/);
});

test('hover da web aberta não expõe botão por pointermove sintético',()=>{
 assert.match(source('content.js'),/document\.addEventListener\('pointermove',event=>\{\s*if\(!event\.isTrusted\)return;/);
});

test('hover web reduz interferência e exclui miniaturas do YouTube do atalho rápido',()=>{
 assert.match(source('panel.js'),/minimum:imageMinimum\|\|600/);
 assert.match(source('content.js'),/C\.isYouTubePreview\(location\.hostname,item\.url,youtubePreviewContext\(element\)\)/);
 assert.match(source('content.js'),/C\.webEligible\(\{kind:'video',\.\.\.dimensions\},0\)/);
});
