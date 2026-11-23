const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const posterA='https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster-a.jpg';
const posterB='https://pbs.twimg.com/ext_tw_video_thumb/456/pu/img/poster-b.jpg';
const posterC='https://pbs.twimg.com/amplify_video_thumb/456/img/poster-c.jpg';
const bridgeMedia={tweetId:'123',poster:'/ext_tw_video_thumb/123/pu/img/poster-a',
 url:'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/clip.mp4?tag=12',
 format:'direct',duration:12.5,expectedAudio:true};

function setup({confirmMutation=null,detectedItems=[]}={}){
 const listeners=new Map(),messages=[];let request,resolveRequest,confirmCalls=0;
 const requestReady=new Promise(resolve=>{resolveRequest=resolve;});
 const article={isConnected:true,attrs:{},getAttribute(name){return this.attrs[name]||null;},
  setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},
  querySelectorAll(selector){
   if(selector==='a[href*="/status/"]')return[link];
   if(selector==='[role="group"]')return[seekbar,group];
   if(selector==='[data-testid="tweetPhoto"] img')return[];
   if(selector==='[data-testid="videoPlayer"], [data-testid="videoComponent"]')return[player];
   if(selector==='[data-testid="videoPlayer"], [data-testid="videoComponent"],video,[data-testid="tweetPhoto"] img')return[player,video];
   if(selector==='.coletor-x-button')return[];
   return[];
  }};
 const link={href:'https://x.com/alice/status/123',querySelector:selector=>selector==='time'?{}:null,
  closest:selector=>selector==='article'?article:null};
 const group={closest:selector=>selector==='article'?article:null,
  getBoundingClientRect:()=>({left:100,top:620,right:500,bottom:640,width:400,height:20}),append(button){this.button=button;}};
 const seekbar={closest:selector=>selector==='article'?article:null,
  getBoundingClientRect:()=>({left:110,top:550,right:490,bottom:574,width:380,height:24}),append(button){this.button=button;}};
 const player={isConnected:true,closest:selector=>selector==='article'?article:null,
  querySelectorAll(selector){return selector==='video'?[video]:[];}};
 const video={poster:posterA,currentSrc:'',src:'',duration:12.5,videoWidth:720,videoHeight:1280,mediaKeys:null,isConnected:true,
  closest:selector=>selector==='article'?article:null,
  getBoundingClientRect:()=>({left:100,top:100,right:500,bottom:600,width:400,height:500}),getAttribute:()=>null,
  querySelectorAll:()=>[]};
 const window={addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
  removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(current=>current!==fn));},
  postMessage(data){if(data.channel==='__mc_traffic_query'){request=data;resolveRequest(data);}}};
 const notices=[];
 const document={baseURI:'https://x.com/home',documentElement:{},body:{append(node){notices.push(node.textContent);}},
  querySelectorAll(selector){if(selector==='article')return[article];return[];},querySelector(){return null;},
  createElement(){return{className:'',classList:{contains:()=>false},setAttribute(){},append(){},
   addEventListener(type,fn){if(type==='click')this.clickHandler=fn;},remove(){}};}};
 const Core={absolute(raw,base){try{if(typeof raw!=='string'||!raw.trim())return null;const url=new URL(raw,base);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}},
  key:url=>url,bestSource:()=>null};
 const context=vm.createContext({document,window,location:{hostname:'x.com',origin:'https://x.com',href:'https://x.com/home'},
  URL,crypto,MediaCore:Core,MediaAdapters:{select:()=>({transform:value=>value})},
  MediaInline:{retry:'Mídia mudou durante a captura.',errorMessage:error=>error.message,sourceOf:()=>'',
   async confirm(item,current){confirmCalls++;if(!current())throw Error('Mídia mudou antes da confirmação.');
    if(confirmMutation)confirmMutation(video,link,article);return item;}},
  MediaCapture:{},MutationObserver:class{observe(){}},
  chrome:{runtime:{getURL:value=>value,async sendMessage(message){messages.push(message);return message.action==='detected'?{items:detectedItems}:{ok:true};}}},
  setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);if(ms>1000)timer.unref();return timer;},clearTimeout});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','x-inline.js'),'utf8'),context);
 assert.equal(typeof group.button?.clickHandler,'function','botão do post deve ser instalado');
 group.button.clickHandler({isTrusted:true,preventDefault(){},stopPropagation(){}});
 return{article,group,seekbar,link,video,requestReady,listeners,messages,notices,getRequest:()=>request,
  confirmCalls:()=>confirmCalls,reply(media){const event={source:window,origin:'https://x.com',data:{
   channel:'__mc_traffic_query_response',id:request.id,media}};
   for(const fn of listeners.get('message')||[])fn(event);}};
}

