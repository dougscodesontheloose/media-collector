const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const transferKey=(url,output='mp4')=>'sha256:'+crypto.createHash('sha256').update(url+'\n'+output).digest('hex');
const dir = path.join(__dirname,'..');
function harness() {
  const db = {}; const session = {}; const handlers = {}; const entries = new Map(); const notifications=[]; let id=0;
  const event = name => ({addListener: fn => {handlers[name]=fn;}});
  const chrome = {
    webRequest:{onBeforeRequest:event('before'),onHeadersReceived:event('headers')},tabs:{onRemoved:event('removed'),onUpdated:event('updated'),async get(){return{url:'https://news.example/story'};}},
    storage:{session:{async get(key){return {[key]:structuredClone(session[key])};},async set(value){Object.assign(session,structuredClone(value));},async remove(keys){for(const key of (typeof keys==='string'?[keys]:keys))delete session[key];}},local:{async get(keys){return Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in db).map(k=>[k,structuredClone(db[k])]));},async set(value){Object.assign(db,structuredClone(value));},async remove(keys){for(const key of (typeof keys==='string'?[keys]:keys))delete db[key];}}},
    downloads:{onChanged:event('changed'),async download(opt){if(opt.url.includes('/falha')) throw Error('falha simulada'); const n=++id;entries.set(n,{id:n,state:'in_progress',opt});return n;},async search({id}){return entries.has(id)?[entries.get(id)]:[];},async pause(id){entries.get(id).paused=true;},async resume(id){entries.get(id).paused=false;},async cancel(id){entries.get(id).state='interrupted';}},
    action:{onClicked:event('click')},runtime:{onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed'),id:'teste',getURL:path=>'chrome-extension://teste/'+path},scripting:{},windows:{},
    contextMenus:{onClicked:event('contextImage'),create(){}},
    notifications:{async create(options){notifications.push(options);}}
  };
  const context=vm.createContext({chrome,URL,console,structuredClone,crypto,setTimeout,clearTimeout,AbortController,Uint8Array,btoa});
  context.importScripts = (...filenames) => filenames.map(filename=>vm.runInContext(fs.readFileSync(path.join(dir,filename),'utf8'),context,{filename}));
  vm.runInContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),context,{filename:'background.js'});
  const request = (action, extra={}, sender={}) => new Promise(resolve=>handlers.message({target:'worker',action,...extra},sender,resolve));
  const changed = async (number,status) => { entries.get(number).state=status; handlers.changed({id:number,state:{current:status}}); await request('status'); };
  return {context,request,changed,entries,db,session,notifications,chrome,headers:handlers.headers,startup:handlers.startup,contextImage:handlers.contextImage};
}
const item = (n, url=`https://cdn.test/${n}.jpg`) => ({id:`id${n}`,url,available:true,kind:'image',site:'teste',page:'perfil'});
test('confirma fonte de rede somente no documento e quadro observados',async()=>{
 const h=harness(),url='https://cdn.example/stream?id=3';
 h.session['detect:7']=[{url,status:200,mime:'video/mp4',format:'direct',expectedBytes:456,
  page:'https://news.example/story',documentId:'doc-7',frameId:2}];
 h.chrome.scripting.executeScript=async({target})=>[{frameId:2,documentId:target.documentIds[0],
  result:{url:'https://news.example/story',origin:'https://news.example'}}];
 const result=await h.request('observed-source-confirm',{tabId:7,frameId:2,documentId:'doc-7',url},
  {url:'chrome-extension://teste/panel.html'});
 assert.equal(result.kind,'video');assert.equal(result.format,'direct');
 assert.equal(result.origin,'https://cdn.example');assert.equal(result.expectedBytes,456);
 assert.equal(result.frameId,2);assert.equal(result.documentId,'doc-7');
});
test('rejeita fonte sem resposta confirmada, de outro documento ou página antiga',async()=>{
 const h=harness(),url='https://cdn.example/stream.mp4',sender={url:'chrome-extension://teste/panel.html'};
 const record={url,status:200,mime:'video/mp4',page:'https://news.example/story',documentId:'doc-7',frameId:0};
 h.session['detect:7']=[record];
 h.chrome.scripting.executeScript=async({target})=>[{frameId:0,documentId:target.documentIds[0],result:{url:'https://news.example/story',origin:'https://news.example'}}];
 let result=await h.request('observed-source-confirm',{tabId:7,frameId:1,documentId:'doc-7',url},sender);
 assert.match(result.error,/não confirmou/);
 result=await h.request('observed-source-confirm',{tabId:7,frameId:0,documentId:'doc-old',url},sender);
 assert.match(result.error,/não confirmou/);
 h.chrome.scripting.executeScript=async({target})=>[{frameId:0,documentId:target.documentIds[0],result:{url:'https://news.example/other',origin:'https://news.example'}}];
 result=await h.request('observed-source-confirm',{tabId:7,frameId:0,documentId:'doc-7',url},sender);
 assert.match(result.error,/página de origem mudou/);
});
test('rejeita fonte observada com autenticação embutida',async()=>{
 const h=harness(),url='https://user:password@cdn.example/video.mp4';
 h.session['detect:7']=[{url,status:200,mime:'video/mp4',page:'https://news.example/story',documentId:'doc-7',frameId:0}];
 const result=await h.request('observed-source-confirm',{tabId:7,frameId:0,documentId:'doc-7',url},
  {url:'chrome-extension://teste/panel.html'});
 assert.match(result.error,/não confirmou/);
});
test('candidatos avulsos ficam restritos à web geral',async()=>{
 const h=harness(),url='https://cdn.example/video.mp4';
 h.chrome.tabs.get=async()=>({url:'https://www.reddit.com/r/example'});
 h.session['detect:7']=[{url,status:200,mime:'video/mp4',page:'https://news.example/story',documentId:'doc-7',frameId:0}];
 const result=await h.request('observed-source-confirm',{tabId:7,frameId:0,documentId:'doc-7',url},
  {url:'chrome-extension://teste/panel.html'});
 assert.match(result.error,/somente na web geral/);
});
test('histórico de transferências migra URLs assinadas sem alterar a fila', async () => {
  const h=harness();
  const url='https://cdn.test/vídeo.mp4?signature=segredo';
  h.db.transfers={[url+'\nmp4']:{url,itemId:url,output:'mp4',state:'saved',downloadId:42,updatedAt:1}};
  const state=await h.request('status');
  assert.equal(state.transfers[transferKey(url)].downloadId,42);
  assert(!JSON.stringify(h.db.transfers).includes('segredo'));
  assert(!JSON.stringify(h.db.transfers).includes('vídeo.mp4'));
  assert.equal(Object.keys(h.db.transfers).length,1);
});
test('migração e erro concorrentes preservam ambos os registros sem URLs em erros', async () => {
  const h=harness();
  const oldUrl='https://cdn.test/old.mp4?signature=segredo';
  const newUrl='https://cdn.test/new.mp4?token=privado';
  h.db.transfers={[oldUrl+'\nmp4']:{url:oldUrl,output:'mp4',state:'saved',downloadId:42,updatedAt:1}};
  await Promise.all([
    h.request('status',{}, {url:'chrome-extension://teste/panel.html'}),
    h.request('transfer-error',{item:{url:newUrl,kind:'video',output:'mp4'},error:'Falhou '+newUrl},{url:'chrome-extension://teste/panel.html'})
  ]);
  assert.equal(h.db.transfers[transferKey(oldUrl)].state,'saved');
  assert.equal(h.db.transfers[transferKey(newUrl)].state,'failed');
  assert(!JSON.stringify(h.db.transfers).includes('segredo'));
  assert(!JSON.stringify(h.db.transfers).includes('privado'));
});
test('limpar histórico após migração concorrente não recria transferências antigas', async () => {
  const h=harness();
  const url='https://cdn.test/video.mp4?token=privado';
  h.db.transfers={[url+'\nmp4']:{url,output:'mp4',state:'saved',updatedAt:1}};
  await Promise.all([
    h.request('status',{}, {url:'chrome-extension://teste/panel.html'}),
    h.request('history-clear')
  ]);
  assert.equal(h.db.transfers,undefined);
  assert.equal(Object.keys((await h.request('status')).transfers).length,0);
});
test('fila pausa, retoma, registra conclusão e ignora duplicatas salvas', async () => {
  const h=harness(); await h.request('download',{items:[item(1),item(1),item(2)],skip:true,folder:'Fotos'});
  let s=await h.request('status'); assert.equal(s.job.total,2); assert.equal(s.job.current.id,1);
  await h.request('pause'); s=await h.request('status'); assert.equal(s.job.status,'paused'); assert.equal(h.entries.get(1).paused,true);
  await h.changed(1,'complete'); s=await h.request('status'); assert.equal(s.job.done,1); assert.equal(s.job.current,null);
  await h.request('pause'); s=await h.request('status'); assert.equal(s.job.current.id,2);
  await h.changed(2,'complete'); s=await h.request('status'); assert.equal(s.job.status,'finished'); assert.equal(s.job.done,2); assert.equal(s.job.items.length,0); assert.ok(s.history[transferKey('id1','history')]);
  assert(!Object.hasOwn(h.db.history,'id1'));
  const empty=await h.request('download',{items:[item(1)],skip:true}); assert.match(empty.error,/Não há mídias/);
});
test('histórico legado com URL assinada migra para chave opaca e continua ignorando duplicata',async()=>{
 const h=harness(),url='https://cdn.test/private.mp4?signature=segredo';
 const media={...item(1,url),id:url,kind:'video'};h.db.history={[url]:123};
 const state=await h.request('status',{},panelSender);
 assert.equal(state.history[transferKey(url,'history')],123);
 assert(!JSON.stringify(h.db.history).includes('signature'));
 const response=await h.request('download',{items:[media],skip:true});
 assert.match(response.error,/Não há mídias/);
 assert(!JSON.stringify(h.db.history).includes('segredo'));
});
test('menu contextual enfileira a URL exata e notifica uma vez quando autorizado', async () => {
  const h=harness();
  h.db.downloadNotifications=true;
  const srcUrl='https://midia.test/servida?imagem=fox&signature=abc%2Bdef';
  h.contextImage({menuItemId:'media-collector-download-image',srcUrl,frameId:4},{url:'https://pagina.test/artigo'});
  let response=await h.request('status');
  assert.equal(response.job.items[0].url,srcUrl);
  assert.equal(response.job.items[0].site,'pagina.test');
  await h.changed(1,'complete');
  response=await h.request('status');
  assert.equal(response.job.lastDownloadId,1);
  assert.equal(h.notifications.length,1);
  await h.changed(1,'complete');
  assert.equal(h.notifications.length,1);
});
test('menu de vídeo inicia MP4 direto e mantém resultado por arquivo', async () => {
  const h=harness();
  const srcUrl='https://cdn.test/movie.mp4?token=abc%2Bdef';
  h.contextImage({menuItemId:'media-collector-download-video',srcUrl,frameId:3},{url:'https://pagina.test/galeria'});
  let state=await h.request('status');
  assert.equal(state.job.current.direct,true);
  assert.equal(h.entries.get(1).opt.url,srcUrl);
  assert(h.entries.get(1).opt.filename.endsWith('.mp4'));
  const key=transferKey(srcUrl);
  assert.equal(state.transfers[key].state,'downloading');
  await h.changed(1,'complete');
  state=await h.request('status');
  assert.equal(state.transfers[key].state,'saved');
  assert.equal(state.transfers[key].downloadId,1);
});
test('varredura lenta de quadros mantém a fila e o status disponíveis', async () => {
  const h=harness();
  let finishScan;
  h.chrome.scripting.executeScript=()=>new Promise(resolve=>{finishScan=resolve;});
  const sender={url:'chrome-extension://teste/panel.html'};
  h.request('player-scan',{tabId:1},sender);
  await new Promise(resolve=>setTimeout(resolve,0));
  const video={...item(1,'https://cdn.test/movie.mp4'),kind:'video',format:'direct',mp4Direct:true};
  const result=await Promise.race([
    h.request('download',{items:[video]}),
    new Promise(resolve=>setTimeout(()=>resolve({error:'fila bloqueada'}),100))
  ]);
  assert.equal(result.ok,true);
  const status=await h.request('status',{},sender);
  assert.equal(status.job.current.direct,true);
  h.chrome.scripting.executeScript=async()=>[];
  finishScan([]);
});
test('falhas são registradas e cancelamento interrompe a fila', async () => {
  const h=harness(); await h.request('download',{items:[item(1,'https://cdn.test/falha'),item(2),item(3)]});
  let s=await h.request('status'); assert.equal(s.job.failed,1); assert.equal(s.job.current.id,1); assert.match(s.job.errors[0],/falha simulada/);
  await h.request('cancel'); s=await h.request('status'); assert.equal(s.job.status,'cancelled'); assert.equal(s.job.done,0); assert.equal(s.job.items.length,0); assert.equal(h.entries.get(1).state,'interrupted');
});
test('baixa apenas mídias, inclusive ao retomar uma fila anterior com link', async () => {
  const h=harness();
  const postUrl='https://www.instagram.com/p/ABC/';
  const image={...item(1),site:'instagram.com',page:'alice',post:'ABC',postUrl};
  const link={id:'link',url:postUrl,kind:'link',available:true};
  await h.request('download',{items:[image,link]});
  assert.equal(h.db.job.total,1);
  assert.equal(h.entries.get(1).opt.filename,'Media Collector/Instagram/alice-foto-ABC.jpg');
  await h.request('pause');
  h.db.job.items.push(link,item(2));h.db.job.total=3;
  await h.changed(1,'complete');
  await h.request('pause');
  assert.match(h.entries.get(2).opt.filename,/^Media Collector\/Web geral\/teste-foto-[a-f0-9]{8}\.jpg$/);
  await h.changed(2,'complete');
  assert.equal(h.db.job.total,2);
  assert.equal(h.db.job.done,2);
  assert.equal(h.entries.size,2);
});

