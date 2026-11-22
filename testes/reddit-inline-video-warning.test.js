const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('Reddit informa falha do vídeo mesmo quando a foto do post entrou na fila',async()=>{
 const messages=[],notices=[];
 let clickHandler;
 const links=[
  {href:'https://v.redd.it/asset/DASHPlaylist.mpd'},
  {href:'https://i.redd.it/photo.jpg'}
 ];
 const post={isConnected:true,parentElement:null,
  getAttribute(name){return name==='author'?'alice':name==='permalink'?'https://www.reddit.com/r/test/comments/postid/title':null;},
  querySelectorAll(selector){
   if(selector==='a[href]')return links;
   if(selector==='*'||selector==='a[href^="/user/"],a[href^="/u/"]'||selector==='a[href*="/comments/"]'||selector.includes('video'))return [];
   return [];
  },
  querySelector(){return null;},
  append(button){clickHandler=button.clickHandler;}
 };
 const document={documentElement:{},body:{append(node){notices.push(node.textContent);}},
  querySelectorAll(selector){return selector.startsWith('.mc-reddit-')?[]:[post];},
  querySelector(){return null;},
  createElement(){return{setAttribute(){},remove(){},addEventListener(type,fn){if(type==='click')this.clickHandler=fn;}};}
 };
 const window={addEventListener(){}};
 const MediaCore={absolute(raw,base){try{return new URL(raw,base).href;}catch{return null;}},key:url=>url};
 const MediaInline={retry:'A mídia mudou.',errorMessage(error,fallback){return error?.message||fallback;},async confirm(){throw Error('Falha ao processar DASH');}};
 const ctx=vm.createContext({document,window,location:{href:'https://www.reddit.com/r/test/'},URL,MediaCore,MediaInline,
  MutationObserver:class{observe(){}},
  chrome:{runtime:{async sendMessage(message){messages.push(message);return message.action==='detected'?{items:[]}:{ok:true};}}},
  setTimeout(){return 0;},clearTimeout(){}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','reddit-inline.js'),'utf8'),ctx);
 assert.equal(typeof clickHandler,'function');
 clickHandler({isTrusted:true,preventDefault(){},stopPropagation(){}});
 await new Promise(resolve=>setImmediate(resolve));
 const enqueue=messages.find(message=>message.action==='enqueue');
 assert.ok(enqueue);
 assert.equal(enqueue.items.length,1);
 assert.equal(enqueue.items[0].kind,'image');
 assert.match(notices.at(-1),/Vídeo não baixado: Falha ao processar DASH/);
});