async function waitForOutcome(h){
 for(let attempt=0;attempt<100&&!h.messages.some(message=>message.action==='enqueue')&&!h.notices.length;attempt++)
  await new Promise(resolve=>setTimeout(resolve,1));
}

test('X enfileira o vídeo da ponte quando post, player e poster permanecem iguais',async()=>{
 const h=setup();await h.requestReady;h.reply(bridgeMedia);await waitForOutcome(h);
 const enqueue=h.messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue,`vídeo confirmado deve entrar na fila; aviso=${h.notices.at(-1)||'nenhum'}, confirmações=${h.confirmCalls()}`);
 assert.equal(enqueue.items.length,1);
 assert.equal(enqueue.items[0].kind,'video');
 assert.equal(enqueue.items[0].url,bridgeMedia.url);
 assert.notEqual(enqueue.items[0].url,posterA);
 assert.equal(h.confirmCalls(),1,`aviso=${h.notices.at(-1)||'nenhum'}`);
});

test('X escolhe manifesto HLS do poster quando as fontes MP4 observadas são fragmentos MSE',async()=>{
 const low={id:'low',kind:'video',url:'https://video.twimg.com/amplify_video/456/vid/avc1/0/0/320x568/low.mp4',format:'direct',status:200};
 const high={id:'high',kind:'video',url:'https://video.twimg.com/amplify_video/456/vid/avc1/0/0/720x1280/high.mp4',format:'direct',status:200};
 const audio={id:'audio',kind:'audio',url:'https://video.twimg.com/amplify_video/456/aud/mp4a/0/0/128000/audio.mp4',format:'direct',status:200,expectedBytes:786};
 const videoRendition={id:'rendition',kind:'video',url:'https://video.twimg.com/amplify_video/456/pl/avc1/720x1280/index.m3u8',format:'hls',status:200};
 const audioRendition={id:'audio-rendition',kind:'audio',url:'https://video.twimg.com/amplify_video/456/pl/mp4a/128000/index.m3u8',format:'hls',status:200};
 const hls={id:'hls',kind:'video',url:'https://video.twimg.com/amplify_video/456/pl/master.m3u8',format:'hls',status:200};
 const h=setup({detectedItems:[low,high,audio,videoRendition,audioRendition,hls]});
 h.video.poster=posterC;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 const enqueue=h.messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue,`manifesto HLS do player deve entrar na fila; aviso=${h.notices.at(-1)||'nenhum'}`);
 assert.equal(enqueue.items.length,1);
 assert.equal(enqueue.items[0].url,hls.url);
 assert.equal(enqueue.items[0].kind,'video');
 assert.equal(h.confirmCalls(),1);
});

test('X aceita uma playlist de rendition isolada para validação posterior pelo resolvedor',async()=>{
 const nested={id:'rendition',kind:'video',url:'https://video.twimg.com/amplify_video/456/pl/avc1/720x1280/index.m3u8',format:'hls',status:200};
 const h=setup({detectedItems:[nested]});h.video.poster=posterC;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 const enqueue=h.messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue,`playlist única deve ser enviada ao resolvedor; aviso=${h.notices.at(-1)||'nenhum'}`);
 assert.equal(enqueue.items[0].url,nested.url);
});

test('X mantém MP4 direto associado ao poster quando a URL não é endpoint MSE ambíguo',async()=>{
 const direct={id:'direct',kind:'video',url:'https://video.twimg.com/amplify_video/456/vid/720x1280/complete.mp4',format:'direct',status:200};
 const h=setup({detectedItems:[direct]});h.video.poster=posterC;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 const enqueue=h.messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue,`MP4 completo observado deve entrar na fila; aviso=${h.notices.at(-1)||'nenhum'}`);
 assert.equal(enqueue.items[0].url,direct.url);
 assert.equal(h.confirmCalls(),1);
});

test('X aceita endpoint MP4 ambíguo quando a resposta observada confirma tamanho completo',async()=>{
 const direct={id:'direct',kind:'video',url:'https://video.twimg.com/amplify_video/456/vid/avc1/0/0/720x1280/complete.mp4',format:'direct',status:200,expectedBytes:800000};
 const h=setup({detectedItems:[direct]});h.video.poster=posterC;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 const enqueue=h.messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue,`resposta completa deve poder ser usada; aviso=${h.notices.at(-1)||'nenhum'}`);
 assert.equal(enqueue.items[0].url,direct.url);
 assert.equal(enqueue.items[0].duration,12.5,'a duração do player habilita a validação de integridade');
});