test('recuperação registra a transferência perdida e continua a fila', async () => {
  const h=harness();
  const video={...item(1,'https://cdn.test/video.mp4'),kind:'video',format:'direct',mp4Direct:true};
  await h.request('download',{items:[video,item(2)]});
  h.entries.delete(1);
  await h.startup();
  const state=await h.request('status');
  assert.equal(state.transfers[transferKey(video.url)].state,'failed');
  assert.equal(state.job.failed,1);
  assert.equal(state.job.current.item.id,'id2');
});

test('recuperação respeita a pausa e libera o cartão de uma conversão perdida', async () => {
  const h=harness();
  const video={...item(1,'https://cdn.test/stream.m3u8'),kind:'video',output:'mp4'};
  h.db.job={status:'paused',items:[video,item(2)],next:1,total:2,failed:0,done:0,
    errors:[],current:{item:video,token:'conversão-interrompida'}};
  await h.startup();
  const state=await h.request('status');
  assert.equal(state.transfers[transferKey(video.url)].state,'failed');
  assert.equal(state.job.status,'paused');
  assert.equal(state.job.current,null);
  assert.equal(h.entries.size,0);
});

test('somente a resposta MP4 do documento e quadro do player confirma o arquivo direto', async () => {
  const h=harness();
  const url='https://cdn.test/media';
  const sender={url:'chrome-extension://teste/panel.html'};
  const req={tabId:10,documentId:'atual',url,player:'player'};
  h.chrome.scripting.executeScript=async()=>[
    {frameId:2,documentId:'atual',result:{valid:true,mp4:false}}
  ];
  const response={url,tabId:10,frameId:2,statusCode:206,
    responseHeaders:[{name:'Content-Type',value:'video/mp4; charset=binary'}]};
  h.headers({...response,documentId:'anterior'});
  await h.request('status');
  assert.equal((await h.request('player-confirm',req,sender)).mp4,false);
  h.headers({...response,documentId:'atual'});
  await h.request('status');
  assert.equal((await h.request('player-confirm',req,sender)).mp4,true);
});

