const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const context=vm.createContext({URL,Set,Map,BigInt,Number,String,JSON,RegExp});
context.globalThis=context;
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','observed-media.js'),'utf8'),context);
const ObservedMedia=context.ObservedMedia;

function response(overrides={}){
 return {url:'https://cdn.example/media.mp4?token=private',status:200,mime:'video/mp4',
  expectedBytes:123456,page:'https://news.example/story',frameId:0,documentId:'doc-a',...overrides};
}

test('resposta MIME confirmada vira candidato explícito com origem e contexto preservados',()=>{
 const [item]=ObservedMedia.candidates([response()],[],'news.example');
 assert.equal(item.association,'observed-candidate');
 assert.equal(item.available,true);
 assert.equal(item.kind,'video');
 assert.equal(item.format,'direct');
 assert.equal(item.sourceOrigin,'https://cdn.example');
 assert.equal(item.pageOrigin,'https://news.example');
 assert.equal(item.frameId,0);
 assert.equal(item.documentId,'doc-a');
 assert.equal(item.expectedBytes,123456);
 assert.equal(item.url,response().url);
 assert(!item.id.includes('private'));
});

test('MIME permite reconhecer URL sem extensão e classifica áudio separadamente',()=>{
 const item=ObservedMedia.inspect(response({url:'https://cdn.example/stream?id=7',mime:'audio/mpeg'}));
 assert.equal(item.kind,'audio');
 assert.equal(item.format,'direct');
});

test('manifestos HLS e DASH são candidatos como manifestos, não como segmentos',()=>{
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/list',mime:'application/vnd.apple.mpegurl'})).format,'hls');
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/manifest',mime:'application/dash+xml'})).format,'dash');
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/clip.m4s',mime:'video/mp4'})),null);
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/part.ts',mime:'video/mp2t'})),null);
});

test('ignora posters, MIME não confirmado, erros HTTP, intervalos e URLs com credenciais',()=>{
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/poster.jpg',mime:'video/mp4'})),null);
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/file',mime:'application/octet-stream'})),null);
 assert.equal(ObservedMedia.inspect(response({status:403})),null);
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/clip.mp4?range=0-9'})),null);
 assert.equal(ObservedMedia.inspect(response({url:'https://user:pass@cdn.example/clip.mp4'})),null);
 assert.equal(ObservedMedia.inspect(response({mime:'text/html'})),null);
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/clip.mp4',mime:'application/pdf'})),null);
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/clip.mp4',mime:'image/jpeg'})),null);
 assert.equal(ObservedMedia.inspect(response({url:'https://cdn.example/audio.mp3',mime:'video/mp4'})),null);
});

test('não duplica fonte já ligada ao mesmo player nem mistura documentos ou quadros',()=>{
 const source=response();
 const linked={url:source.url,documentId:source.documentId,frameId:source.frameId,association:'player',available:true,kind:'video'};
 assert.equal(ObservedMedia.candidates([source],[linked],'news.example').length,0);
 const otherFrame={...source,frameId:2,documentId:'doc-b'};
 const candidates=ObservedMedia.candidates([source,otherFrame],[linked],'news.example');
 assert.equal(candidates.length,1);
 assert.equal(candidates[0].frameId,2);
 assert.equal(candidates[0].documentId,'doc-b');
});

test('recurso listado pela Performance API sem player associado continua candidato de rede',()=>{
 const source=response({url:'https://cdn.example/fetched.mp4'});
 const performanceEntry={url:source.url,documentId:source.documentId,frameId:source.frameId,format:'direct',page:''};
 const [candidate]=ObservedMedia.candidates([source],[performanceEntry],'news.example');
 assert.ok(candidate);
 assert.equal(candidate.association,'observed-candidate');
 assert.equal(candidate.url,source.url);
});

test('não oferece fontes de player explicitamente marcado como protegido',()=>{
 const source=response();
 const protectedPlayer={url:source.url,documentId:source.documentId,frameId:source.frameId,
  association:'player',available:false,kind:'video',reason:'Player com proteção de mídia.'};
 assert.equal(ObservedMedia.candidates([source],[protectedPlayer],'news.example').length,0);
});
