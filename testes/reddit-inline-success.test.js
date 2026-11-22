const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function postFor({permalink,links,player=null,author='alice'}){
 const descendants=[...(player?[player]:[]),...links];
 return {
  isConnected:true,
  parentElement:null,
  getAttribute(name){
   if(name==='author')return author;
   if(name==='permalink')return permalink;
   return null;
  },
  querySelectorAll(selector){
   if(selector==='*')return descendants;
   if(selector==='a[href]')return links;
   if(selector==='a[href*="/comments/"]')return links.filter(link=>link.href.includes('/comments/'));
   if(selector==='a[href^="/user/"],a[href^="/u/"]')return [];
   if(selector==='video,shreddit-player,[data-testid="video-player"]')return player?[player]:[];
   return [];
  },
  querySelector(){return null;},
  append(button){this.button=button;}
 };
}

async function activateRedditPost(post,{observations=[],onConfirm=async item=>item}={}){
 const messages=[],notices=[];
 const document={
  documentElement:{},
  body:{append(node){notices.push(node.textContent);}},
  querySelectorAll(selector){return selector.startsWith('.mc-reddit-')?[]:[post];},
  querySelector(){return null;},
  createElement(){return {
   disabled:false,
   setAttribute(){},remove(){},
   addEventListener(type,fn){if(type==='click')this.clickHandler=fn;}
  };}
 };
 const location={href:'https://www.reddit.com/r/test/'};
 const MediaCore={
  absolute(raw,base){try{if(typeof raw!=='string'||!raw.trim())return null;const url=new URL(raw,base);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}},
  key:url=>{const parsed=new URL(url);parsed.hash='';return parsed.href;},
  extension(item){return new URL(item.url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()||(item.kind==='video'?'mp4':'jpg');}
 };
 const confirms=[];
 const MediaInline={
  retry:'A mídia exibida mudou. Passe o mouse novamente e tente baixar.',
  errorMessage(error,fallback){return error?.message||fallback;},
  async confirm(item,current,options){
   assert.equal(current(),true,'a fonte deve continuar ligada ao post atual');
   confirms.push({item,options});
   return onConfirm(item,current,options);
  }
 };
 const ctx=vm.createContext({
  document,window:{addEventListener(){}},location,URL,MediaCore,MediaInline,
  MutationObserver:class{observe(){}},
  chrome:{runtime:{async sendMessage(message){
   messages.push(message);
   if(message.action==='detected')return{items:observations};
   return{ok:true};
  }}},
  setTimeout(){return 0;},clearTimeout(){}
 });
 vm.runInContext(read('reddit-inline.js'),ctx);
 assert.equal(typeof post.button?.clickHandler,'function','o botão individual do post deve ser instalado');
 post.button.clickHandler({isTrusted:true,preventDefault(){},stopPropagation(){}});
 for(let attempt=0;attempt<50&&!messages.some(message=>message.action==='enqueue');attempt++)
  await new Promise(resolve=>setImmediate(resolve));
 return {messages,notices,confirms,extension:MediaCore.extension};
}

function streamToolsWithManifest(manifestUrl,manifestText){
 const context=vm.createContext({
  URL,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,
  fetch:async url=>{
   assert.equal(url,manifestUrl);
   return{ok:true,status:200,text:async()=>manifestText};
  }
 });
 context.globalThis=context;context.window=context;context.self=context;
 vm.runInContext(read('streams.js'),context);
 return context.StreamTools;
}

test('Reddit confirma DASH observado, associa ao post e resolve trilhas separadas de vídeo e áudio',async()=>{
 const postUrl='https://www.reddit.com/r/test/comments/abc123/title/';
 const manifestUrl='https://v.redd.it/redditasset/DASHPlaylist.mpd';
 const post=postFor({permalink:postUrl,links:[{href:'https://v.redd.it/redditasset/'}]});
 const {messages,confirms}=await activateRedditPost(post,{
  observations:[
   {url:'https://v.redd.it/anotherasset/DASHPlaylist.mpd',format:'dash'},
   {url:manifestUrl,format:'dash'}
  ],
  onConfirm:async(item,_current,options)=>({...item,confirmed:true,expectedAudio:true,observed:options.observed})
 });

 const enqueue=messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue,'o vídeo confirmado deve chegar à fila');
 assert.equal(enqueue.items.length,1);
 assert.equal(enqueue.items[0].kind,'video');
 assert.equal(enqueue.items[0].format,'dash');
 assert.equal(enqueue.items[0].url,manifestUrl,'o candidato de outro ID v.redd.it não pode ser associado');
 assert.equal(enqueue.items[0].post,'abc123');
 assert.equal(enqueue.items[0].postUrl,postUrl);
 assert.equal(confirms.length,1);
 assert.equal(confirms[0].options.observed,true);
 assert.equal(confirms[0].options.manifest,'dash');

 const mpd=`<?xml version="1.0"?>
 <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-live:2011">
  <Period id="1" duration="PT4S">
   <AdaptationSet id="video" contentType="video" mimeType="video/mp4" segmentAlignment="true">
    <Representation id="v1" bandwidth="500000" width="640" height="360" codecs="avc1.4d401e">
     <SegmentTemplate timescale="1" initialization="video-init.mp4" media="video-$Number$.m4s" startNumber="1" duration="2"/>
    </Representation>
   </AdaptationSet>
   <AdaptationSet id="audio" contentType="audio" mimeType="audio/mp4" segmentAlignment="true">
    <Representation id="a1" bandwidth="96000" codecs="mp4a.40.2">
     <SegmentTemplate timescale="1" initialization="audio-init.mp4" media="audio-$Number$.m4s" startNumber="1" duration="2"/>
    </Representation>
   </AdaptationSet>
  </Period>
 </MPD>`;
 const tracks=await streamToolsWithManifest(manifestUrl,mpd).resolve(enqueue.items[0].url,'dash');
 assert.equal(tracks.length,2,'DASH com áudio separado deve produzir uma trilha de vídeo e outra de áudio');
 assert.ok(tracks[0].some(part=>part.url.endsWith('/video-1.m4s')));
 assert.ok(tracks[1].some(part=>part.url.endsWith('/audio-1.m4s')));
});

test('GIF do Reddit servido como MP4 entra na fila como vídeo MP4',async()=>{
 const gifMp4='https://v.redd.it/animatedasset/DASH_720.mp4?source=fallback';
 const post=postFor({
  permalink:'https://www.reddit.com/r/test/comments/gif123/animated-post/',
  links:[{href:gifMp4}]
 });
 const {messages,confirms,extension}=await activateRedditPost(post,{
  onConfirm:async item=>item
 });
 const enqueue=messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue);
 assert.equal(enqueue.items.length,1);
 assert.equal(enqueue.items[0].url,gifMp4);
 assert.equal(enqueue.items[0].kind,'video','GIF servido como MP4 não deve virar imagem estática');
 assert.equal(enqueue.items[0].format,'direct');
 assert.equal(extension(enqueue.items[0]),'mp4');
 assert.equal(confirms.length,1);
 assert.equal(Boolean(confirms[0].options.observed),false);
});