test('uma gravação pode ser retomada sem baixar novamente o vídeo', async () => {
  const h=harness();
  const video={...item(1,'https://cdn.test/video.mp4'),kind:'video',format:'direct',mp4Direct:true};
  let attempts=0;
  h.chrome.runtime.sendNativeMessage=async (host,message)=>{
    assert.equal(host,'com.media_collector.processor');
    if(message.action==='destination-get')
      return {event:'done',destination:'documents',folder:'/Documents/Media Collector/Mídias'};
    assert.equal(message.action,'publish-download');
    assert.equal(message.kind,'video');
    assert.equal(message.category,'Web geral');
    assert.equal(message.destination,'documents');
    assert(message.source.includes(message.id));
    attempts++;
    return attempts===1?{event:'error',error:'Falha ao publicar https://cdn.test/video.mp4?signature=segredo',retryable:true}
      :{event:'done',filename:'/Documents/Media Collector/Mídias/Web geral/'+message.filename};
  };
  await h.request('download',{items:[video]});
  const entry=h.entries.get(1);
  assert.match(entry.opt.filename,/^Media Collector Temporarios\/[a-f0-9-]+\/teste-video-/);
  Object.assign(entry,{filename:'/Downloads/'+entry.opt.filename,byExtensionId:'teste',mime:'video/mp4'});
  await h.changed(1,'complete');
  let s=await h.request('status');
  const key=transferKey(video.url);
  assert.equal(s.job.done,0);
  assert.equal(s.transfers[key].state,'failed');
  assert(!JSON.stringify(h.db.pendingPublications).includes('signature=segredo'));
  assert(!JSON.stringify(h.db.job.errors).includes('signature=segredo'));
  const publicationId=s.transfers[key].publicationId;
  const legacyError='Falha ao publicar https://cdn.test/video.mp4?signature=legada';
  h.db.pendingPublications[publicationId].queueError=legacyError;
  h.db.job.errors=[legacyError];
  const sendNativeMessage=h.chrome.runtime.sendNativeMessage;
  h.chrome.runtime.sendNativeMessage=async(host,message)=>{
    if(message.action==='publish-download'&&attempts===1){
      assert(!JSON.stringify(h.db.pendingPublications).includes('signature=legada'));
      assert(!JSON.stringify(h.db.job.errors).includes('signature=legada'));
    }
    return sendNativeMessage(host,message);
  };
  const result=await h.request('destination-retry',{id:publicationId},{url:'chrome-extension://teste/panel.html'});
  assert(result.filename);
  s=await h.request('status');
  assert.equal(s.job.done,1);
  assert.equal(s.transfers[key].state,'saved');
  assert.equal(s.transfers[key].filename,result.filename);
  assert.deepEqual(s.job.errors,[]);
  assert.equal(h.entries.size,1);
});

