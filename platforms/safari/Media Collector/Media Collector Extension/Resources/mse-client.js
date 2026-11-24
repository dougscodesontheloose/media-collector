/* Ponte isolada: snapshot somente do elemento escolhido; bytes não são persistidos. */
(()=>{
 if(globalThis.MediaCapture)return;
 const waiters=new Map();
 window.addEventListener('message',event=>{let d=event.data;if(event.source!==window||d?.channel!=='media-collector-mse-response'||!waiters.has(d.id))return;let fn=waiters.get(d.id);waiters.delete(d.id);fn(d);});
 async function snapshot(video){
  const blob=video.currentSrc||video.src,path=location.pathname;
  if(!/^blob:/.test(blob||''))throw Error('O vídeo atual não utiliza uma fonte temporária reconhecida.');
  const id=crypto.randomUUID();let result=await new Promise((resolve,reject)=>{let timer=setTimeout(()=>{waiters.delete(id);reject(Error('Não foi possível ler a captura local do vídeo.'));},2500);waiters.set(id,data=>{clearTimeout(timer);resolve(data)});window.postMessage({channel:'media-collector-mse-request',id,blob,pathname:path},location.origin);});
  if(!video.isConnected||(video.currentSrc||video.src)!==blob||location.pathname!==path)throw Error('O Story ou post mudou durante a captura.');
  if(result.error)throw Object.assign(Error(result.error),{retry:result.retry===true});
  if(!result.tracks?.length||!Number.isFinite(result.duration))throw Error('A captura local está incompleta.');return {tracks:result.tracks,duration:result.duration,blob,pathname:path};
 }
 function encode(bytes){let text='';for(let offset=0;offset<bytes.length;offset+=8192)text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(text);}
 async function waitForSnapshot(video,stopped,onWait,ensureCurrent){
  const path=location.pathname,source=video.currentSrc||video.src;
  // Keep observing the clicked player while the site supplies its remaining segments.
  const duration=Number.isFinite(video.duration)?video.duration:0;
  const deadline=Date.now()+Math.min(120000,Math.max(20000,(duration-(video.currentTime||0)+8)*1000));
  let waiting=false;
  for(;;){
   if(stopped())throw Error('Coleta interrompida pelo usuário.');
   ensureCurrent?.();
   if(!video.isConnected||location.pathname!==path||(video.currentSrc||video.src)!==source)throw Error('O Story ou post mudou antes de carregar todos os trechos.');
   try{const result=await snapshot(video);ensureCurrent?.();return result;}catch(error){
    if(!error.retry||Date.now()>=deadline)throw error;
    if(!waiting){waiting=true;onWait?.();if(video.paused&&!video.ended)video.play().catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,350));
   }
  }
 }
 async function download(video,info,outputFormat='mp4',waitForCompletion=false,stopped=()=>false,onWait,onProcessing,ensureCurrent){
  const snap=await waitForSnapshot(video,stopped,onWait,ensureCurrent);const reply=await chrome.runtime.sendMessage({target:'worker',action:'mse-prepare',item:info,outputFormat,duration:snap.duration,tracks:snap.tracks.map(t=>t.mime)});
  if(reply?.error)throw Error(reply.error);const token=reply.token;
  try{
   for(let track=0;track<snap.tracks.length;track++)for(const chunk of snap.tracks[track].chunks)for(let offset=0;offset<chunk.length;offset+=262144){if(stopped())throw Error('Coleta interrompida pelo usuário.');ensureCurrent?.();if(!video.isConnected||(video.currentSrc||video.src)!==snap.blob||location.pathname!==snap.pathname)throw Error('O Story ou post mudou durante a captura.');const r=await chrome.runtime.sendMessage({target:'processor',action:'mse-append',token,track,data:encode(chunk.subarray(offset,offset+262144))});if(r?.error)throw Error(r.error);}
   if(stopped())throw Error('Coleta interrompida pelo usuário.');
   ensureCurrent?.();
   if(!video.isConnected||(video.currentSrc||video.src)!==snap.blob||location.pathname!==snap.pathname)throw Error('O Story ou post mudou durante a captura.');
   const done=await chrome.runtime.sendMessage({target:'processor',action:'mse-finish',token});if(done?.error)throw Error(done.error);
   onProcessing?.();
   if(waitForCompletion){for(;;){await new Promise(resolve=>setTimeout(resolve,300));const status=await chrome.runtime.sendMessage({target:'worker',action:'status'});const job=status?.job;if(job?.captureToken!==token)throw Error('A fila de vídeo foi substituída antes da conclusão.');if(job.status==='cancelled')throw Error('Download de vídeo cancelado.');if(job.status==='finished'){if(job.failed||!job.done)throw Error(job.errors?.[0]||'Não foi possível salvar o vídeo.');break;}if(stopped())throw Error('Coleta interrompida pelo usuário.');}}
   return {ok:true};
  }catch(e){await chrome.runtime.sendMessage({target:'worker',action:'mse-abort',token}).catch(()=>{});throw e;}
 }
 function findPlayer(scope){
  const videos=[...scope.querySelectorAll('video')].filter(video=>{
   const rect=video.getBoundingClientRect();return rect.width>0&&rect.height>0;
  });
  return videos.length===1?videos[0]:null;
 }
 async function startPlayer(scope,trigger){
  let video=findPlayer(scope);
  if(video&&(video.currentSrc||video.src))return video;
  const path=location.pathname;
  trigger?.click();
  for(let i=0;i<24;i++){
   await new Promise(resolve=>setTimeout(resolve,250));
   if(location.pathname!==path||!scope.isConnected)throw Error('A publicação mudou durante a identificação do player.');
   video=findPlayer(scope);
   if(video&&(video.currentSrc||video.src||video.querySelector('source[src]')))return video;
  }
  throw Error('O player ainda não disponibilizou o vídeo. Inicie a reprodução neste post e tente novamente.');
 }
 globalThis.MediaCapture={snapshot,download,findPlayer,startPlayer};
})();
