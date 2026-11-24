importScripts('core.js','adapters.js','observed-media.js');
importScripts('native-stream.js');
let chain=Promise.resolve();const serial=fn=>{let next=chain.then(fn);chain=next.catch(()=>{});return next;};
let nativePort=null;
let nativeStreamControl=null;
const workerInstance=crypto.randomUUID();
const overlayPorts=new Map();
const downloadFilenames=new Map();
const mediaIndicators=new Map();
const networkIndicators=new Set();
const knownFrames=new Map();
chrome.runtime.onConnect?.addListener(port=>{
 if(port.name!=='media-collector-web-overlay'||!port.sender?.url?.startsWith(chrome.runtime.getURL('')))return;
 let activeTab=null;
 function updateTab(id){
  if(!Number.isInteger(id))return;
  const peers=[...overlayPorts.values()].filter(entry=>entry.tabId===id&&entry.enabled);
  const current=peers.at(-1);
  chrome.tabs.sendMessage(id,{target:'collector',action:'web-overlay-settings',...current,enabled:!!current}).catch(()=>{});
 }
 port.onMessage.addListener(message=>{
  if(!Number.isInteger(message?.tabId)||![0,100,200,400,600,800,1000,1001].includes(message.minimum))return;
  const previous=activeTab;activeTab=message.tabId;
  const validDimension=n=>Number.isFinite(n)&&n>=0?n:0;
  overlayPorts.set(port,{tabId:activeTab,enabled:message.enabled===true,minimum:message.minimum,minWidth:validDimension(message.minWidth),minHeight:validDimension(message.minHeight),includeInterface:message.includeInterface===true,originals:Array.isArray(message.originals)?message.originals.slice(0,200):[]});
  if(previous!==activeTab)updateTab(previous);
  updateTab(activeTab);
 });
 port.onDisconnect.addListener(()=>{overlayPorts.delete(port);updateTab(activeTab);});
});
const collectorFiles=['core.js','adapters.js','profile.js','inline-source.js','content.js'];
async function connectCollector(tabId,framesOnly=false){
 const tab=await chrome.tabs.get(tabId);
 if(!/^https?:/i.test(tab.url||''))throw Error('Abra uma página da web para conectar o painel.');
 const web=MediaAdapters.select(new URL(tab.url).hostname).id==='generic';
 if(!framesOnly)await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:collectorFiles});
 if(web)await runInAccessibleFrames(tabId,{files:collectorFiles});
}
async function runInAccessibleFrames(tabId,script){
 const top=()=>chrome.scripting.executeScript({target:{tabId,frameIds:[0]},...script}).catch(()=>[]);
 try{
  const frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},...script});
  return frames.some(frame=>frame.frameId===0)?frames:[...await top(),...frames];
 }catch{
  const ids=new Set([0,...(knownFrames.get(tabId)||[])]);
  const results=await Promise.all([...ids].map(frameId=>
   chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},...script}).catch(()=>[])));
  return results.flat();
 }
}
let transferChain=Promise.resolve();
const transferSerial=fn=>{const next=transferChain.then(fn);transferChain=next.catch(()=>{});return next;};
let historyChain=Promise.resolve();
const historySerial=fn=>{const next=historyChain.then(fn);historyChain=next.catch(()=>{});return next;};
const historyKey=id=>MediaNativeStream.transferKey(String(id),'history');
const isHistoryKey=id=>/^sha256:[a-f\d]{64}$/i.test(id);
async function readHistoryUnlocked(){
 const {history={}}=await chrome.storage.local.get(['history']);
 const cleaned={};let changed=false;
 for(const [id,value] of Object.entries(history)){
  const key=isHistoryKey(id)?id:historyKey(id);
  if(key!==id)changed=true;
  if(cleaned[key]===undefined||Number(value)>Number(cleaned[key]))cleaned[key]=value;
 }
 if(changed)await chrome.storage.local.set({history:cleaned});
 return cleaned;
}
const readHistory=()=>historySerial(readHistoryUnlocked);
const markHistory=item=>historySerial(async()=>{
 const history=await readHistoryUnlocked();
 history[historyKey(item.id)]=Date.now();
 await chrome.storage.local.set({history});
});
const historyHas=(history,item)=>!!(history[historyKey(item.id)]||history[item.id]);
const get=async()=>{const {job}=await chrome.storage.local.get(['job']);return{job,history:await readHistory()};};
const redactTransferError=value=>typeof value==='string'?value.replace(/https?:\/\/[^\s]+/gi,'[endereço omitido]'):value;
async function getTransfers(){
 const {transfers={}}=await chrome.storage.local.get(['transfers']);
 const cleaned={};let changed=false;
 for(const [oldKey,entry] of Object.entries(transfers)){
  if(!entry||typeof entry!=='object'){changed=true;continue;}
  const split=oldKey.lastIndexOf('\n');
  const source=entry.url||(split>=0?oldKey.slice(0,split):null);
  const key=source?MediaNativeStream.transferKey(source,entry.output||(split>=0?oldKey.slice(split+1):'mp4')):oldKey;
  const {url,itemId,...safe}=entry;
  if(typeof safe.error==='string'){
   const redacted=redactTransferError(safe.error);if(redacted!==safe.error)changed=true;safe.error=redacted;
  }
  if(key!==oldKey||url!==undefined||itemId!==undefined)changed=true;
  if(!cleaned[key]||(safe.updatedAt||0)>(cleaned[key].updatedAt||0))cleaned[key]=safe;
 }
 if(changed)await chrome.storage.local.set({transfers:cleaned});
 return cleaned;
}
async function recordTransfer(item,state,extra={}){
 if(item.kind!=='video'&&item.kind!=='audio')return;
 return transferSerial(async()=>{
 const transfers=await getTransfers();
 const key=MediaNativeStream.transferKey(item.url,item.output);
 const phase={queued:'Na fila',saved:'Salvo',failed:'Falhou',cancelled:'Cancelado'}[state];
 const reset=state==='queued'?{bytes:0,totalBytes:0,completed:0,total:0,publicationId:null,filename:null}:{};
 const safeExtra={...extra};if(typeof safeExtra.error==='string')safeExtra.error=redactTransferError(safeExtra.error);
 transfers[key]={...transfers[key],...reset,...(phase?{phase}:{}),output:item.output||'mp4',state,updatedAt:Date.now(),...safeExtra};
 const recent=Object.fromEntries(Object.entries(transfers).sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,100));
 await chrome.storage.local.set({transfers:recent});
 });
}
async function save(job){
 if(Array.isArray(job.errors))job.errors=job.errors.map(redactTransferError);
 if(['finished','cancelled'].includes(job.status)&&!job.current)job.items=[];
 if(job.current){
  const current=job.current;
  await recordTransfer(current.item,job.status==='paused'?'paused':current.id?'downloading':'processing',{
   phase:current.phase,downloadId:current.id,bytes:current.bytes||0,totalBytes:current.totalBytes||0,
   completed:current.completed||0,total:current.total||0,error:null});
 }

 const finished=job.status==='finished'&&!job.notified&&(job.done||job.failed);
 if(finished)job.notified=true;
 await chrome.storage.local.set({job});
 if(finished&&chrome.notifications){
  const settings=await chrome.storage.local.get('downloadNotifications');
  if(settings.downloadNotifications)await chrome.notifications.create({
   type:'basic',iconUrl:chrome.runtime.getURL('assets/icon-128.png'),title:'Fila do Media Collector concluída',
   message:job.done+' arquivo(s) salvo(s), '+job.failed+' falha(s).'
  }).catch(()=>{});
 }
}
function refreshMediaBadge(tabId){
 const count=[...(mediaIndicators.get(tabId)?.values()||[])].reduce((sum,value)=>sum+value,0);
 const observed=networkIndicators.has(tabId);
 const text=count?(count>9?'9+':String(count)):observed?'•':'';
 chrome.action.setBadgeBackgroundColor?.({tabId,color:'#75020f'}).catch(()=>{});
 chrome.action.setBadgeText?.({tabId,text}).catch(()=>{});
 chrome.action.setTitle?.({tabId,title:count?'Media Collector · mídia detectada':
  observed?'Media Collector · fonte de mídia observada':'Media Collector'}).catch(()=>{});
}
const err=e=>e?.message||String(e||'Erro desconhecido');
const sessionKey=id=>`detect:${id}`;
async function remember(detail,format){
 if(detail.tabId<0||!format)return;
 const key=sessionKey(detail.tabId),data=await chrome.storage.session.get(key),list=data[key]||[];
 const previous=list.findIndex(item=>item.url===detail.url&&item.documentId===detail.documentId&&item.frameId===detail.frameId);
 const entry={url:detail.url,format,at:Date.now(),page:detail.documentUrl||'',
  frameId:detail.frameId,documentId:detail.documentId,status:detail.statusCode,mime:detail.mime,expectedBytes:detail.expectedBytes,mediaKind:mediaKind(detail.url,detail.mime)};
 if(previous>=0){
  if(!detail.statusCode)return;
  list.splice(previous,1);
 }
 list.push(entry);
 await chrome.storage.session.set({[key]:list.slice(-100)});
}
function mediaKind(url,mime=''){
 if(/^audio\//i.test(mime))return 'audio';
 return /\.(?:mp3|m4a|aac|wav|ogg|flac|opus)(?:[?#]|$)/i.test(url)?'audio':'video';
}
function classify(url,type=''){
 try{
  const u=new URL(url),path=u.pathname.toLowerCase(),q=u.search.toLowerCase();
  if(/\.(m4s|ts|cmfv|cmfa)$/.test(path))return null;
  if(path.endsWith('.m3u8')||/mpegurl/i.test(type))return 'hls';
  if(path.endsWith('.mpd')||/dash\+xml/i.test(type))return 'dash';
  if(/\.(mp4|m4v|webm|mov|ogv|mkv|mp3|m4a|aac|wav|ogg|flac|opus)$/.test(path)||/^(video|audio)\//i.test(type)){
   if(!/(?:range|bytestart|byteend)=/.test(q))return 'direct';
  }
 }catch{}
 return null;
}
function observeMedia(details,mime=''){
 const format=classify(details.url,mime);
 if(!format||details.tabId<0)return;
 if(!networkIndicators.has(details.tabId)){
  networkIndicators.add(details.tabId);refreshMediaBadge(details.tabId);
 }
 serial(()=>remember({...details,mime},format));
}
chrome.webRequest.onBeforeRequest.addListener(d=>observeMedia(d),{urls:['<all_urls>']});
chrome.webRequest.onHeadersReceived.addListener(details=>{
 const headers=details.responseHeaders||[];
 const value=name=>headers.find(header=>header.name.toLowerCase()===name)?.value;
 const range=/^bytes \d+-\d+\/(\d+)$/i.exec(value('content-range')||'');
 const length=details.statusCode===200&&!value('content-encoding')&&value('content-length');
 const expectedBytes=Number(range?.[1]||length);
 observeMedia({...details,expectedBytes:Number.isSafeInteger(expectedBytes)&&expectedBytes>0?expectedBytes:undefined},value('content-type'));
},{urls:['<all_urls>']},['responseHeaders']);
function clearMediaSignals(tabId){
 mediaIndicators.delete(tabId);networkIndicators.delete(tabId);knownFrames.delete(tabId);
 return chrome.storage.session.remove([sessionKey(tabId),'web-capture:'+tabId]);
}
chrome.tabs.onRemoved.addListener(tabId=>clearMediaSignals(tabId));
chrome.tabs.onUpdated.addListener((tabId,change)=>{
 if(change.status==='loading'){
  mediaIndicators.delete(tabId);networkIndicators.delete(tabId);knownFrames.delete(tabId);
  refreshMediaBadge(tabId);
  serial(()=>chrome.storage.session.remove([sessionKey(tabId),'web-capture:'+tabId]));
 }
});
async function processor(msg){return chrome.runtime.sendMessage({target:'processor',...msg});}
async function ensureProcessor(){if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({url:'processor.html',reasons:['BLOBS'],justification:'Reunir localmente segmentos de vídeo e criar o arquivo para download.'});}
async function release(current){if(current?.token)await processor({action:'release',token:current.token}).catch(()=>{});}
const nativeHost = 'com.media_collector.processor';
const stagingFolder = 'Media Collector Temporarios';
async function nativeRequest(action, data = {}) {
 if (!chrome.runtime.sendNativeMessage) throw Error('Auxiliar local indisponível.');
 const reply = await chrome.runtime.sendNativeMessage(nativeHost, {id:crypto.randomUUID(),action,...data});
 if (reply?.event === 'cancelled') return null;
 if (reply?.event !== 'done') {
  const error = Error(reply?.error || 'O auxiliar local está indisponível. Confira a instalação.');
  error.retryable = reply?.retryable !== false;
  throw error;
 }
 return reply;
}
const destinationPreferenceKey='downloadDestination';
function savedDestination(settings){
 const saved=settings?.[destinationPreferenceKey];
 if(saved?.mode==='browser')return {mode:'browser',explicit:true};
 if(saved?.mode==='folder'&&typeof saved.token==='string'&&saved.token)
  return {mode:'folder',token:saved.token,folder:typeof saved.folder==='string'?saved.folder:'',...(saved.isDownloads===true?{isDownloads:true}:{})};
 if(settings?.destinationBrowser===true)return {mode:'browser',explicit:true};
 return null;
}
async function directDownloadsDestination(){
 const result=await nativeRequest('destination-downloads');
 if(!result?.destination)throw Error('O auxiliar local não confirmou a pasta Downloads.');
 return {mode:'folder',token:result.destination,folder:result.folder||'',isDownloads:true};
}
async function persistentDestination(){
 const settings=await chrome.storage.local.get([destinationPreferenceKey,'destinationBrowser']);
 const saved=savedDestination(settings);
 if(saved?.mode==='folder')return saved;
 if(saved?.mode==='browser'){
  try{
   const destination=await directDownloadsDestination();
   await chrome.storage.local.set({[destinationPreferenceKey]:destination,destinationBrowser:false});
   return destination;
  }catch{return saved;}
 }
 try{
  const result=await nativeRequest('destination-get');
  if(result?.destination){
   const destination={mode:'folder',token:result.destination,folder:result.folder||''};
   await chrome.storage.local.set({[destinationPreferenceKey]:destination,destinationBrowser:false});
   return destination;
  }
 }catch(error){
  // Older installs wrote false when a custom destination was selected. Never
  // silently redirect that explicit preference to the browser Downloads folder.
  if(settings.destinationBrowser===false)
   throw Error('O auxiliar local está indisponível para o destino configurado. Reinstale ou reconecte o auxiliar, ou escolha Downloads do navegador no painel.');
 }
 // This is only the fallback when there is no saved destination preference.
 // Keep it non-explicit so the user can still opt into local processing for
 // this queue; an explicitly selected browser destination is stored above.
 const destination={mode:'browser'};
 await chrome.storage.local.set({[destinationPreferenceKey]:destination});
 return destination;
}
async function destinationFor(req, sender) {
 const fromPanel = sender.url?.startsWith(chrome.runtime.getURL(''));
 if (fromPanel && req.destination?.mode === 'browser') return {mode:'browser',explicit:true};
 if (fromPanel && req.destination?.mode === 'ask') return {mode:'ask'};
 if (fromPanel && req.destination?.mode === 'folder' && typeof req.destination.token === 'string') return req.destination;
 return persistentDestination();
}
function downloadOptions(current, filename, url) {
 const options = {url,filename,conflictAction:'uniquify',saveAs:current.item.destination?.mode === 'ask'};
 if (current.stageId) options.filename = stagingFolder+'/'+current.stageId+'/'+filename.split('/').pop();
 return options;
}
async function launchBrowserDownload(job, filename, url, direct=false){
 const current=job.current;
 current.browserSource=url;
 current.browserName=filename;
 downloadFilenames.set(url,current);
 await save(job);
 const options=downloadOptions(current,filename,url);
 const id=await (direct?startDirectDownload(options):chrome.downloads.download(options));
 current.id=id;
 current.phase='Baixando';
 await save(job);
 const [download]=await chrome.downloads.search({id});
 if(download&&['complete','interrupted'].includes(download.state))await settle(job,downloadState(download));
}
function downloadState(download) {
 return {id:download.id,state:{current:download.state},error:{current:download.error}};
}
function dialogCancelled(item,error){
 return item.destination?.mode==='ask'&&/cancel|abort/i.test(err(error));
}
function transferError(code) {
 const messages = {
  SERVER_FORBIDDEN:'O servidor recusou o acesso à fonte. Reabra o player na sua sessão e tente novamente.',
  SERVER_UNAUTHORIZED:'O servidor exige acesso para esta fonte. Reabra o player na sua sessão.',
  SERVER_BAD_CONTENT:'A resposta do servidor não contém o arquivo esperado. Atualize a fonte e tente novamente.',
  SERVER_CONTENT_LENGTH_MISMATCH:'O arquivo recebido está incompleto. Tente novamente.',
  SERVER_NO_RANGE:'O servidor não permitiu retomar a transferência. Tente novamente.',
  SERVER_FAILED:'A fonte falhou ou expirou. Reabra o player para atualizar o endereço e tente novamente.',
  USER_CANCELED:'Download cancelado.'
 };
 return messages[code] || code || 'Download interrompido.';
}
async function probeDirectLength(url) {
 if(typeof fetch!=='function'||typeof AbortSignal==='undefined')return undefined;
 try{
  const response=await fetch(url,{headers:{Range:'bytes=0-0'},credentials:'include',cache:'no-store',
   signal:AbortSignal.timeout(2000)});
  const range=/^bytes 0-0\/(\d+)$/i.exec(response.headers.get('content-range')||'');
  await response.body?.cancel();
  const total=Number(range?.[1]);
  if(response.status===206&&Number.isSafeInteger(total)&&total>0)return total;
 }catch{}
}
function completeDirectFile(current, download) {
 if (!current.direct) return;
 const isAudio=current.item.kind==='audio';
 const mediaName=isAudio?'áudio':'vídeo';
 if(!download)throw Error(`O navegador não encontrou o ${mediaName} transferido.`);
 const mime = download.mime?.split(';')[0].trim().toLowerCase();
 const genericBinary=['application/octet-stream','binary/octet-stream'];
 const validAudioMime=mime?.startsWith('audio/')||mime==='application/ogg'||genericBinary.includes(mime);
 const validVideoMime=['video/mp4','video/x-m4v','application/mp4',...genericBinary].includes(mime);
 if (mime && !(isAudio?validAudioMime:validVideoMime))
  throw Error(`O servidor devolveu outro tipo de arquivo. Atualize a fonte do ${mediaName} e tente novamente.`);
 const expected = current.item.expectedBytes;
 const actual = download.fileSize >= 0 ? download.fileSize : download.bytesReceived;
 if(actual===0)
  throw Error(`A transferência terminou com um ${mediaName} incompleto. Atualize a fonte e tente novamente.`);
 if(Number.isSafeInteger(expected)&&(!Number.isFinite(actual)||actual!==expected))
  throw Error('O tamanho do arquivo não corresponde à resposta da fonte. Atualize a lista e tente novamente.');
}
async function publishCurrent(current, download) {
 if (!download?.filename || (download.byExtensionId && download.byExtensionId !== chrome.runtime.id))
  throw Error('O arquivo temporário desta transferência não foi encontrado.');
 const directExtension=current.direct?(current.item.kind==='audio'?MediaCore.extension(current.item):'mp4'):undefined;
 const path = MediaCore.filename({...current.item,forceExtension:current.extension ||
  (directExtension || MediaCore.imageExtension(download.mime)) || undefined},current.index);
 const [,category,filename] = path.split('/');
 const payload = {id:current.stageId,source:download.filename,filename,category,
  destination:current.item.destination.token,kind:current.item.kind,
  expectedBytes:current.direct ? current.item.expectedBytes : undefined,
  expectedDuration:current.direct ? current.item.duration : undefined,
  expectedAudio:current.direct && current.item.expectedAudio === true ? true : undefined};
 const {pendingPublications={}} = await chrome.storage.local.get('pendingPublications');
 pendingPublications[current.stageId] = {payload,item:current.item,downloadId:download.id};
 await chrome.storage.local.set({pendingPublications});
 const result = await nativeRequest('publish-download',payload);
 if (!result?.filename) throw Error('O auxiliar não confirmou o arquivo final.');
 return result.filename;
}
async function clearPublication(stageId) {
 const {pendingPublications={}}=await chrome.storage.local.get('pendingPublications');
 delete pendingPublications[stageId];
 await chrome.storage.local.set({pendingPublications});
}
const safeStreamErrors=new Set([
 'Arquivo MP4 incompleto.','O servidor entregou um arquivo MP4 incompleto.','O arquivo recebido não é um MP4 completo.',
 'O tamanho do arquivo recebido é inválido ou incompleto.','O servidor entregou uma página HTML no lugar da mídia.',
 'O arquivo recebido contém faixas incompletas ou ilegíveis.','O arquivo recebido não contém as faixas esperadas.',
 'A duração do arquivo não corresponde à origem.','A verificação de integridade do arquivo falhou.',
 'Arquivo incompleto ou tamanho inconsistente.','O auxiliar não respondeu; verifique o destino antes de tentar novamente.',
 'A fonte parou de enviar dados; verifique o resultado no destino.','A transferência da mídia está incompleta.',
 'O auxiliar não confirmou o arquivo final.','Auxiliar desconectado.','Confirmação inválida do auxiliar.'
]);
function safeStreamError(value){return typeof value==='string'&&safeStreamErrors.has(value)?value:null;}
async function reconcileNativeStream(job){
 const current=job.current;if(!current?.stream||!current.stageId)return;
 let result,timer;
 try{result=await Promise.race([chrome.runtime.sendNativeMessage(nativeHost,{id:current.stageId,action:'stream-status'}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),5000);})]);}catch{}finally{clearTimeout(timer);}
 if(!result||result.id!==current.stageId||result.event!=='stream-status'||!['saved','processing','interrupted','cancelled','failed','unknown'].includes(result.status))result={status:'unknown'};
 if(result.status==='saved'&&typeof result.filename==='string'&&result.filename){
  const item=current.item;job.done++;job.lastSavedPath=result.filename;job.lastDownloadId=null;if(current.inspection)job.lastInspection=current.inspection;else delete job.lastInspection;await markHistory(item);await recordTransfer(item,'saved',{downloadId:null,filename:result.filename,publicationId:null,error:null});job.current=null;await release(current);if(job.status==='running')await pump(job);else await save(job);return;
 }
 if(['interrupted','cancelled','failed'].includes(result.status)){
  const detail=safeStreamError(result.diagnostic?.message)||safeStreamError(current.streamError);
  const message=result.status==='interrupted'?'A transferência foi interrompida antes de concluir. Tente novamente.':result.status==='cancelled'?'A transferência foi cancelada.':detail||'O auxiliar informou falha na gravação.';
  job.failed++;job.errors.push(message);await recordTransfer(current.item,result.status==='cancelled'?'cancelled':'failed',{downloadId:null,filename:null,error:message});job.current=null;await release(current);if(job.status==='running')await pump(job);else await save(job);return;
 }
 current.streamPending=true;current.streamStatus=result.status==='processing'?'processing':'unknown';current.phase=result.status==='processing'?'Aguardando confirmação do auxiliar':'Resultado não confirmado; verifique o destino. Você pode encerrar a fila.';await save(job);
}
async function fetchDirectForStream(url,signal){
 const fetchController=new AbortController();let timer;
 const abort=()=>fetchController.abort();signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)abort();
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{fetchController.abort();reject(Error('A fonte não respondeu a tempo.'));},10000);});
  return await Promise.race([fetch(url,{credentials:'include',cache:'no-store',signal:fetchController.signal}),timeout]);
 }finally{clearTimeout(timer);}
}
// A native stream runs outside serial(): status and cancel must remain responsive.
function startNativeDirect(job, filename, sourceUrl=job.current.item.url, processed=false){
 const current=job.current,item=current.item,stageId=current.stageId;
 const controller=new AbortController();
 const control={stageId,controller,paused:false,wake:null,started:false};
 nativeStreamControl=control;
 const waitIfPaused=async()=>{while(control.paused&&!controller.signal.aborted)await new Promise(resolve=>{control.wake=resolve;});if(controller.signal.aborted)throw Error('Transferência cancelada.');};
 const wake=()=>{const fn=control.wake;control.wake=null;fn?.();};control.resume=wake;
 let port;
 (async()=>{
  try{
   const response=await fetchDirectForStream(sourceUrl,controller.signal);
   if(controller.signal.aborted)throw Error('Transferência cancelada.');
   port=chrome.runtime.connectNative(nativeHost);
   let targetFilename=filename;
   if(item.kind==='image'){
    const extension=MediaCore.imageExtension(response.headers?.get('content-type'));
    if(extension)targetFilename=filename.replace(/\.[^./]+$/,'.'+extension);
   }
   let lastProgress=0;
   const [,targetCategory,targetName]=targetFilename.split('/');
   const result=await MediaNativeStream.transfer(port,response,{id:stageId,filename:targetName,category:targetCategory,destination:item.destination.token,kind:processed&&current.inspection?.video===false?'audio':item.kind,expectedBytes:processed?undefined:item.expectedBytes,expectedDuration:processed?(current.inspection?.duration||item.duration):item.duration,expectedAudio:processed?(current.inspection?.audio===true?true:undefined):(item.expectedAudio===true?true:undefined),signal:controller.signal,waitIfPaused,onDispatch(){control.started=true;},onFinishing(){control.finishing=true;serial(async()=>{const {job:j}=await get();if(j?.current?.stageId===stageId){j.current.phase='Finalizando e validando arquivo';await save(j);}}).catch(()=>{});},onProgress(completed,total){
    if(Date.now()-lastProgress<1000)return;lastProgress=Date.now();
    serial(async()=>{const {job:j}=await get();if(j?.current?.stageId===stageId){Object.assign(j.current,{phase:'Gravando no destino escolhido',completed,total});await save(j);}}).catch(()=>{});
   }});
   await serial(async()=>{const {job:j}=await get();if(j?.current?.stageId!==stageId)return;const c=j.current;j.done++;j.lastSavedPath=result.filename;j.lastDownloadId=null;if(c.inspection)j.lastInspection=c.inspection;else delete j.lastInspection;await markHistory(item);await recordTransfer(item,'saved',{downloadId:null,filename:result.filename,publicationId:null,error:null});j.current=null;await release(c);if(j.status==='running')await pump(j);else await save(j);});
  }catch(error){
   await serial(async()=>{const {job:j}=await get();if(j?.current?.stageId!==stageId)return;
    if(!control.started&&!controller.signal.aborted){
     j.current.stream=false;j.current.awaitingBrowserFallback=true;
     j.current.fallbackUrl=sourceUrl;
     j.current.fallbackError=redactTransferError(err(error));
     j.current.phase='Transferência direta indisponível. Escolha como continuar.';
     j.status='paused';await save(j);return;
    }
    j.current.streamError=safeStreamError(err(error));j.current.streamPending=true;j.current.phase='Verificando resultado no destino';await save(j);await reconcileNativeStream(j);
   });
  }finally{try{port?.disconnect();}catch{}if(nativeStreamControl===control)nativeStreamControl=null;}
 })();
}
async function startDirectDownload(options){
 if(options.saveAs)return chrome.downloads.download(options);
 let expired=false,timer;
 const pending=chrome.downloads.download(options).then(async id=>{
  if(expired){await chrome.downloads.cancel(id).catch(()=>{});throw Error('A tentativa anterior expirou.');}
  return id;
 });
 try{
  return await Promise.race([pending,new Promise((resolve,reject)=>{
   timer=setTimeout(()=>{expired=true;reject(Error('O servidor não iniciou o download em 30 segundos. Tente novamente.'));},30000);
  })]);
 }finally{clearTimeout(timer);}
}
async function settle(job, delta) {
 const current=job.current;
 if(!current||delta.id!==current.id||!delta.state)return;
 const {item,id,stageId}=current;
 if(delta.state.current==='complete'){
  let filename;
  try{
   const [download]=await chrome.downloads.search({id});
   completeDirectFile(current,download);
   if(stageId){
    current.phase='Gravando no destino escolhido';
    await save(job);
    filename=await publishCurrent(current,download);
   }
  }catch(error){
   const {pendingPublications={}}=await chrome.storage.local.get('pendingPublications');
   const retryId=error.retryable!==false&&pendingPublications[stageId]?stageId:null;
   if(!retryId){
    if(stageId)await clearPublication(stageId);
    await chrome.downloads.removeFile?.(id).catch(()=>{});
   }
   job.failed++;
   job.errors.push(err(error));
   await recordTransfer(item,'failed',{downloadId:null,filename:null,publicationId:retryId,error:err(error)});
   if(retryId){
    job.lastPublicationId=retryId;
    pendingPublications[retryId].queueError=redactTransferError(err(error));
    await chrome.storage.local.set({pendingPublications});
   }
   downloadFilenames.delete(current.browserSource||item.url);
   job.current=null;
   await release(current);
   if(job.status==='running')await pump(job);else await save(job);
   return;
  }
  job.done++;
  job.lastDownloadId=filename?null:id;
  job.lastSavedPath=filename||null;
  if(current.inspection)job.lastInspection=current.inspection;
  else if(current.direct)delete job.lastInspection;
  await markHistory(item);
  await recordTransfer(item,'saved',{downloadId:filename?null:id,filename:filename||null,publicationId:null,error:null});
  if(stageId)await clearPublication(stageId);
 }else if(delta.state.current==='interrupted'){
  job.failed++;
  const code=delta.error?.current;
  const message=transferError(code);
  job.errors.push(message);
  await recordTransfer(item,code==='USER_CANCELED'?'cancelled':'failed',{downloadId:id,error:message});
 }else return;
 downloadFilenames.delete(current.browserSource||item.url);
 job.current=null;
 await release(current);
 if(job.status==='running')await pump(job);else await save(job);
}
async function pump(job){if(job.status!=='running'||job.current){await save(job);return;}
 while(job.next<job.items.length&&job.status==='running'){
  const index=job.next,item=job.items[index];
  const stageId=item.destination?.mode==='folder'?crypto.randomUUID():null;
  // Older versions queued companion links. Drop those still waiting on upgrade.
  if(!isMedia(item)){job.items.splice(index,1);job.total=job.items.length;continue;}
  job.next++;
  try{
   if(item.kind==='video'||item.kind==='audio'){
    const directVideo=item.kind==='video'&&item.mp4Direct&&item.format==='direct'&&['mp4','original'].includes(item.output)&&!item.useNative;
    const directAudio=item.kind==='audio'&&item.format==='direct'&&item.output==='audio-original'&&!item.useNative;
    const direct=directVideo||directAudio;
    if(direct){
     job.current={item,index,stageId,direct:true,phase:item.destination?.mode==='ask'?'Escolha onde salvar':'Iniciando download'};
     await save(job);
     const filename=MediaCore.filename(directVideo?{...item,forceExtension:'mp4'}:item,index);
     if(!stageId&&!item.expectedBytes){
      item.expectedBytes=await probeDirectLength(item.url);
      if(item.expectedBytes)await save(job);
     }
     if(stageId && typeof fetch==='function' && chrome.runtime.connectNative){
      job.current.stream=true;job.current.streamOwner=workerInstance;job.current.phase='Preparando transferência local';await save(job);startNativeDirect(job,filename);return;
     }
     await launchBrowserDownload(job,filename,item.url,true);
     return;
    }
    if(item.useNative){
     if(/(^|\.)(instagram\.com|x\.com|twitter\.com|reddit\.com)$/i.test(item.site||''))throw Error('O auxiliar está disponível para mídias da web geral; use o processamento no navegador neste site.');
     if(!['mp4','webm','mp3','m4a'].includes(item.output))throw Error('No auxiliar, escolha MP4, WebM, MP3 ou M4A.');
     const token=crypto.randomUUID();
     job.current={token,item,index,phase:'Identificando faixas',completed:0,total:0,native:true};
     await save(job);await ensureProcessor();
     const resolved=await processor({action:'native-resolve',item});
     if(resolved?.error||!resolved?.tracks?.length)throw Error(resolved?.error||'Faixas indisponíveis.');
     const port=chrome.runtime.connectNative('com.media_collector.processor');nativePort=port;
     port.onMessage.addListener(event=>serial(async()=>{
      const {job:currentJob}=await get();if(!currentJob?.current?.native||currentJob.current.token!==token||event.id!==token)return;
      if(event.event==='progress'){Object.assign(currentJob.current,{phase:event.phase,completed:event.completed,total:event.total});await save(currentJob);}
      else if(event.event==='done'){
       currentJob.done++;currentJob.lastSavedPath=event.filename;currentJob.lastDownloadId=null;await recordTransfer(item,'saved',{phase:'Salvo',filename:event.filename});currentJob.lastInspection={duration:event.duration,video:event.hasVideo,audio:event.hasAudio,audioExpected:event.audioExpected};
       await markHistory(item);
       currentJob.current=null;nativePort=null;port.disconnect();await pump(currentJob);
      }else if(event.event==='error'||event.event==='cancelled'){
       currentJob.failed++;await recordTransfer(item,event.event==='cancelled'?'cancelled':'failed',{error:event.error||'Cancelado.'});currentJob.errors.push(event.error||'Processamento cancelado.');currentJob.current=null;nativePort=null;port.disconnect();await pump(currentJob);
      }
     }));
     port.onDisconnect.addListener(()=>serial(async()=>{
      const {job:currentJob}=await get();if(currentJob?.current?.native&&currentJob.current.token===token){currentJob.failed++;await recordTransfer(item,'failed',{error:'Auxiliar desconectado.'});currentJob.errors.push('Auxiliar indisponível ou interrompido. Confira a instalação e tente novamente.');currentJob.current=null;nativePort=null;await pump(currentJob);}
     }));
     const filename=MediaCore.filename({...item,forceExtension:item.output},index).split('/').pop();
     port.postMessage({id:token,action:'start',tracks:resolved.tracks,output:item.output,filename,destination:item.destination?.token,category:MediaCore.filename(item,index).split('/')[1],expectedDuration:item.duration||null,expectAudio:typeof item.expectedAudio==='boolean'?item.expectedAudio:null});
     return;
    }
    const token=crypto.randomUUID();if(!['hls','dash'].includes(item.format))item.format='convert';job.current={token,item,index,stageId,phase:'Preparando vídeo',completed:0,total:0};await save(job);await ensureProcessor();const result=await processor({action:'start',token,item});if(result?.error)throw Error(result.error);return;
   }
   job.current={item,index,stageId,phase:item.destination?.mode==='ask'?'Escolha onde salvar':'Iniciando download'};
   if(item.kind==='image'&&stageId&&typeof fetch==='function'&&chrome.runtime.connectNative){
    job.current.stream=true;job.current.streamOwner=workerInstance;job.current.phase='Preparando transferência local';await save(job);
    startNativeDirect(job,MediaCore.filename(item,index));return;
   }
   await launchBrowserDownload(job,MediaCore.filename(item,index),item.url);
   return;
  }catch(e){await recordTransfer(item,dialogCancelled(item,e)?'cancelled':'failed',{error:err(e)});downloadFilenames.delete(job.current?.browserSource||item.url);if(job.current?.native){nativePort?.disconnect();nativePort=null;}else if(job.current?.token)await processor({action:'cancel',token:job.current.token}).catch(()=>{});job.current=null;job.failed++;job.errors.push(`${item.label||'Mídia'}: ${err(e)}`);await save(job);}
 }
 if(job.next>=job.items.length&&!job.current&&job.status==='running')job.status='finished';await save(job);
}
async function saveProcessed(job,blobUrl){
 const current=job.current;
 try{
  const filename=MediaCore.filename({...current.item,forceExtension:current.extension},current.index);
  delete current.blobUrl;
  if(current.stageId && current.item.destination?.mode==='folder' && typeof fetch==='function' && chrome.runtime.connectNative){
   current.stream=true;current.streamOwner=workerInstance;current.phase='Preparando transferência local';await save(job);startNativeDirect(job,filename,blobUrl,true);return;
  }
  current.phase=current.item.destination?.mode==='ask'?'Escolha onde salvar':'Salvando arquivo';
  await launchBrowserDownload(job,filename,blobUrl);
 }catch(error){
  downloadFilenames.delete(current.browserSource);
  job.failed++;
  job.errors.push(err(error));
  await recordTransfer(current.item,dialogCancelled(current.item,error)?'cancelled':'failed',{error:err(error)});
  job.current=null;
  await release(current);
  await pump(job);
 }
}
function isMedia(item){return item?.kind==='image'||item?.kind==='video'||item?.kind==='audio';}
function newMedia(req,history,seen=new Set(),destination={mode:'browser'}){
 const selected=[];
 for(const item of req.items||[]){
  if(!isMedia(item)||!item.available||!MediaCore.absolute(item.url)||seen.has(item.id)||(req.skip&&historyHas(history,item)))continue;
  seen.add(item.id);
  const requested=req.outputFormat||item.output||'mp4';
  const output=item.kind==='audio'&&!['mp3','m4a','audio-original'].includes(requested)?'audio-original':requested;
  const mediaIdentity=(item.kind==='video'||item.kind==='audio')?item.url+'\n'+output:null;
  if(mediaIdentity&&seen.has(mediaIdentity))continue;
  if(mediaIdentity)seen.add(mediaIdentity);
  selected.push(item.kind==='video'||item.kind==='audio'?{...item,destination,output,useNative:!!req.useNative&&output!=='audio-original'&&destination.mode!=='ask'&&!destination.explicit}:{...item,destination});
 }
 return selected;
}
async function handle(req,sender){
 if(['destination-get','destination-choose','destination-browser','destination-downloads','destination-reveal','destination-retry','browser-fallback-confirm','ignore-fallback-item'].includes(req.action)){
  if(!sender.url?.startsWith(chrome.runtime.getURL('')))throw Error('Abra o painel para alterar o destino.');
  if(req.action==='destination-get'){
   let destination,errorMessage;
   try{destination=await persistentDestination();}catch(error){errorMessage=err(error);}
   let available=false;
   try{await nativeRequest('destination-get');available=true;}catch{}
   return {available,destination:destination||null,error:errorMessage};
  }
  if(req.action==='destination-choose'){
   const chosen=await nativeRequest('destination-choose',{remember:req.remember===true});
   if(!chosen)return {cancelled:true};
   const destination={mode:'folder',token:chosen.destination,folder:chosen.folder};
   if(req.remember)await chrome.storage.local.set({[destinationPreferenceKey]:destination,destinationBrowser:false});
   return {destination};
  }
  if(req.action==='destination-downloads'){
   if(req.enabled===false){
    const settings=await chrome.storage.local.get([destinationPreferenceKey]);
    if(settings[destinationPreferenceKey]?.isDownloads===true){
     await chrome.storage.local.remove(destinationPreferenceKey);
     await chrome.storage.local.set({destinationBrowser:false});
    }
    return {ok:true};
   }
   const destination=await directDownloadsDestination();
   await chrome.storage.local.set({[destinationPreferenceKey]:destination,destinationBrowser:false});
   return {destination};
  }
  if(req.action==='destination-browser'){
   if(typeof req.enabled!=='boolean')throw Error('Escolha um destino válido.');
   if(req.enabled){const destination=await directDownloadsDestination();await chrome.storage.local.set({[destinationPreferenceKey]:destination,destinationBrowser:false});return {destination};}
   const settings=await chrome.storage.local.get([destinationPreferenceKey]);
   if(settings[destinationPreferenceKey]?.isDownloads===true)await chrome.storage.local.remove(destinationPreferenceKey);
   await chrome.storage.local.set({destinationBrowser:false});
   return {ok:true};
  }
  if(req.action==='destination-reveal'){
   const {transfers={},job}=await chrome.storage.local.get(['transfers','job']);
   if(job?.lastSavedPath!==req.filename&&!Object.values(transfers).some(t=>t.state==='saved'&&t.filename===req.filename))
    throw Error('Arquivo fora do histórico desta extensão.');
   await nativeRequest('reveal-file',{filename:req.filename});
   return {ok:true};
  }
  if(req.action==='browser-fallback-confirm'){
   const {job:currentJob}=await get();
   if(!currentJob||currentJob.status!=='paused'||!currentJob.current?.awaitingBrowserFallback)throw Error('Não há um item aguardando confirmação de fallback.');
   const current=currentJob.current,url=current.fallbackUrl||current.item.url;
   current.awaitingBrowserFallback=false;delete current.fallbackUrl;delete current.fallbackError;
   current.phase='Preparando download pelo navegador';currentJob.status='running';await save(currentJob);
   try{
    const filename=MediaCore.filename(current.item,current.index);
    await launchBrowserDownload(currentJob,filename,url,current.direct===true);
    return {ok:true};
   }catch(error){
    const message=redactTransferError(err(error));
    currentJob.failed++;currentJob.errors.push(message);await recordTransfer(current.item,'failed',{downloadId:null,filename:null,error:message});
    const active=currentJob.current;currentJob.current=null;await release(active);await pump(currentJob);
    return {error:message};
   }
  }
  if(req.action==='ignore-fallback-item'){
   const {job:currentJob}=await get();
   if(!currentJob||currentJob.status!=='paused'||!currentJob.current?.awaitingBrowserFallback)throw Error('Não há um item aguardando uma decisão.');
   const current=currentJob.current,message=current.fallbackError||'A transferência direta falhou.';
   currentJob.failed++;currentJob.errors.push(`${current.item.label||'Mídia'}: ${message}`);
   await recordTransfer(current.item,'failed',{downloadId:null,filename:null,error:message});
   await release(current);currentJob.current=null;currentJob.status='running';await save(currentJob);await pump(currentJob);
   return {ok:true};
  }
  const {pendingPublications={},job}=await chrome.storage.local.get(['pendingPublications','job']);
  const entry=pendingPublications[req.id];
  if(!entry)throw Error('Arquivo temporário indisponível.');
  const safeQueueError=redactTransferError(entry.queueError);
  const safeJobErrors=Array.isArray(job?.errors)?job.errors.map(redactTransferError):null;
  const publicationChanged=safeQueueError!==entry.queueError;
  const jobChanged=safeJobErrors&&safeJobErrors.some((message,index)=>message!==job.errors[index]);
  if(publicationChanged){entry.queueError=safeQueueError;pendingPublications[req.id]=entry;}
  if(jobChanged)job.errors=safeJobErrors;
  if(publicationChanged||jobChanged)await chrome.storage.local.set({...(publicationChanged?{pendingPublications}:{}),...(jobChanged?{job}:{})});
  const result=await nativeRequest('publish-download',entry.payload);
  if(!result?.filename)throw Error('O auxiliar não confirmou o arquivo final.');
  await markHistory(entry.item);
  await recordTransfer(entry.item,'saved',{downloadId:null,filename:result.filename,publicationId:null,error:null});
  if(job?.lastPublicationId===req.id){
   job.lastPublicationId=null;
   job.lastSavedPath=result.filename;
   job.lastDownloadId=null;
   job.done++;job.failed=Math.max(0,job.failed-1);
   const errorIndex=job.errors.lastIndexOf(safeQueueError);
   if(errorIndex>=0)job.errors.splice(errorIndex,1);
   await chrome.storage.local.set({job});
  }
  await clearPublication(req.id);
  return {filename:result.filename};
 }
 if(req.action==='inline-source-confirm'){
  const url=MediaCore.absolute(req.url);
  if(!Number.isInteger(sender.tab?.id)||!sender.documentId||!url||(!req.playerBound&&!req.observed))
   throw Error('Fonte sem vínculo com este player.');
  const key=sessionKey(sender.tab.id);
  const observed=(await chrome.storage.session.get(key))[key]||[];
  const response=observed.find(item=>item.url===url&&item.documentId===sender.documentId&&item.frameId===sender.frameId);
  if(req.observed&&!response)throw Error('A fonte não pertence a este documento. Atualize a publicação.');
  const format=response?.format||classify(url)||'direct';
  const mime=response?.mime?.split(';')[0].trim().toLowerCase();
  const mp4=format==='direct'&&((mime==='video/mp4'&&[200,206].includes(response?.status))||/\.mp4$/i.test(new URL(url).pathname));
  return {format,mp4,expectedBytes:response?.expectedBytes};
 }
 if(req.action==='observed-source-confirm'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!Number.isInteger(req.tabId)||
   !Number.isInteger(req.frameId)||typeof req.documentId!=='string'||typeof req.url!=='string')
   throw Error('Fonte observada inválida. Atualize a lista de mídias.');
  const tab=await chrome.tabs.get(req.tabId);
  if(!/^https?:/i.test(tab.url||'')||MediaAdapters.select(new URL(tab.url).hostname).id!=='generic')
   throw Error('Fontes avulsas estão disponíveis somente na web geral.');
  const url=MediaCore.absolute(req.url);
  if(!url)throw Error('A fonte observada não usa HTTP ou HTTPS.');
  const key=sessionKey(req.tabId),observed=(await chrome.storage.session.get(key))[key]||[];
  const record=observed.find(item=>item.url===url&&item.documentId===req.documentId&&item.frameId===req.frameId);
  const media=ObservedMedia.inspect(record);
  if(!media)throw Error('A resposta não confirmou um arquivo de vídeo, áudio ou manifesto compatível. Atualize a lista.');
  const frames=await chrome.scripting.executeScript({target:{tabId:req.tabId,documentIds:[req.documentId]},
   func:()=>({url:location.href,origin:location.origin})}).catch(()=>[]);
  const frame=frames[0];
  if(!frame||frame.documentId!==req.documentId||frame.frameId!==req.frameId)
   throw Error('O documento ou quadro da fonte mudou. Atualize a lista.');
  const page=(()=>{try{return new URL(record.page);}catch{return null;}})();
  const current=(()=>{try{return new URL(frame.result.url);}catch{return null;}})();
  if(!current||page&&page.origin!==current.origin||page&&page.href.split('#')[0]!==current.href.split('#')[0])
   throw Error('A página de origem mudou. Atualize a lista.');
  return {...media,page:record.page||frame.result.url,frameId:req.frameId,documentId:req.documentId};
 }
 if(req.action==='transfer-error'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!isMedia(req.item)||!MediaCore.absolute(req.item.url))return {ok:false};
  await recordTransfer(req.item,'failed',{error:String(req.error||'Não foi possível iniciar o download.').slice(0,500)});
  return {ok:true};
 }
 if(req.action==='media-indicator'){
  if(!Number.isInteger(sender.tab?.id)||!Number.isInteger(sender.frameId)||!Number.isInteger(req.count))return {ok:false};
  const tabId=sender.tab.id;
  const accessible=knownFrames.get(tabId)||new Set();
  accessible.add(sender.frameId);
  knownFrames.set(tabId,accessible);
  const frames=mediaIndicators.get(tabId)||new Map();
  if(req.count>0)frames.set(sender.frameId,Math.min(req.count,100));
  else frames.delete(sender.frameId);
  mediaIndicators.set(tabId,frames);refreshMediaBadge(tabId);
  return {ok:true};
 }

 if(req.action==='web-images'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!Number.isInteger(req.tabId)||!['read','start','advance','restore'].includes(req.step))throw Error('Abra o painel para coletar imagens.');
  const script={func:(step,id)=>globalThis.ColetorWebImages?.(step,id),args:[req.step,req.walkId||'']};
  const frames=await runInAccessibleFrames(req.tabId,script);
  let ready=frames.filter(frame=>frame.result);
  if(req.step!=='restore'&&!ready.some(frame=>frame.frameId===0)){
   await connectCollector(req.tabId);
   const top=await chrome.scripting.executeScript({target:{tabId:req.tabId,frameIds:[0]},...script});
   ready=[...top.filter(frame=>frame.result),...ready];
  }
  return {frames:ready.map(frame=>({frameId:frame.frameId,...frame.result}))};
 }
 if(req.action==='collector-connect'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!Number.isInteger(req.tabId))throw Error('Abra o painel para conectar à aba.');
  await connectCollector(req.tabId,req.framesOnly===true);
  return {ok:true};
 }
 let data=await get(),job=data.job;
 if(req.action==='detected'){
  const extensionPage=sender.url?.startsWith(chrome.runtime.getURL(''));
  const tabId=extensionPage?(req.tabId??sender.tab?.id):sender.tab?.id;
  if(!Number.isInteger(tabId))return {items:[]};
  const key=sessionKey(tabId);
  const items=(await chrome.storage.session.get(key))[key]||[];
  return {items:extensionPage?items:items.filter(item=>item.documentId===sender.documentId&&item.frameId===sender.frameId)};
 }
 if(req.action==='player-metadata'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!Number.isInteger(req.tabId)||typeof req.documentId!=='string')return {};
  const result=await chrome.scripting.executeScript({target:{tabId:req.tabId,documentIds:[req.documentId]},
   func:(player,url)=>globalThis.MediaWebDetector?.metadata(player,url),args:[req.player,req.url]}).catch(()=>[]);
  return result[0]?.result||{};
 }
 if(req.action==='player-confirm'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!Number.isInteger(req.tabId)||typeof req.documentId!=='string')throw Error('Atualize a lista para identificar o player.');
  const result=await chrome.scripting.executeScript({target:{tabId:req.tabId,documentIds:[req.documentId]},
   func:(player,url)=>({valid:globalThis.MediaWebDetector?.confirm(player,url),mp4:globalThis.MediaWebDetector?.directMP4(player,url)}),
   args:[req.player,req.url]}).catch(()=>[]);
  if(!result[0]?.result?.valid)throw Error('O player ou a página mudou. Atualize a lista e selecione a mídia novamente.');
  const frame = result[0];
  const key = sessionKey(req.tabId);
  const observed = (await chrome.storage.session.get(key))[key] || [];
  const response = observed.find(item => item.url === req.url &&
   item.documentId === frame.documentId && item.frameId === frame.frameId);
  // Match the server response to this exact player source and document.
  const mime = response?.mime?.split(';')[0].trim().toLowerCase();
  const observedMP4 = response?.format === 'direct' &&
   [200,206].includes(response.status) && mime === 'video/mp4';
  return {ok:true,mp4:frame.result.mp4 || observedMP4,expectedBytes:response?.expectedBytes};
 }
 if(req.action==='web-capture-enable'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!Number.isInteger(req.tabId))throw Error('A captura deve ser ativada pelo painel.');
  await chrome.scripting.executeScript({target:{tabId:req.tabId,allFrames:true},world:'MAIN',files:['mse-observer.js']});
  await chrome.scripting.executeScript({target:{tabId:req.tabId,allFrames:true},files:['mse-client.js','web-detector.js']});
  const frames=await chrome.scripting.executeScript({target:{tabId:req.tabId,allFrames:true},func:()=>MediaWebDetector.enable()});
  await chrome.storage.session.set({[`web-capture:${req.tabId}`]:frames.map(f=>({frameId:f.frameId,documentId:f.documentId}))});
  return {ok:true};
 }
 if(req.action==='web-capture-run'){
  if(!sender.url?.startsWith(chrome.runtime.getURL(''))||!Number.isInteger(req.tabId)||!Number.isInteger(req.frameId)||typeof req.documentId!=='string'||typeof req.player!=='string'||typeof req.source!=='string')throw Error('Player inválido.');
  const key='web-capture:'+req.tabId;
  const active=(await chrome.storage.session.get(key))[key]||[];
  if(!active.some(frame=>frame.frameId===req.frameId&&frame.documentId===req.documentId))throw Error('A página mudou. Ative a captura neste player novamente.');
  const destination=await destinationFor(req,sender);
  const pendingKey='capture-destination:'+req.tabId+':'+req.documentId;
  if((await chrome.storage.session.get(pendingKey))[pendingKey])throw Error('Já existe uma captura neste documento.');
  await chrome.storage.session.set({[pendingKey]:destination});
  try{
   const result=await chrome.scripting.executeScript({target:{tabId:req.tabId,documentIds:[req.documentId]},func:async(player,source,output)=>{
    try{return await MediaWebDetector.capture(player,source,output);}catch(e){return {error:e.message};}
   },args:[req.player,req.source,req.outputFormat]});
   if(!result[0]?.result)throw Error('O player mudou ou a aba foi recarregada.');
   if(result[0].result.error)throw Error(result[0].result.error);
   return {ok:true};
  }finally{
   await chrome.storage.session.remove(pendingKey);
  }
 }
 if(req.action==='player-scan'){
  if(!Number.isInteger(req.tabId))return{items:[]};
  let detectedFrames=[],detectionError='';
  try{
   await chrome.scripting.executeScript({target:{tabId:req.tabId,allFrames:true},files:['web-detector.js']});
   detectedFrames=await chrome.scripting.executeScript({target:{tabId:req.tabId,allFrames:true},func:()=>globalThis.MediaWebDetector?.scan()});
  }catch(e){detectionError=err(e);}
  const frames=await chrome.scripting.executeScript({target:{tabId:req.tabId,allFrames:true},func:()=>{
   const urls=new Set();for(const e of document.querySelectorAll('video,video source,meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]')){if(e.mediaKeys||e.closest('video')?.mediaKeys)continue;let s=e.currentSrc||e.src||e.content;if(s)urls.add(s);}
   for(const e of performance.getEntriesByType('resource'))if(/\.(?:m3u8|mpd|mp4|m4v|webm|mov|ogv|mkv)(?:[?#]|$)/i.test(e.name))urls.add(e.name);
   return [...urls].slice(-100);
  }}).catch(()=>[]);
  const items=[];
  for(const frame of detectedFrames)for(const item of frame.result?.items||[])items.push({...item,id:`frame:${frame.documentId||frame.frameId}:${item.id}`,frameId:frame.frameId,documentId:frame.documentId,frameUrl:frame.result.frameUrl});
  for(const frame of frames)for(const url of frame.result||[]){let format=classify(url);if(format)items.push({url,format,at:Date.now(),page:'',frameId:frame.frameId,documentId:frame.documentId});}return{items,detectionError};
 }
 if(req.action==='status'){
  const transfers=await transferSerial(getTransfers);
  if(job?.current?.id){
   const [download]=await chrome.downloads.search({id:job.current.id});
   if(download){
    job.current.bytes=download.bytesReceived;job.current.totalBytes=download.totalBytes;
    const key=MediaNativeStream.transferKey(job.current.item.url,job.current.item.output);
    if(transfers[key])transfers[key]={...transfers[key],bytes:download.bytesReceived,totalBytes:download.totalBytes};
   }
  }
  return {job:job||null,history:data.history||{},transfers};
 }
 if(req.action==='history-clear'){await Promise.all([historySerial(()=>chrome.storage.local.remove('history')),transferSerial(()=>chrome.storage.local.remove('transfers'))]);return{ok:true};}
 if(req.action==='mse-prepare'){
  const source = new URL(sender.url||sender.tab?.url||'about:blank');
  const post = new URL(req.item?.postUrl||'about:blank');
  const socialHost = /(^|\.)(instagram\.com|x\.com|twitter\.com)$/i;
  const permalink = /^\/(?:(?:[A-Za-z0-9_.]+\/status|i\/web\/status)\/\d+|(?:p|reels?)\/[A-Za-z0-9_-]+|stories\/[A-Za-z0-9_.]+(?:\/\d+)?)(?:\/|$)/i.test(post.pathname);
  const reelsViewer = /(^|\.)instagram\.com$/i.test(post.hostname) && /^\/reels\/?$/.test(post.pathname) && /^\/reels\/?$/.test(source.pathname);
  const allowed=(await chrome.storage.session.get(`web-capture:${sender.tab?.id}`))[`web-capture:${sender.tab?.id}`]||[];
  const genericCapture=allowed.some(frame=>frame.frameId===sender.frameId&&frame.documentId&&frame.documentId===sender.documentId)&&post.href===source.href&&/^https?:$/.test(source.protocol);
  if(!sender.tab?.id||(!genericCapture&&(!socialHost.test(source.hostname)||post.origin!==source.origin||post.protocol!=='https:'||(!permalink&&!reelsViewer))))
   throw Error('Captura permitida para uma publicação ou Story identificado.');
  if(job&&['running','paused'].includes(job.status))throw Error('Aguarde a fila atual antes de baixar este vídeo.');
  if(!Number.isFinite(req.duration)||req.duration<=0||!Array.isArray(req.tracks)||req.tracks.length>2||!req.tracks.length||!/^video\//i.test(req.tracks[0])||(req.tracks.length===2&&!/^audio\//i.test(req.tracks[1])))throw Error('Captura de vídeo inválida.');
  const token=crypto.randomUUID();
  const allowedOutputs=['mp4','webm','original','mp3','m4a','audio-original'];
  const item={...req.item,kind:'video',format:'mse',output:allowedOutputs.includes(req.outputFormat)?req.outputFormat:'mp4',available:true,url:post.href,id:'mse:'+(reelsViewer||genericCapture?token:post.href)};
  const pendingKey='capture-destination:'+sender.tab.id+':'+sender.documentId;
  const captureDestination=genericCapture&&(await chrome.storage.session.get(pendingKey))[pendingKey];
  item.destination=captureDestination||await destinationFor(req,sender);
  const stageId=item.destination.mode==='folder'?crypto.randomUUID():null;
  job={status:'running',captureToken:token,items:[item],next:1,done:0,failed:0,errors:[],current:{token,item,index:0,stageId,phase:'Recebendo vídeo',completed:0,total:0},total:1};await save(job);
  try{await ensureProcessor();let result=await processor({action:'mse-begin',token,item,tracks:req.tracks,duration:req.duration});if(result?.error)throw Error(result.error);}catch(e){job.current=null;job.failed=1;job.status='finished';job.errors.push(err(e));await save(job);throw e;}return{token};
 }
 if(req.action==='mse-abort'){if(job?.current?.token===req.token){if(job.current.stream)return handle({...req,action:'cancel'},sender);if(job.current.id)try{await chrome.downloads.cancel(job.current.id);}catch{}await processor({action:'cancel',token:req.token}).catch(()=>{});await recordTransfer(job.current.item,'cancelled',{error:'Captura cancelada.'});job.current=null;job.status='cancelled';await save(job);}return{ok:true};}
 if(req.action==='stream-progress'){if(job?.current?.token===req.token){Object.assign(job.current,{phase:req.phase,completed:req.completed,total:req.total});await save(job);}return{ok:true};}
 if(req.action==='stream-ready'){if(job?.current?.token!==req.token||job.status==='cancelled'){await processor({action:'release',token:req.token}).catch(()=>{});return{ok:true};}job.current.extension=req.extension;job.current.inspection=req.inspection;if(job.status==='paused'){job.current.blobUrl=req.blobUrl;job.current.phase='Pronto para salvar';await save(job);}else await saveProcessed(job,req.blobUrl);return{ok:true};}
 if(req.action==='stream-error'){if(job?.current?.token===req.token){job.errors.push(req.error);job.failed++;await recordTransfer(job.current.item,'failed',{error:req.error});job.current=null;if(job.status==='running')await pump(job);else await save(job);}return{ok:true};}
 if(req.action==='enqueue'){
  if(!job || !['running','paused'].includes(job.status))return handle({...req,action:'download'},sender);
  const seen=new Set(job.items.flatMap(item=>[item.id,item.url+'\n'+item.output])),history=data.history||{};
  const added=newMedia(req,history,seen,await destinationFor(req,sender));
  if(!added.length)throw Error('Estas mídias já estão na fila ou no histórico.');for(const item of added)await recordTransfer(item,'queued',{error:null,downloadId:null});job.items.push(...added);job.total=job.items.length;await save(job);if(job.status==='running'&&!job.current)await pump(job);return{ok:true,count:added.length};
 }
 if(req.action==='download'){
  if(job&&['running','paused'].includes(job.status))throw Error('Já existe uma fila ativa.');const seen=new Set(),history=data.history||{};
  const items=newMedia(req,history,seen,await destinationFor(req,sender));
  if(!items.length)throw Error('Não há mídias disponíveis com as opções selecionadas.');for(const item of items)await recordTransfer(item,'queued',{error:null,downloadId:null});job={status:'running',items,next:0,done:0,failed:0,errors:[],current:null,total:items.length};await save(job);await pump(job);return{ok:true};
 }
 if(!job)throw Error('Não há fila de downloads.');
  if(req.action==='pause'){
   if(job?.current?.awaitingBrowserFallback)throw Error('Escolha baixar pelo navegador ou ignorar este item antes de continuar.');
  if(job.status==='running'&&job.current?.stream&&(job.current.streamPending||(nativeStreamControl?.stageId===job.current.stageId&&nativeStreamControl.finishing)))throw Error('O arquivo está sendo finalizado e validado; aguarde a confirmação antes de pausar.');
  if(job.status==='running'){job.status='paused';if(job.current?.stream&&nativeStreamControl?.stageId===job.current.stageId)nativeStreamControl.paused=true;else if(job.current?.native)nativePort?.postMessage({action:'pause',id:job.current.token});else if(job.current?.token&&!job.current.id)await processor({action:'pause',token:job.current.token,paused:true});else if(job.current?.id)try{await chrome.downloads.pause(job.current.id);}catch{}await save(job);}
  else if(job.status==='paused'){job.status='running';if(job.current?.blobUrl){await saveProcessed(job,job.current.blobUrl);return {ok:true};}else if(job.current?.stream&&nativeStreamControl?.stageId===job.current.stageId){nativeStreamControl.paused=false;nativeStreamControl.resume();}else if(job.current?.native)nativePort?.postMessage({action:'resume',id:job.current.token});else if(job.current?.token&&!job.current.id)await processor({action:'pause',token:job.current.token,paused:false});else if(job.current?.id)try{await chrome.downloads.resume(job.current.id);}catch{}await save(job);if(!job.current)await pump(job);}return{ok:true};
 }
 if(req.action==='cancel'){
  if(job.current?.stream&&job.current.streamPending&&job.current.streamStatus==='unknown'){
   const current=job.current,message='Resultado da gravação não confirmado. Verifique a pasta de destino antes de tentar novamente; o arquivo pode já existir.';
   job.status='cancelled';job.errors.push(message);job.unresolvedStreams=[...(job.unresolvedStreams||[]),{id:current.stageId,itemId:historyKey(current.item.id)}];
   await recordTransfer(current.item,'cancelled',{downloadId:null,filename:null,error:message});
   for(const item of job.items.slice(job.next))await recordTransfer(item,'cancelled',{error:'Fila encerrada pelo usuário.'});
   job.current=null;await release(current);await save(job);return {ok:true,warning:message};
  }
  if(job.current?.stream&&(job.current.streamPending||(nativeStreamControl?.stageId===job.current.stageId&&nativeStreamControl.finishing)))throw Error('O arquivo está sendo finalizado e validado; aguarde a confirmação antes de cancelar.');if(['running','paused'].includes(job.status)){job.status='cancelled';let c=job.current;if(c?.browserSource)downloadFilenames.delete(c.browserSource);for(const item of job.items.slice(Math.max(0,job.next-(c?1:0))))await recordTransfer(item,'cancelled',{error:'Download cancelado.'});if(c?.id)try{await chrome.downloads.cancel(c.id);}catch{}if(c?.stream&&nativeStreamControl?.stageId===c.stageId){nativeStreamControl.controller.abort();nativeStreamControl.resume();await release(c);}else if(c?.native){nativePort?.postMessage({action:'cancel',id:c.token});nativePort?.disconnect();nativePort=null;}else if(c?.token)await processor({action:'cancel',token:c.token}).catch(()=>{});job.current=null;await save(job);}return{ok:true};}
 throw Error('Ação desconhecida.');
}
chrome.action.onClicked.addListener(async tab=>{if(!tab.id||!/^https?:/i.test(tab.url||''))return;const opened=chrome.sidePanel?.open?chrome.sidePanel.open({windowId:tab.windowId}).then(()=>true,()=>false):Promise.resolve(false);try{await chrome.storage.session.set({'panel-tab':tab.id});if(!await opened)await chrome.windows.create({url:chrome.runtime.getURL(`panel.html?tab=${tab.id}`),type:'popup',width:410,height:760});}catch(e){console.error('Falha ao abrir o coletor:',err(e));}});
chrome.runtime.onMessage.addListener((req,sender,sendResponse)=>{if(req?.target!=='worker')return;if(req.action==='status'){const needsRecovery=j=>j?.current?.stream&&(j.current.streamPending||j.current.streamOwner!==workerInstance);const serve=async()=>{const {job:latest}=await get();if(needsRecovery(latest))await reconcileNativeStream(latest);return handle(req,sender);};const panel=sender.url?.startsWith(chrome.runtime.getURL(''));(panel?(async()=>{const {job:j}=await get();return needsRecovery(j)?serial(serve):handle(req,sender);})():serial(serve)).then(sendResponse,e=>sendResponse({error:err(e)}));return true;}if(req.action==='resolve-post'){resolvePost(req.postUrl).then(sendResponse,e=>sendResponse({error:err(e)}));return true;}if((['web-capture-run','web-images','inline-source-confirm','observed-source-confirm','destination-choose','destination-downloads','player-metadata','player-confirm','player-scan','collector-connect','detected'].includes(req.action)||req.action==='status'&&sender.url?.startsWith(chrome.runtime.getURL('')))){handle(req,sender).then(sendResponse,e=>sendResponse({error:err(e)}));return true;}serial(()=>handle(req,sender)).then(sendResponse,e=>sendResponse({error:err(e)}));return true;});
chrome.downloads.onChanged.addListener(d=>serial(async()=>{const {job}=await get();if(job)await settle(job,d);}));
chrome.downloads.onDeterminingFilename?.addListener((download,suggest)=>{
 if(download.byExtensionId!==chrome.runtime.id){suggest();return;}
 const propose=current=>{
  if(!current?.browserName){suggest();return;}
  const extension=current.item.webImage&&MediaCore.imageExtension(download.mime);
  const name=extension?MediaCore.filename({...current.item,forceExtension:extension},current.index):current.browserName;
  const {filename}=downloadOptions(current,name,download.url);
  suggest({filename,conflictAction:'uniquify'});
 };
 const active=downloadFilenames.get(download.url);
 if(active){propose(active);return;}
 get().then(({job})=>propose(job?.current?.browserSource===download.url?job.current:null),()=>suggest());
 return true;
});

const imageMenu='media-collector-download-image';
const videoMenu='media-collector-download-video';
chrome.runtime.onInstalled.addListener(()=>{
 chrome.contextMenus?.create({id:videoMenu,title:'Baixar vídeo com Media Collector',contexts:['video'],
  documentUrlPatterns:['http://*/*','https://*/*'],targetUrlPatterns:['http://*/*','https://*/*']},
  ()=>void chrome.runtime.lastError);
 chrome.contextMenus?.create({id:imageMenu,title:'Baixar com Media Collector',contexts:['image'],
  documentUrlPatterns:['http://*/*','https://*/*'],targetUrlPatterns:['http://*/*','https://*/*']},
  ()=>void chrome.runtime.lastError);
});
chrome.contextMenus?.onClicked.addListener((info,tab)=>{
 if(info.menuItemId!==imageMenu&&info.menuItemId!==videoMenu)return;
 const url=MediaCore.absolute(info.srcUrl);
 const page=MediaCore.absolute(tab?.url||info.pageUrl);
 if(!url||!page)return;
 const item={id:url,kind:info.menuItemId===videoMenu?'video':'image',webImage:info.menuItemId===imageMenu,url,site:new URL(page).hostname,page:'',available:true};
 if(item.kind==='video'){
  item.format='direct';item.output='mp4';
  item.mp4Direct=/\.mp4$/i.test(new URL(url).pathname);
  item.association='context-menu';
 }
 serial(()=>handle({action:'enqueue',items:[item],skip:false},{})).catch(error=>console.error(err(error)));
});

async function resolvePost(raw){
 let u;try{u=new URL(raw);}catch{throw Error('Link do post inválido.');}
 if(!/^https:$/.test(u.protocol)||!/(^|\.)(instagram\.com|x\.com|twitter\.com)$/i.test(u.hostname)||!/(\/(?:p|reel)\/[^/]+|\/status\/\d+)/.test(u.pathname))throw Error('Link do post não suportado.');
 let tab;try{
  tab=await chrome.tabs.create({url:u.href,active:false});let start=Date.now(),last='',stable=0;
  while(Date.now()-start<14000){
   await new Promise(r=>setTimeout(r,800));let captured=(await chrome.storage.session.get(sessionKey(tab.id)))[sessionKey(tab.id)]||[];
   let direct=[];try{let t=await chrome.tabs.get(tab.id);if(t.status==='complete'){let values=await chrome.scripting.executeScript({target:{tabId:tab.id},func:(postId)=>{const articles=[...document.querySelectorAll('article')];let scope=articles.find(a=>[...a.querySelectorAll('a[href]')].some(link=>link.pathname.includes('/'+postId)))||(articles.length===1?articles[0]:document);let videos=[...scope.querySelectorAll('video')];for(const v of videos){v.muted=true;v.play().catch(()=>{});}let sources=videos.map(v=>v.currentSrc||v.src||v.querySelector('source[src]')?.src);for(const meta of document.querySelectorAll('meta[property=\"og:video\"],meta[property=\"og:video:url\"],meta[property=\"og:video:secure_url\"]'))sources.push(meta.content);return sources.filter(s=>/^https?:/.test(s||'')&&!/[?&](range|bytestart|byteend)=/i.test(s));},args:[u.pathname.split('/').filter(Boolean).pop()]});direct=(values[0]?.result||[]).map(url=>({url,format:/\.m3u8(?:[?#]|$)/i.test(url)?'hls':/\.mpd(?:[?#]|$)/i.test(url)?'dash':'direct'}));}}catch{}
   let choices=direct.length?direct:captured.filter(c=>c.format==='hls'||c.format==='dash');
   if(!choices.length)choices=captured.filter(c=>c.format==='direct');
   let unique=[...new Map(choices.map(c=>[c.url,c])).values()];let sig=unique.map(x=>x.url).sort().join('|');stable=sig&&sig===last?stable+1:0;last=sig;
   if(unique.length===1&&stable>=2)return {source:unique[0]};
  }
  throw Error('Não foi possível associar uma fonte única ao vídeo; confira o post no painel.');
 }finally{if(tab?.id)await chrome.tabs.remove(tab.id).catch(()=>{});}
}

async function recover(){
 const {job}=await get();
 if(!job||!['running','paused'].includes(job.status))return;

 const current=job.current;
 if(current){
  if(current.stream){current.streamPending=true;await save(job);await reconcileNativeStream(job);return;}
  let error;
  if(Number.isInteger(current.id)){
   const [download]=await chrome.downloads.search({id:current.id});
   if(download&&['complete','interrupted'].includes(download.state)){
    await settle(job,{id:current.id,state:{current:download.state},error:{current:download.error}});
    return;
   }
   if(!download)error='Download anterior não encontrado. Tente novamente.';
  }else{
   error='Transferência interrompida ao reiniciar ou atualizar a extensão. Tente novamente.';
  }
  if(error){
   job.failed++;
   job.errors.push(error);
   await recordTransfer(current.item,'failed',{error,downloadId:null});
   job.current=null;
  }
 }
 if(job.status==='running')await pump(job);
 else await save(job);
}
async function reconnectOpenTabs(){
 const tabs=await chrome.tabs.query({});
 const declarations=chrome.runtime.getManifest().content_scripts||[];
 await Promise.allSettled(tabs.filter(tab=>tab.id&&/^https?:/.test(tab.url||'')).map(async tab=>{
  const host=new URL(tab.url).hostname;
  const social=MediaAdapters.select(host).id!=='generic';
  if(!social){
   await connectCollector(tab.id);
   return;
  }
  const siteMatches=pattern=>{
   if(pattern.startsWith('https:')&&!tab.url.startsWith('https:'))return false;
   const domain=pattern.split('/')[2];
   if(!domain||domain==='*')return false;
   if(domain.startsWith('*.'))return host===domain.slice(2)||host.endsWith(domain.slice(1));
   return host===domain;
  };
  // Install document-start observers on the next navigation, as they need to precede playback.
  for(const entry of declarations.filter(entry=>entry.run_at==='document_idle'&&entry.matches.some(siteMatches))){
   if(entry.css)await chrome.scripting.insertCSS({target:{tabId:tab.id},files:entry.css});
   await chrome.scripting.executeScript({target:{tabId:tab.id},files:entry.js});
  }
 }));
}
chrome.runtime.onInstalled.addListener(({reason}={})=>{
 if(['install','update'].includes(reason))reconnectOpenTabs().catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>serial(recover));chrome.runtime.onInstalled.addListener(()=>serial(recover));
