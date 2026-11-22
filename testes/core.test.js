const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
test('seleciona a maior alternativa e resolve URLs relativas', () => {
  assert.equal(C.bestSource('/small.jpg','/a.jpg 320w, /b.jpg 1200w','https://site.test/path'), 'https://site.test/b.jpg');
  assert.equal(C.bestSource('/small.jpg','/a.jpg 1x, /b.jpg 2x','https://site.test/'), 'https://site.test/b.jpg');
  assert.equal(C.absolute(undefined,'https://site.test/'),null);
  assert.equal(C.absolute('blob:https://site.test/id','https://site.test/'),null);
});
test('filtros respeitam o tipo e dimensões e não inventam dimensões', () => {
  assert.equal(C.visible({kind:'image',width:1200,height:800},{kind:'image',minWidth:500,minHeight:400}),true);
  assert.equal(C.visible({kind:'image',width:200,height:800},{kind:'image',minWidth:500}),false);
  assert.equal(C.visible({kind:'video',width:0,height:0},{kind:'all',minWidth:500}),false);
  assert.equal(C.visible({kind:'video',width:0,height:0},{kind:'video'}),true);
});
test('limites da web são estritos, ajustáveis para imagens e preservam áudio', () => {
  assert.equal(C.webEligible({kind:'image',width:500,height:900}),false);
  assert.equal(C.webEligible({kind:'image',width:501,height:501}),true);
  assert.equal(C.webEligible({kind:'image',width:300,height:301},100),true);
  assert.equal(C.webEligible({kind:'image',width:1000,height:2000},1000),false);
  assert.equal(C.webEligible({kind:'image',width:1001,height:1001},1000),true);
  assert.equal(C.webEligible({kind:'video',width:500,height:1080},100),false);
  assert.equal(C.webEligible({kind:'video',width:1920,height:1080},1000),true);
  assert.equal(C.webEligible({kind:'video',width:0,height:0}),false);
  assert.equal(C.webEligible({kind:'audio',width:0,height:0}),true);
});
test('nomes são confinados à pasta de downloads e não interpretam caminhos', () => {
  assert.equal(C.filename({site:'x.com',page:'../@teste',kind:'video',url:'https://cdn.test/a.mp4'},0), 'Media Collector/X.com/x.com-video-7547b833.mp4');
  assert.equal(C.key('https://site.test/a.jpg#fragmento'),'https://site.test/a.jpg');
});

test('agrupa cada origem em uma única pasta e usa o perfil só no nome', () => {
  assert.equal(C.filename({site:'www.instagram.com',page:'alice',post:'ABC',kind:'image',url:'https://cdn.test/p.jpg'},0),'Media Collector/Instagram/alice-foto-ABC.jpg');
  assert.equal(C.filename({site:'instagram.com',page:'bruno',post:'DEF',kind:'video',forceExtension:'webm'},1),'Media Collector/Instagram/bruno-video-DEF.webm');
  assert.equal(C.filename({site:'mobile.twitter.com',page:'alice',post:'42',kind:'video'},0),'Media Collector/X.com/alice-video-42.mp4');
  assert.match(C.filename({site:'www.reddit.com',page:'alice',kind:'image',url:'https://i.redd.it/a.gif'},0),/^Media Collector\/Reddit\/alice-gif-[0-9a-f]{8}\.gif$/);
  assert.match(C.filename({site:'notinstagram.com',page:'outro',kind:'image',url:'https://web.test/p.webp'},0),/^Media Collector\/Web geral\/notinstagram\.com-foto-[0-9a-f]{8}\.webp$/);
});

test('nomes permanecem estáveis com URLs assinadas e identificam a posição no carrossel', () => {
  const video={site:'www.site.test',kind:'video',url:'https://cdn.site.test/v/arquivo.mp4?signature=secret'};
  const name=C.basename(video);
  assert.match(name,/^site\.test-video-[0-9a-f]{8}\.mp4$/);
  assert.equal(C.basename({...video,url:'https://cdn.site.test/v/arquivo.mp4?signature=outro#fragment'}),name);
  assert.notEqual(C.basename({...video,url:'https://cdn.site.test/v/outro.mp4'}),name);
  assert.equal(C.basename({site:'instagram.com',page:'alice',post:'ABC-42',mediaPosition:2,kind:'image'}),'alice-foto-ABC-42-2.jpg');
});
