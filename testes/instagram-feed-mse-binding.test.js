const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const rect={left:100,top:100,right:500,bottom:500,width:400,height:400};
const videoFixture=source=>({tagName:'VIDEO',currentSrc:source,src:source,isConnected:true,alt:'',mediaKeys:null,
 getBoundingClientRect:()=>rect,closest:()=>null,getAttribute:name=>name==='src'?source:null,
 querySelector:()=>null,querySelectorAll:()=>[]});
const imageFixture=(source,box=rect)=>({tagName:'IMG',currentSrc:source,src:source,isConnected:true,alt:'Publicação',naturalWidth:1080,naturalHeight:1350,
 getBoundingClientRect:()=>box,closest:()=>null,getAttribute:name=>name==='src'?source:null});

function setup({videoSlides,preloadedElements,autoComplete=false,hasSlideIndicator=true,hasDotIndicators=false,unrelatedState=false,nextClickNoop=false}={}){
 let href='https://www.instagram.com/';
 let pathname='/';
 let linkHref='https://www.instagram.com/p/POST_1/';
 let collecting=false;
 videoSlides||=[[videoFixture('blob:instagram-video')]];
 let slideIndex=0,slideAdvances=0,activeVideos=videoSlides[0];
 const allVideos=videoSlides.flat();
 const advanceSlide=()=>{slideIndex++;slideAdvances++;activeVideos=videoSlides[slideIndex]||[];};
 const indicators=videoSlides.map((_,index)=>({
  tagName:'BUTTON',
  getAttribute(name){
   if(name==='aria-label')return `Slide ${index+1} of ${videoSlides.length}`;
   if(name==='aria-current')return index===slideIndex?'true':null;
   if(name==='class')return index===slideIndex?'active':'inactive';
   return null;
  },
  hasAttribute(name){return name==='aria-label'||(name==='aria-current'&&index===slideIndex);},
  getBoundingClientRect(){return {left:280+index*10,top:520,right:288+index*10,bottom:528,width:8,height:8};}
 }));
 const dotIndicators=videoSlides.map((_,index)=>({
  tagName:'BUTTON',isSlideDot:true,
  getAttribute(name){
   if(name==='aria-current')return index===slideIndex?'true':null;
   return null;
  },
  hasAttribute(name){return name==='aria-current'&&index===slideIndex;},
  getBoundingClientRect(){return {left:280+index*10,top:520,right:288+index*10,bottom:528,width:8,height:8};}
 }));
 const unrelatedIndicator={tagName:'BUTTON',getAttribute(name){
  if(name==='aria-label')return 'Current feed item';
  if(name==='aria-current')return slideIndex?'true':null;
  return null;
 },hasAttribute(name){return name==='aria-label'||(name==='aria-current'&&slideIndex>0);},
 getBoundingClientRect(){return {left:280,top:520,right:288,bottom:528,width:8,height:8};}};
 const next={getAttribute:name=>name==='aria-label'?'Next':null,getBoundingClientRect:()=>rect,
  click:()=>{if(!nextClickNoop)advanceSlide();}};
 const link={get href(){return linkHref;},get origin(){return new URL(linkHref).origin;},get pathname(){return new URL(linkHref).pathname;}};
 const scope={isConnected:true,scrollIntoView(){},contains:element=>allVideos.includes(element)||(preloadedElements||[]).includes(element),
  querySelectorAll(selector){
   if(selector==='a[href]')return [link];
   if(selector==='img,video')return preloadedElements||activeVideos;
   if(selector==='video')return activeVideos.filter(el=>el.tagName==='VIDEO');
   if(selector==='button[aria-label]')return slideIndex<videoSlides.length-1?[next]:[];
   if(selector.includes('[aria-current]'))return [
    ...(hasSlideIndicator&&videoSlides.length>1?indicators:[]),
    ...(hasDotIndicators?dotIndicators:[]),
    ...(unrelatedState?[unrelatedIndicator]:[])
   ];
   return [];
  },
  querySelector(selector){return selector==='video'?activeVideos[0]||null:null;}
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
 const captureCalls=[];
 const enqueueCalls=[];
 const MediaInline={retry:'A mídia exibida mudou. Passe o mouse novamente e tente baixar.',errorMessage:error=>error.message,
  sourceOf:video=>video.currentSrc||video.src,
  async confirm(item,current){if(!current())throw Error(this.retry);return item;}};
 const MediaCapture={async download(video,info,format,waitForCompletion,stopped,onWait,onProcessing,ensureCurrent){
  const call={video,info,format,waitForCompletion,stopped,onProcessing,ensureCurrent};captureCalls.push(call);
  enteredPromiseHolder.value(call);
  ensureCurrent();
  if(!autoComplete)await captureGate;
  stopped();
  ensureCurrent();
  onProcessing?.();
  return {ok:true};
 }};
 const context=vm.createContext({document,location:{get href(){return href;},set href(value){href=value;},get pathname(){return pathname;},set pathname(value){pathname=value;},origin:'https://www.instagram.com'},
  URL,MediaCore:{absolute(raw){return /^https?:\/\//i.test(raw||'')?new URL(raw).href:null;},bestSource:raw=>raw,key:raw=>raw},
  MediaInline,MediaCapture,ProfileCollector:{profileUrl:()=>false},ColetorInline:{},
  MutationObserver:class{observe(){}},window:{addEventListener(){}},chrome:{runtime:{async sendMessage(message){if(message.action==='enqueue')enqueueCalls.push(message.items);return {ok:true};}}},
  innerWidth:1200,innerHeight:800,getComputedStyle:el=>({position:'static',display:'block',visibility:'visible',opacity:'1',
   borderTopLeftRadius:el?.isSlideDot?'50%':'0px',backgroundColor:el?.getAttribute?.('aria-current')?'rgb(255, 255, 255)':'rgba(255, 255, 255, 0.3)',color:'rgb(255, 255, 255)'}),
  setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}});
 vm.runInContext(fs.readFileSync(path.join(root,'instagram-inline.js'),'utf8'),context);
 collecting=true;
 let resolveEntered;
 const enteredPromise=new Promise(resolve=>{resolveEntered=resolve;});
 enteredPromiseHolder.value=resolveEntered;
 return {
  context,scope,
  get video(){return activeVideos[0];},
  captureCalls,enqueueCalls,
  get slideAdvances(){return slideAdvances;},
  get linkHref(){return linkHref;},
  set linkHref(value){linkHref=value;},
  setRoute(value,newPath){href=value;pathname=newPath;},
  replaceVideo(){activeVideos=[videoFixture('blob:replacement-video')];allVideos.push(...activeVideos);},
  advanceSlide,
  detachScope(){scope.isConnected=false;},
  enteredPromise,
  releaseCapture
 };
}

test('carrossel usa mídias-filhas já expostas sem avançar slide por slide',async()=>{
 const first=imageFixture('https://cdn.test/post-child-1.jpg');
 const second=imageFixture('https://cdn.test/post-child-2.jpg',{left:1300,top:100,right:1700,bottom:500,width:400,height:400});
 const s=setup({videoSlides:[[first],[second]],preloadedElements:[first,second],autoComplete:true});
 const result=await s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 assert.deepEqual(Array.from(result.items,item=>item.url),[first.src,second.src]);
 assert.deepEqual(Array.from(result.items,item=>item.mediaPosition),[1,2]);
 assert.equal(result.pending.length,0);
 assert.equal(s.captureCalls.length,0);
 assert.equal(s.slideAdvances,0);
});

test('vídeo direto confirmado não impede a captura MSE de outro blob no mesmo slide',async()=>{
 const direct=setup({videoSlides:[[
  // Um vídeo direto verificável e outro player MSE convivem no mesmo post.
  videoFixture('https://cdn.test/direct.mp4'),videoFixture('blob:instagram-mse-1')
 ]],autoComplete:true});
 const result=await direct.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 assert.equal(result.items.length,1);
 assert.equal(result.items[0].url,'https://cdn.test/direct.mp4');
 assert.equal(result.savedVideos,1);
 assert.equal(direct.captureCalls.length,1);
 assert.equal(direct.captureCalls[0].video.currentSrc,'blob:instagram-mse-1');
 assert.equal(direct.captureCalls[0].info.post,'POST_1');
 assert.equal(direct.captureCalls[0].info.mediaPosition,undefined);
 assert.equal(result.pending.length,0);
});

test('deduplica blob no mesmo slide, mas captura URL reutilizada no próximo slide',async()=>{
 const s=setup({videoSlides:[
  [videoFixture('blob:instagram-carousel-player'),videoFixture('blob:instagram-carousel-player')],
  [videoFixture('blob:instagram-carousel-player')]
 ],autoComplete:true});
 const result=await s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 assert.equal(result.savedVideos,2);
 assert.deepEqual(s.captureCalls.map(call=>call.video.currentSrc),['blob:instagram-carousel-player','blob:instagram-carousel-player']);
 assert.deepEqual(s.captureCalls.map(call=>call.info.mediaPosition),[1,2]);
 assert.ok(s.captureCalls.every(call=>call.info.post==='POST_1'));
 assert.equal(result.pending.length,0);
});

test('reconhece avanço pelo indicador quando o mesmo player e a mesma URL blob são reutilizados',async()=>{
 const reused=videoFixture('blob:instagram-reused-player');
 const s=setup({videoSlides:[[reused],[reused]],autoComplete:true});
 const result=await s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 assert.equal(result.savedVideos,2);
 assert.equal(s.captureCalls.length,2);
 assert.equal(s.captureCalls[0].video,s.captureCalls[1].video);
 assert.deepEqual(s.captureCalls.map(call=>call.info.mediaPosition),[1,2]);
 assert.equal(result.pending.length,0);
});

test('reconhece avanço por pontos circulares ativos sem rótulos de slide',async()=>{
 const reused=videoFixture('blob:instagram-reused-player');
 const s=setup({videoSlides:[[reused],[reused]],autoComplete:true,hasSlideIndicator:false,hasDotIndicators:true});
 const result=await s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 assert.equal(result.savedVideos,2);
 assert.deepEqual(s.captureCalls.map(call=>call.info.mediaPosition),[1,2]);
 assert.equal(result.pending.length,0);
});

test('ponto circular inativo não confirma avanço sem mudança do indicador',async()=>{
 const reused=videoFixture('blob:instagram-reused-player');
 const s=setup({videoSlides:[[reused],[reused]],autoComplete:true,hasSlideIndicator:false,hasDotIndicators:true,nextClickNoop:true});
 const result=await s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 assert.equal(result.savedVideos,1);
 assert.equal(s.captureCalls.length,1);
 assert.equal(result.pending.length,1);
 assert.match(result.pending[0].reason,/não foi possível confirmar o próximo item/i);
});

test('aborta MSE se o indicador mudar durante captura do player reutilizado',async()=>{
 const reused=videoFixture('blob:instagram-reused-player');
 const s=setup({videoSlides:[[reused],[reused]]});
 const resultPromise=s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 const capture=await s.enteredPromise;
 s.advanceSlide();
 s.releaseCapture();
 const result=await resultPromise;
 assert.equal(result.savedVideos,0);
 assert.equal(result.items.length,0);
 assert.equal(result.pending.length,1);
 assert.match(result.pending[0].reason,/mídia exibida mudou/i);
});

test('ignora remount idêntico e estado ARIA próximo sem indicador circular',async()=>{
 const s=setup({videoSlides:[
  [videoFixture('blob:instagram-reused-player')],[videoFixture('blob:instagram-reused-player')]
 ],autoComplete:true,hasSlideIndicator:false,unrelatedState:true});
 const result=await s.context.ColetorFeed.collect(()=>{},()=>false,()=>false,'mp4');
 assert.equal(result.savedVideos,1);
 assert.equal(result.pending.length,1);
 assert.match(result.pending[0].reason,/não foi possível confirmar o próximo item/i);
});

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
