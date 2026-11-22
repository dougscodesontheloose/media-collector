const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

test('post misto enfileira a foto quando a captura do vídeo falha', async () => {
 const article = {
  isConnected:true,
  getAttribute(){return null;},setAttribute(){},removeAttribute(){},
  querySelectorAll(selector){
   if(selector==='a[href*="/status/"]')return [link];
   if(selector==='[role="group"]')return [group];
   if(selector==='[data-testid="tweetPhoto"] img')return [photo];
   if(selector==='[data-testid="videoPlayer"], [data-testid="videoComponent"]')return [player];
   if(selector==='[data-testid="videoPlayer"], [data-testid="videoComponent"],video,[data-testid="tweetPhoto"] img')return [player,video,photo];
   if(selector==='.coletor-x-button')return [];
   return [];
  }
 };
 const link={href:'https://x.com/alice/status/123',querySelector:selector=>selector==='time'?{}:null,closest:()=>article};
 const group={closest:selector=>selector==='article'?article:null,append(button){this.button=button;}};
 const player={parentElement:article,closest:selector=>selector==='article'?article:null,querySelectorAll(selector){
  if(selector==='video')return [video];
  return [];
 }};
 const video={poster:'',currentSrc:'',parentElement:player,closest:selector=>selector==='article'?article:null,
  mediaKeys:true,getBoundingClientRect:()=>({width:400,height:500}),getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
 const photo={currentSrc:'https://pbs.twimg.com/media/photo123.jpg',src:'https://pbs.twimg.com/media/photo123.jpg',
  parentElement:article,closest:selector=>selector==='article'?article:null,getAttribute:()=>null};
 const notices=[];
 const window={listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},removeEventListener(type){this.listeners.delete(type);},
  postMessage(data){if(data.channel==='__mc_traffic_query')queueMicrotask(()=>this.listeners.get('message')?.({source:window,origin:'https://x.com',data:{channel:'__mc_traffic_query_response',id:data.id,media:null}}));}};
 const document={baseURI:'https://x.com/alice/status/123',documentElement:{},body:{append(node){notices.push(node.textContent);}},
  querySelectorAll(selector){return selector==='article'?[article]:[];},querySelector(){return null;},
  createElement(){return{className:'',classList:{contains:()=>false},setAttribute(){},append(){},addEventListener(type,fn){if(type==='click')this.clickHandler=fn;},remove(){}};}};
 const messages=[];
 const C={absolute(raw,base){try{if(typeof raw!=='string'||!raw.trim())return null;const url=new URL(raw,base);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}},key:url=>url,bestSource:url=>url};
 const ctx=vm.createContext({document,window,location:{hostname:'x.com',origin:'https://x.com',href:'https://x.com/alice/status/123'},URL,crypto,
  MediaCore:C,MediaAdapters:{select:()=>({transform:value=>value})},
  MediaInline:{sourceOf:element=>{if(element.mediaKeys)throw Error('Este vídeo usa proteção e não pode ser processado.');return '';},errorMessage:error=>error.message,retry:'Mídia mudou.'},
  MediaCapture:{async startPlayer(){throw Error('Fonte de vídeo indisponível.');}},
  MutationObserver:class{observe(){}},
  chrome:{runtime:{getURL:value=>value,async sendMessage(message){messages.push(message);return{ok:true};}}},
  setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);if(ms>1000)timer.unref();return timer;},clearTimeout});

 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','x-inline.js'),'utf8'),ctx);
 assert.equal(typeof group.button?.clickHandler,'function');
 group.button.clickHandler({isTrusted:true,preventDefault(){},stopPropagation(){}});
 for(let attempt=0;attempt<50&&!messages.some(message=>message.action==='enqueue');attempt++)await new Promise(resolve=>setTimeout(resolve,1));

 const enqueue=messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue,'as fotos encontradas devem ser enfileiradas apesar da falha do vídeo');
 assert.equal(enqueue.items.length,1);
 assert.equal(enqueue.items[0].kind,'image');
 assert.equal(enqueue.items[0].url,photo.currentSrc);
 assert.match(notices.at(-1),/1 foto na fila/);
 assert.match(notices.at(-1),/Vídeo não baixado: Este vídeo usa proteção e não pode ser processado\./);
});