test('download direto rejeita HTML e arquivo com tamanho diferente do confirmado', async () => {
  for(const response of [{mime:'text/html',fileSize:102},{mime:'video/mp4',fileSize:51},{mime:'video/mp4',fileSize:102}]){
    const h=harness();
    const video={...item(1,'https://cdn.test/video.mp4'),kind:'video',format:'direct',mp4Direct:true,expectedBytes:100};
    await h.request('download',{items:[video]});
    Object.assign(h.entries.get(1),response);
    await h.changed(1,'complete');
    const state=await h.request('status');
    assert.equal(state.job.done,0);
    assert.equal(state.transfers[transferKey(video.url)].state,'failed');
  }
});

function nativeStreamFixture(h,options={}){
 const sent=[], listeners=new Set(),disconnect=new Set();let count=0;
 const port={onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},onDisconnect:{addListener:f=>disconnect.add(f),removeListener:f=>disconnect.delete(f)},disconnect(){},postMessage(m){
  sent.push(m);if(m.action==='stream-cancel')return;
  if(options.onMessage)options.onMessage(m);
  let reply;if(m.action==='stream-start')reply={event:'stream-ready',offset:0};else if(m.action==='stream-append'){count+=Buffer.from(m.data,'base64').length;reply={event:'stream-ack',offset:count};}else reply={event:'done',filename:'/Documents/Media Collector/Mídias/X.com/video.mp4'};
  if(!options.hold?.(m))queueMicrotask(()=>listeners.forEach(f=>f({id:m.id,...reply})));
 }};
 h.chrome.runtime.connectNative=()=>port;return {port,sent,reply(message){listeners.forEach(f=>f(message));}};
}
async function until(check){for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,1));}throw Error('Operação não terminou');}
function xVideo(){return {...item(1,'https://video.twimg.com/x.mp4'),site:'x.com',kind:'video',format:'direct',mp4Direct:true,expectedBytes:4};}
const folderRequest={destination:{mode:'folder',token:'documents'}};
const panelSender={url:'chrome-extension://teste/panel.html'};
function processedJob(){
 const media={...xVideo(),format:'hls',output:'mp4',destination:{mode:'folder',token:'documents'},expectedBytes:99};
 return {status:'running',items:[media],next:1,done:0,failed:0,errors:[],current:{item:media,index:0,token:'processador',stageId:'12345678-1234-1234-1234-123456789abc'},total:1};
}
test('vídeo processado é transmitido ao destino nativo e libera o blob após confirmar',async()=>{
 const h=harness(),native=nativeStreamFixture(h),messages=[];h.db.job=processedJob();h.chrome.runtime.sendMessage=async msg=>{messages.push(msg);return {ok:true};};
 h.context.fetch=async url=>{assert.equal(url,'blob:chrome-extension://teste/processado');return new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4','content-length':'4'}});};
 const inspection={duration:3,video:true,audio:true,audioExpected:'present'};
 await h.request('stream-ready',{token:'processador',blobUrl:'blob:chrome-extension://teste/processado',extension:'mp4',inspection});
 await until(async()=>((await h.request('status')).job.status==='finished'));
 const s=await h.request('status'),start=native.sent.find(m=>m.action==='stream-start');
 assert.equal(s.job.done,1);assert.equal(h.entries.size,0);assert.equal(start.expectedBytes,4);assert.equal(start.expectedAudio,true);assert.deepEqual(s.job.lastInspection,inspection);assert(messages.some(m=>m.action==='release'));
});
test('blob processado aguarda escolha explícita se fetch falhar antes do início nativo',async()=>{
 const h=harness(),native=nativeStreamFixture(h);h.db.job=processedJob();h.chrome.runtime.sendMessage=async()=>({ok:true});h.context.fetch=async()=>{throw Error('blob indisponível');};
 await h.request('stream-ready',{token:'processador',blobUrl:'blob:chrome-extension://teste/processado',extension:'mp4',inspection:{duration:3,video:true,audio:true}});
 await until(async()=>{const state=await h.request('status');return state.job?.current?.awaitingBrowserFallback===true;});
 assert.equal(h.entries.size,0);assert.equal(native.sent.length,0);
 await h.request('browser-fallback-confirm',{},panelSender);assert.equal(h.entries.size,1);assert.equal(h.entries.get(1).opt.url,'blob:chrome-extension://teste/processado');
});
test('saída somente de áudio valida faixa de áudio no auxiliar',async()=>{
 const h=harness(),native=nativeStreamFixture(h);h.db.job=processedJob();h.chrome.runtime.sendMessage=async()=>({ok:true});h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'audio/mpeg'}});
 await h.request('stream-ready',{token:'processador',blobUrl:'blob:chrome-extension://teste/audio',extension:'mp3',inspection:{duration:3,video:false,audio:true}});
 await until(async()=>((await h.request('status')).job.status==='finished'));const start=native.sent.find(m=>m.action==='stream-start');assert.equal(start.kind,'audio');assert.equal(start.expectedAudio,true);assert.equal((await h.request('status')).job.done,1);
});
test('pausa e retoma enquanto envia blob processado',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-append'});h.db.job=processedJob();h.chrome.runtime.sendMessage=async()=>({ok:true});h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 await h.request('stream-ready',{token:'processador',blobUrl:'blob:chrome-extension://teste/video',extension:'mp4',inspection:{duration:3,video:true,audio:true}});
 await until(()=>native.sent.some(m=>m.action==='stream-append'));await h.request('pause');const chunk=native.sent.find(m=>m.action==='stream-append');native.reply({id:chunk.id,event:'stream-ack',offset:4});await new Promise(r=>setTimeout(r,5));assert(!native.sent.some(m=>m.action==='stream-finish'));await h.request('pause');await until(async()=>((await h.request('status')).job.status==='finished'));assert.equal((await h.request('status')).job.done,1);
});
test('cancelar envio de blob revoga o processador sem finalizar arquivo',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-append'}),messages=[];h.db.job=processedJob();h.chrome.runtime.sendMessage=async msg=>{messages.push(msg);return {ok:true};};
 h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 await h.request('stream-ready',{token:'processador',blobUrl:'blob:chrome-extension://teste/processado',extension:'mp4',inspection:{duration:3,video:true,audio:true}});
 await until(()=>native.sent.some(m=>m.action==='stream-append'));await h.request('cancel');await until(()=>native.sent.some(m=>m.action==='stream-cancel'));
 assert.equal((await h.request('status')).job.status,'cancelled');assert(messages.some(m=>m.action==='release'));assert(!native.sent.some(m=>m.action==='stream-finish'));
});
test('mse-abort durante envio de blob cancela o auxiliar e libera o processador',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-append'}),messages=[];h.db.job=processedJob();h.chrome.runtime.sendMessage=async msg=>{messages.push(msg);return {ok:true};};
 h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 await h.request('stream-ready',{token:'processador',blobUrl:'blob:chrome-extension://teste/video',extension:'mp4',inspection:{duration:3,video:true,audio:true}});
 await until(()=>native.sent.some(m=>m.action==='stream-append'));await h.request('mse-abort',{token:'processador'});await until(()=>native.sent.some(m=>m.action==='stream-cancel'));
 assert.equal((await h.request('status')).job.status,'cancelled');assert(messages.some(m=>m.action==='release'));assert(!native.sent.some(m=>m.action==='stream-finish'));
});
test('mse-abort não confirma cancelamento enquanto auxiliar publica arquivo',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-finish'});h.db.job=processedJob();h.chrome.runtime.sendMessage=async()=>({ok:true});
 h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 await h.request('stream-ready',{token:'processador',blobUrl:'blob:chrome-extension://teste/video',extension:'mp4',inspection:{duration:3,video:true,audio:true}});
 await until(()=>native.sent.some(m=>m.action==='stream-finish'));const reply=await h.request('mse-abort',{token:'processador'});
 assert.match(reply.error,/aguarde/i);assert.equal((await h.request('status')).job.status,'running');
 const finish=native.sent.find(m=>m.action==='stream-finish');native.reply({id:finish.id,event:'done',filename:'/Documents/Media Collector/Mídias/X.com/video.mp4'});
 await until(async()=>((await h.request('status')).job.status==='finished'));assert.equal((await h.request('status')).job.done,1);
});
test('MP4 do X vai ao destino nativo sem criar arquivo em Downloads',async()=>{
 const h=harness(),native=nativeStreamFixture(h);h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4','content-length':'4'}});
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);
 await until(async()=>((await h.request('status')).job.status==='finished'));
 const s=await h.request('status');assert.equal(s.job.done,1);assert.equal(s.job.failed,0);assert.equal(h.entries.size,0);assert(native.sent.some(m=>m.action==='stream-finish'));assert.match(s.job.lastSavedPath,/X\.com/);
});
test('MP4 direto da web geral usa destino nativo sem criar download do navegador',async()=>{
 const h=harness(),native=nativeStreamFixture(h);h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4','content-length':'4'}});
 const media={...xVideo(),url:'https://media.example/video.mp4',site:'Web geral'};
 await h.request('download',{items:[media],...folderRequest},panelSender);
 await until(async()=>((await h.request('status')).job.status==='finished'));
 const start=native.sent.find(m=>m.action==='stream-start'),s=await h.request('status');
 assert.equal(s.job.done,1);assert.equal(h.entries.size,0);assert.equal(start.category,'Web geral');assert.equal(start.kind,'video');
});
test('imagem gravada no destino nativo usa extensão confirmada pelo Content-Type',async()=>{
 const h=harness(),native=nativeStreamFixture(h);
 const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]);
 h.context.fetch=async()=>new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}});
 await h.request('download',{items:[item(77,'https://media.example/image.jpg')],...folderRequest},panelSender);
 await until(async()=>((await h.request('status')).job.status==='finished'));
 const start=native.sent.find(m=>m.action==='stream-start');
 assert.equal(start.kind,'image');assert.equal(start.filename.endsWith('.png'),true);assert.equal(h.entries.size,0);
});
test('falha de fetch antes de iniciar auxiliar aguarda escolha explícita',async()=>{
 const h=harness(),native=nativeStreamFixture(h);h.context.fetch=async()=>{throw Error('network');};
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);
 await until(async()=>{const state=await h.request('status');return state.job?.current?.awaitingBrowserFallback===true;});
 assert.equal(native.sent.length,0);assert.equal(h.entries.size,0);
 await h.request('browser-fallback-confirm',{},panelSender);
 assert.equal(h.entries.size,1);assert.match(h.entries.get(1).opt.filename,/Media Collector Temporarios/);
});
test('cancelar transmissão ao auxiliar mantém fila responsiva e não finaliza arquivo',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-append'});h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);
 await until(()=>native.sent.some(m=>m.action==='stream-append'));
 await h.request('cancel');await until(()=>native.sent.some(m=>m.action==='stream-cancel'));const s=await h.request('status');assert.equal(s.job.status,'cancelled');assert(!native.sent.some(m=>m.action==='stream-finish'));
});
test('pausa mantém a transferência e retomar permite gravar',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-append'});h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);await until(()=>native.sent.some(m=>m.action==='stream-append'));
 await h.request('pause');const chunk=native.sent.find(m=>m.action==='stream-append');native.reply({id:chunk.id,event:'stream-ack',offset:4});await new Promise(r=>setTimeout(r,5));assert(!native.sent.some(m=>m.action==='stream-finish'));assert.equal((await h.request('status')).job.status,'paused');
 await h.request('pause');await until(async()=>((await h.request('status')).job.status==='finished'));assert.equal((await h.request('status')).job.done,1);
});
test('não confirma cancelamento quando auxiliar está finalizando e pode publicar',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-finish'});h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);await until(()=>native.sent.some(m=>m.action==='stream-finish'));
 const pause=await h.request('pause');assert.match(pause.error,/finalizado e validado/);const cancel=await h.request('cancel');assert.match(cancel.error,/finalizado e validado/);let s=await h.request('status');assert.equal(s.job.status,'running');assert.equal(s.job.done,0);assert(!native.sent.some(m=>m.action==='stream-cancel'));
 const finish=native.sent.find(m=>m.action==='stream-finish');native.reply({id:finish.id,event:'done',filename:'/Documents/Media Collector/Mídias/X.com/video.mp4'});await until(async()=>((await h.request('status')).job.status==='finished'));s=await h.request('status');assert.equal(s.job.done,1);assert.equal(s.job.failed,0);
});
function pendingStreamJob(){const item={...xVideo(),output:'mp4',destination:{mode:'folder',token:'documents'}};return {status:'running',items:[item],next:1,done:0,failed:0,errors:[],current:{item,index:0,stageId:'12345678-1234-1234-1234-123456789abc',stream:true,phase:'Finalizando'},total:1};}
test('ao reiniciar, transferência em processamento permanece pendente e depois confirma gravação',async()=>{
 const h=harness();h.db.job=pendingStreamJob();let state='processing';h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:state,...(state==='saved'?{filename:'/Documents/X.com/video.mp4'}:{})});
 h.startup();let s=await h.request('status');assert.equal(s.job.done,0);assert.equal(s.job.current.streamPending,true);assert.match(s.job.current.phase,/Aguardando/);assert.equal(h.entries.size,0);
 state='saved';s=await h.request('status');assert.equal(s.job.status,'finished');assert.equal(s.job.done,1);assert.equal(s.job.lastSavedPath,'/Documents/X.com/video.mp4');assert.equal(h.entries.size,0);
});
test('resultado desconhecido permanece pendente sem repetir download ou declarar cancelamento',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'unknown'});h.startup();let s=await h.request('status');assert.equal(s.job.current.streamPending,true);assert.match(s.job.current.phase,/não confirmado/);const cancel=await h.request('cancel');assert.match(cancel.warning,/não confirmado/);s=await h.request('status');assert.equal(s.job.status,'cancelled');assert.equal(s.job.done,0);assert.match(s.job.errors[0],/pode já existir/);assert.equal(s.job.unresolvedStreams.length,1);assert.equal(h.entries.size,0);
});
test('auxiliar confirma interrupção terminal sem salvar nem repetir download',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'interrupted'});h.startup();const s=await h.request('status');assert.equal(s.job.status,'finished');assert.equal(s.job.failed,1);assert.equal(s.job.done,0);assert.equal(h.entries.size,0);
});
test('reconcilia worker reiniciado no primeiro status mesmo sem evento onStartup',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.db.job.current.streamOwner='worker-antigo';h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'saved',filename:'/Documents/X.com/video.mp4'});
 const s=await h.request('status',{},panelSender);assert.equal(s.job.status,'finished');assert.equal(s.job.done,1);assert.equal(h.entries.size,0);
});
test('saved sem caminho permanece pendente',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'saved'});
 const s=await h.request('status');assert.equal(s.job.done,0);assert.equal(s.job.current.streamPending,true);assert.equal(h.entries.size,0);
});
test('download explícito sem filtro de duplicatas aceita mídia presente no histórico',async()=>{
 const h=harness(),media={...item(1,'https://pbs.twimg.com/media/test.jpg'),site:'x.com'};h.db.history={[media.id]:Date.now()};
 const response=await h.request('enqueue',{items:[media],skip:false});assert.equal(response.ok,true);assert.equal(h.entries.size,1);const state=await h.request('status');assert.equal(state.job.items[0].id,media.id);assert.ok(h.db.history[transferKey(media.id,'history')]);assert.equal(h.db.history[media.id],undefined);
});
test('fila responde ao cancelamento enquanto fetch inicial aguarda resposta',async()=>{
 const h=harness();nativeStreamFixture(h);let fetchAborted=false;
 h.context.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{fetchAborted=true;reject(Error('abort'));},{once:true}));
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);await new Promise(r=>setTimeout(r,0));const result=await h.request('cancel');assert.equal(result.ok,true);await until(()=>fetchAborted);const s=await h.request('status');assert.equal(s.job.status,'cancelled');assert.equal(h.entries.size,0);
});
test('fetch inicial sem resposta não inicia automaticamente o download do navegador',async()=>{
 const h=harness(),native=nativeStreamFixture(h);let aborted=false;h.context.setTimeout=(fn,ms)=>setTimeout(fn,ms===10000?1:ms);h.context.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('abort'));},{once:true}));
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);
 await until(async()=>{const state=await h.request('status');return state.job?.current?.awaitingBrowserFallback===true;});
 assert.equal(aborted,true);assert.equal(native.sent.length,0);assert.equal(h.entries.size,0);
 await h.request('browser-fallback-confirm',{},panelSender);assert.equal(h.entries.size,1);assert.match(h.entries.get(1).opt.filename,/Media Collector Temporarios/);
});
test('Downloads direto fica memorizado e pode ser desmarcado sem usar Save As',async()=>{
 const h=harness();
 h.chrome.runtime.sendNativeMessage=async(_host,message)=>{
  if(message.action==='destination-downloads')return {id:message.id,event:'done',destination:'downloads-token',folder:'/Users/test/Downloads'};
  if(message.action==='destination-get')return {id:message.id,event:'done',destination:'documents',folder:'/Users/test/Documents/Media Collector/Mídias'};
  throw Error('Ação nativa inesperada.');
 };
 const enabled=await h.request('destination-downloads',{enabled:true},panelSender);
 assert.equal(enabled.destination.isDownloads,true);assert.equal(h.db.downloadDestination.folder,'/Users/test/Downloads');
 assert.equal(h.db.downloadDestination.token,'downloads-token');
 await h.request('destination-downloads',{enabled:false},panelSender);
 assert.equal(Object.hasOwn(h.db,'downloadDestination'),false);
});
test('auxiliar que não responde ao consultar status não bloqueia a fila indefinidamente',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.context.setTimeout=(fn,ms)=>setTimeout(fn,ms===5000?1:ms);h.chrome.runtime.sendNativeMessage=()=>new Promise(()=>{});
 const s=await h.request('status');assert.equal(s.job.current.streamPending,true);assert.match(s.job.current.phase,/não confirmado/);const cancel=await h.request('cancel');assert.match(cancel.warning,/não confirmado/);assert.equal((await h.request('status')).job.status,'cancelled');assert.equal(h.entries.size,0);
});
test('auxiliar com processamento confirmado impede encerrar pendência sem confirmação',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'processing'});
 let s=await h.request('status');assert.equal(s.job.current.streamStatus,'processing');const cancel=await h.request('cancel');assert.match(cancel.error,/aguarde/);s=await h.request('status');assert.equal(s.job.status,'running');assert.equal(s.job.done,0);assert.equal(h.entries.size,0);
});
test('reconciliação preserva diagnóstico seguro de duração inválida',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'failed',diagnostic:{phase:'stream-finish',type:'InvalidMedia',message:'A duração do arquivo não corresponde à origem.'}});
 const s=await h.request('status');assert.equal(s.job.failed,1);assert.equal(s.job.errors[0],'A duração do arquivo não corresponde à origem.');assert.equal(h.entries.size,0);
});
test('reconciliação não grava mensagens arbitrárias ou URLs recebidas do auxiliar',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.db.job.current.streamError='https://exemplo.test/video?signature=secret';h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'failed',diagnostic:{message:'https://exemplo.test/video?signature=secret'}});
 const s=await h.request('status');assert.equal(s.job.errors[0],'O auxiliar informou falha na gravação.');assert(!JSON.stringify(s.job.errors).includes('signature'));
});
test('reconciliação recupera erro seguro da transferência anterior ao status',async()=>{
 const h=harness();h.db.job=pendingStreamJob();h.db.job.current.streamError='A verificação de integridade do arquivo falhou.';h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'failed'});
 const s=await h.request('status');assert.equal(s.job.errors[0],'A verificação de integridade do arquivo falhou.');
});
test('erro real recebido no stream é preservado ao consultar status failed sem diagnóstico',async()=>{
 const h=harness(),native=nativeStreamFixture(h,{hold:m=>m.action==='stream-finish'});h.context.fetch=async()=>new Response(Buffer.from('data'),{headers:{'content-type':'video/mp4'}});
 h.chrome.runtime.sendNativeMessage=async (_host,msg)=>({id:msg.id,event:'stream-status',status:'failed'});
 await h.request('download',{items:[xVideo()],...folderRequest},panelSender);await until(()=>native.sent.some(m=>m.action==='stream-finish'));
 const finish=native.sent.find(m=>m.action==='stream-finish');native.reply({id:finish.id,event:'error',error:'A duração do arquivo não corresponde à origem.'});
 await until(async()=>((await h.request('status')).job.status==='finished'));const s=await h.request('status');assert.equal(s.job.errors[0],'A duração do arquivo não corresponde à origem.');assert.equal(s.job.failed,1);assert.equal(h.entries.size,0);
});
