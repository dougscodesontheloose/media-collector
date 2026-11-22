const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('clique explícito no X enfileira novamente uma mídia já vista no histórico',async()=>{
 const listeners=new Map(),messages=[];let onClick;
 const article={isConnected:true,getAttribute(){return null},setAttribute(){},removeAttribute(){},querySelectorAll(sel){
  if(sel==='a[href*="/status/"]')return [link];if(sel==='[role="group"]')return [group];if(sel==='[data-testid="tweetPhoto"] img')return [img];if(sel.includes('[data-testid="videoPlayer"]')&&sel.includes('tweetPhoto'))return [img];return [];
 }};
 const link={href:'https://x.com/alice/status/123',querySelector:s=>s==='time'?{}:null,closest:()=>article};
 const group={closest:s=>s==='article'?article:null,append(btn){onClick=btn.clickHandler}};
 const img={currentSrc:'https://pbs.twimg.com/media/abc.jpg',src:'https://pbs.twimg.com/media/abc.jpg',closest:s=>s==='article'?article:null,getAttribute(){return null}};
 const window={addEventListener(type,fn){listeners.set(type,fn)},removeEventListener(type){listeners.delete(type)},postMessage(data){if(data.channel==='__mc_traffic_query')queueMicrotask(()=>listeners.get('message')?.({source:window,origin:'https://x.com',data:{channel:'__mc_traffic_query_response',id:data.id,media:null}}));}};
 const document={baseURI:'https://x.com/alice/status/123',documentElement:{},body:{append(){}},querySelectorAll(s){return s==='article'?[article]:[]},querySelector(){return null},createElement(tag){return{type:'',className:'',classList:{contains:()=>false},setAttribute(){},append(){},addEventListener(type,fn){if(type==='click')this.clickHandler=fn},remove(){}}}};
 const MediaCore={absolute:url=>{try{return new URL(url).href}catch{return null}},key:url=>url,bestSource:url=>url};
 const ctx=vm.createContext({document,window,location:{hostname:'x.com',origin:'https://x.com',href:'https://x.com/alice/status/123'},URL,crypto,MediaCore,MediaAdapters:{select:()=>({transform:x=>x})},MediaInline:{errorMessage:e=>e.message},MediaCapture:{},MutationObserver:class{observe(){}},chrome:{runtime:{getURL:s=>s,async sendMessage(msg){messages.push(msg);return {ok:true}}}},setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);if(ms>1000)timer.unref();return timer},clearTimeout});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','x-inline.js'),'utf8'),ctx);assert.equal(typeof onClick,'function');
 onClick({isTrusted:false,preventDefault(){},stopPropagation(){}});assert.equal(messages.length,0,'clique sintético não deve iniciar downloads');
 onClick({isTrusted:true,preventDefault(){},stopPropagation(){}});
 for(let i=0;i<30&&!messages.length;i++)await new Promise(r=>setTimeout(r,1));assert.equal(messages.length,1);assert.equal(messages[0].action,'enqueue');assert.equal(messages[0].skip,false);assert.equal(messages[0].items[0].url,img.currentSrc);
});