test('X rejeita variante ponte com credenciais embutidas na URL',async()=>{
 const poster='https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg';
 const article={isConnected:true,attrs:{},getAttribute(name){return this.attrs[name]||null;},setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},
  querySelectorAll(selector){
   if(selector==='a[href*="/status/"]')return[link];
   if(selector==='[role="group"]')return[group];
   if(selector==='[data-testid="tweetPhoto"] img')return[];
   if(selector==='[data-testid="videoPlayer"], [data-testid="videoComponent"]')return[player];
   if(selector==='[data-testid="videoPlayer"], [data-testid="videoComponent"],video,[data-testid="tweetPhoto"] img')return[player,video];
   if(selector==='.coletor-x-button')return[];
   return[];
  }};
 const link={href:'https://x.com/alice/status/123',querySelector:selector=>selector==='time'?{}:null,closest:()=>article};
 const group={closest:selector=>selector==='article'?article:null,append(button){this.button=button;}};
 const player={parentElement:article,closest:selector=>selector==='article'?article:null,querySelectorAll(selector){return selector==='video'?[video]:[];}};
 const video={poster,currentSrc:'',src:'',mediaKeys:false,isConnected:true,parentElement:player,
  closest:selector=>selector==='article'?article:null,getBoundingClientRect:()=>({width:400,height:500}),getAttribute:()=>null,
  querySelector:()=>null,querySelectorAll:()=>[]};
 const bridgeMedia={tweetId:'123',poster:'/ext_tw_video_thumb/123/pu/img/poster',url:'https://user:secret@video.twimg.com/ext_tw_video/1/pu/vid/720x1280/video.mp4',format:'direct',duration:3};
 const notices=[],messages=[];let confirmCalls=0,downloadCalls=0;
 const window={listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},removeEventListener(type){this.listeners.delete(type);},
  postMessage(data){if(data.channel==='__mc_traffic_query')queueMicrotask(()=>this.listeners.get('message')?.({source:window,origin:'https://x.com',data:{channel:'__mc_traffic_query_response',id:data.id,media:bridgeMedia}}));}};
 const document={baseURI:'https://x.com/alice/status/123',documentElement:{},body:{append(node){notices.push(node.textContent);}},
  querySelectorAll(selector){return selector==='article'?[article]:[];},querySelector(){return null;},
  createElement(){return{className:'',classList:{contains:()=>false},setAttribute(){},append(){},addEventListener(type,fn){if(type==='click')this.clickHandler=fn;},remove(){}};}};
 const C={absolute(raw,base){try{if(typeof raw!=='string'||!raw.trim())return null;const url=new URL(raw,base);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}},key:url=>url,bestSource:url=>url};
 const ctx=vm.createContext({document,window,location:{hostname:'x.com',origin:'https://x.com',href:'https://x.com/alice/status/123'},URL,crypto,
  MediaCore:C,MediaAdapters:{select:()=>({transform:value=>value})},
  MediaInline:{sourceOf:()=>'',errorMessage:error=>error.message,retry:'Mídia mudou.',async confirm(item){confirmCalls++;return item;}},
  MediaCapture:{async download(){downloadCalls++;throw Error('Fonte de vídeo indisponível.');}},MutationObserver:class{observe(){}},
  chrome:{runtime:{getURL:value=>value,async sendMessage(message){messages.push(message);return message.action==='detected'?{items:[]}:{ok:true};}}},
  setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);if(ms>1000)timer.unref();return timer;},clearTimeout});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','x-inline.js'),'utf8'),ctx);
 assert.equal(typeof group.button?.clickHandler,'function');
 group.button.clickHandler({isTrusted:true,preventDefault(){},stopPropagation(){}});
 for(let attempt=0;attempt<50&&downloadCalls===0&&!messages.some(message=>message.action==='enqueue');attempt++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(confirmCalls,0,'uma URL com credenciais não pode chegar à confirmação da fonte');
 assert.equal(messages.some(message=>message.action==='enqueue'),false);
 assert.equal(downloadCalls,1,'o fluxo deve procurar a fonte no player após rejeitar a variante da ponte');
 assert.match(notices.at(-1),/Fonte de vídeo indisponível/);
});
