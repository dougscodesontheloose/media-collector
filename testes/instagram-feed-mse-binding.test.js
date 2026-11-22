const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

function setup(){
 let href='https://www.instagram.com/';
 let pathname='/';
 let activeVideo;
 let linkHref='https://www.instagram.com/p/POST_1/';
 let collecting=false;
 const rect={left:100,top:100,right:500,bottom:500,width:400,height:400};
 const makeVideo=source=>({tagName:'VIDEO',currentSrc:source,src:source,isConnected:true,alt:'',mediaKeys:null,
  getBoundingClientRect:()=>rect,closest:()=>null,getAttribute:name=>name==='src'?source:null,
  querySelector:()=>null,querySelectorAll:()=>[]});
 activeVideo=makeVideo('blob:instagram-video');
 const link={get href(){return linkHref;},get origin(){return new URL(linkHref).origin;},get pathname(){return new URL(linkHref).pathname;}};
 const scope={isConnected:true,scrollIntoView(){},contains:element=>element===activeVideo,
  querySelectorAll(selector){
   if(selector==='a[href]')return [link];
   if(selector==='img,video'||selector==='video')return [activeVideo];
   return [];
  },
  querySelector(selector){return selector==='video'?activeVideo:null;}
 };
 const document={baseURI:'https://www.instagram.com/',documentElement:{},body:{append(){}},
  querySelector:()=>null,
  querySelectorAll(selector){
   if(collecting&&selector==='main article,[role=main] article')return [scope];
   return [];
  },createElement(){throw Error('O scan inicial não deve criar controles de UI no teste.');},
  createElementNS(){throw Error('O scan inicial não deve criar controles de UI no teste.');}
 };
 const enteredPromiseHolder={};
 let releaseCapture;
 const captureGate=new Promise(resolve=>{releaseCapture=resolve;});
 const MediaInline={retry:'A mídia exibida mudou. Passe o mouse novamente e tente baixar.',errorMessage:error=>error.message};
 const MediaCapture={async download(video,info,format,waitForCompletion,stopped,onWait,onProcessing,ensureCurrent){
  enteredPromiseHolder.value({video,info,format,waitForCompletion,stopped,onProcessing,ensureCurrent});
  ensureCurrent();
  await captureGate;
  stopped();
  ensureCurrent();
  onProcessing?.();
  return {ok:true};
 }};
 const context=vm.createContext({document,location:{get href(){return href;},set href(value){href=value;},get pathname(){return pathname;},set pathname(value){pathname=value;},origin:'https://www.instagram.com'},
  URL,MediaCore:{absolute(raw){return /^https?:\/\//i.test(raw||'')?new URL(raw).href:null;},bestSource:raw=>raw,key:raw=>raw},
  MediaInline,MediaCapture,ProfileCollector:{profileUrl:()=>false},ColetorInline:{},
  MutationObserver:class{observe(){}},window:{addEventListener(){}},chrome:{runtime:{async sendMessage(){return {ok:true};}}},
  innerWidth:1200,innerHeight:800,getComputedStyle:()=>({position:'static',visibility:'visible',opacity:'1'}),
  setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}});
 vm.runInContext(fs.readFileSync(path.join(root,'instagram-inline.js'),'utf8'),context);
 collecting=true;
 let resolveEntered;
 const enteredPromise=new Promise(resolve=>{resolveEntered=resolve;});
 enteredPromiseHolder.value=resolveEntered;
 return {
  context,scope,
  get video(){return activeVideo;},
  get linkHref(){return linkHref;},
  set linkHref(value){linkHref=value;},
  setRoute(value,newPath){href=value;pathname=newPath;},
  replaceVideo(){activeVideo=makeVideo('blob:replacement-video');},
  detachScope(){scope.isConnected=false;},
  enteredPromise,
  releaseCapture
 };
}

for(const [name,mutate] of [
 ['rota',s=>s.setRoute('https://www.instagram.com/p/OTHER/','/p/OTHER/')],
 ['post vinculado ao artigo',s=>{s.linkHref='https://www.instagram.com/p/POST_2/';}],
 ['elemento de vídeo',s=>s.replaceVideo()],
 ['vínculo do artigo no DOM',s=>s.detachScope()]
]){
 test(`fallback MSE do feed aborta se mudar ${name} durante a captura`,async()=>{
  const s=setup();
  const resultPromise=s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
  const capture=await s.enteredPromise;
  assert.equal(capture.video,s.video,'a captura deve receber o player selecionado no artigo');
  assert.equal(capture.info.post,'POST_1');
  assert.equal(capture.format,'mp4');
  mutate(s);
  s.releaseCapture();
  const result=await resultPromise;
  assert.equal(result.savedVideos,0,'uma captura invalidada não conta como vídeo salvo');
  assert.equal(result.items.length,0);
  assert.equal(result.pending.length,1);
  assert.match(result.pending[0].reason,/mídia exibida mudou/i);
 });
}