test('X rejeita endpoint MP4 ambíguo com tamanho observado mas sem duração do player',async()=>{
 const direct={id:'direct',kind:'video',url:'https://video.twimg.com/amplify_video/456/vid/avc1/0/0/720x1280/complete.mp4',format:'direct',status:200,expectedBytes:800000};
 const h=setup({detectedItems:[direct]});h.video.poster=posterC;h.video.duration=NaN;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false);
 assert.equal(h.confirmCalls(),0);
});

test('X ignora playlist HLS de faixa de áudio quando ela é a única fonte observada',async()=>{
 const audio={id:'audio-rendition',kind:'audio',url:'https://video.twimg.com/amplify_video/456/pl/mp4a/128000/index.m3u8',format:'hls',status:200};
 const h=setup({detectedItems:[audio]});h.video.poster=posterC;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false);
 assert.equal(h.confirmCalls(),0);
});

test('X rejeita uma resposta da ponte que aponta para uma playlist HLS de áudio',async()=>{
 const audio={...bridgeMedia,url:'https://video.twimg.com/amplify_video/123/pl/mp4a/128000/index.m3u8',format:'hls'};
 const h=setup();await h.requestReady;h.reply(audio);await waitForOutcome(h);
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false);
 assert.equal(h.confirmCalls(),0);
});

test('X não escolhe entre vários manifestos associados ao mesmo poster',async()=>{
 const first={id:'hls-a',kind:'video',url:'https://video.twimg.com/amplify_video/456/pl/a.m3u8',format:'hls',status:200};
 const second={id:'hls-b',kind:'video',url:'https://video.twimg.com/amplify_video/456/pl/b.m3u8',format:'hls',status:200};
 const h=setup({detectedItems:[first,second]});h.video.poster=posterC;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false,'fontes HLS ambíguas não devem ser presumidas equivalentes');
 assert.equal(h.confirmCalls(),0);
});

test('X rejeita MP4 de inicialização recebido pela ponte como se fosse arquivo completo',async()=>{
 const incomplete={...bridgeMedia,url:'https://video.twimg.com/amplify_video/123/vid/avc1/0/0/720x1280/init.mp4'};
 const h=setup();await h.requestReady;h.reply(incomplete);await waitForOutcome(h);
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false,'fragmento não deve entrar na fila');
 assert.equal(h.confirmCalls(),0,'fragmento não pode ser confirmado como vídeo completo');
});

test('X não escolhe variante MP4 se o player não fornece dimensões para desambiguar',async()=>{
 const first={id:'first',kind:'video',url:'https://video.twimg.com/amplify_video/456/vid/avc1/0/0/320x568/first.mp4',format:'direct'};
 const second={id:'second',kind:'video',url:'https://video.twimg.com/amplify_video/456/vid/avc1/0/0/720x1280/second.mp4',format:'direct'};
 const h=setup({detectedItems:[first,second]});
 h.video.poster=posterC;h.video.videoWidth=0;h.video.videoHeight=0;
 await h.requestReady;h.reply(null);await waitForOutcome(h);
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false);
 assert.equal(h.confirmCalls(),0,'variantes ambíguas não chegam à confirmação');
});

test('X coloca o botão na barra de ações, não na barra de busca do player',()=>{
 const h=setup();
 assert.ok(h.group.button,'botão do post deve ser inserido no grupo de ações fora da mídia');
 assert.equal(h.seekbar.button,undefined,'barra de busca do player não deve receber o botão');
});

test('X descarta resposta da ponte se o artigo virtualizado muda de post',async()=>{
 const h=setup();await h.requestReady;h.link.href='https://x.com/bob/status/456';h.reply(bridgeMedia);await waitForOutcome(h);
 assert.equal(h.confirmCalls(),0,'post diferente não pode chegar à confirmação');
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false,'não pode enfileirar vídeo do post anterior');
});

test('X descarta resposta da ponte se o poster do player muda durante a consulta',async()=>{
 const h=setup();await h.requestReady;h.video.poster=posterB;h.reply(bridgeMedia);await waitForOutcome(h);
 assert.equal(h.confirmCalls(),0,'poster diferente não pode chegar à confirmação');
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false,'não pode enfileirar vídeo de outro poster');
});


test('X revalida post e poster depois da confirmação assíncrona',async()=>{
 const h=setup({confirmMutation(video){video.poster=posterB;}});await h.requestReady;h.reply(bridgeMedia);await waitForOutcome(h);
 assert.equal(h.confirmCalls(),1);
 assert.equal(h.messages.some(message=>message.action==='enqueue'),false,'mudança durante confirmação invalida a captura');
});
