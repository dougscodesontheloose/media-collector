/* Instagram e X, MAIN world. Apenas memória volátil e apenas SourceBuffers não criptografados. */
(()=>{
 if(window.__mediaCollectorMSE)return;window.__mediaCollectorMSE=true;
 const MAX_TOTAL=96*1024*1024,MAX_ONE=48*1024*1024,TTL=180000,records=new Map(),bySource=new WeakMap(),byBuffer=new WeakMap(),encrypted=new WeakSet();
 const expired=new Set();let used=0;
 function allowed(){return !/^\/(direct|accounts|messages|i\/chat)(?:\/|$)/i.test(location.pathname);}
 function rememberCoverage(track){
  const ranges=track.coverage.slice();
  for(let i=0;i<track.sb.buffered.length;i++)ranges.push([track.sb.buffered.start(i),track.sb.buffered.end(i)]);
  ranges.sort((a,b)=>a[0]-b[0]);track.coverage=[];
  for(const range of ranges){const last=track.coverage.at(-1);if(last&&range[0]<=last[1]+.05)last[1]=Math.max(last[1],range[1]);else track.coverage.push(range);}
 }
 function discard(rec){if(rec.discarded)return;rec.discarded=true;used-=rec.bytes;rec.bytes=0;for(const track of rec.tracks){track.pending=null;track.chunks=[];track.seen.clear();}records.delete(rec.url);}
 function prune(){
  const now=Date.now();
  for(const record of records.values()){
   if(!allowed())discard(record);
   else if(now-record.updated>TTL){
    expired.add(record.url);
    if(expired.size>32)expired.delete(expired.values().next().value);
    discard(record);
   }
  }
 }
 function fingerprint(bytes){let h=2166136261;for(let i=0;i<bytes.length;i++)h=Math.imul(h^bytes[i],16777619);return `${bytes.length}:${h>>>0}`;}
 function equalBytes(a,b){return a.length===b.length&&a.every((value,i)=>value===b[i]);}
 function mp4ReplayKind(bytes){
  // A repeated piece of a split box may be real data. Only skip complete units.
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),boxes=[];
  for(let offset=0;offset<bytes.length;){
   if(offset+8>bytes.length)return null;
   const size=view.getUint32(offset);
   if(size<8||size>bytes.length-offset)return null;
   boxes.push(String.fromCharCode(...bytes.subarray(offset+4,offset+8)));
   offset+=size;
  }
  if(boxes.some(box=>box==='ftyp'||box==='moov')&&boxes.every(box=>['ftyp','moov','free','skip','pdin'].includes(box)))return boxes.includes('moov')?'init':'header';
  if(boxes.includes('moof')&&boxes.includes('mdat')&&boxes.every(box=>['styp','sidx','emsg','prft','moof','mdat','free','skip'].includes(box)))return 'media';
  return null;
 }
 function placement(sb){return [sb.mode,sb.timestampOffset,sb.appendWindowStart,sb.appendWindowEnd].join('|');}
 function prepareAppend(rec,track,input){
  const view=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
  if(!view.byteLength)return null;
  if(view.byteLength>MAX_ONE)return {error:'O vídeo ultrapassou o limite de memória da captura local.'};
  const key=fingerprint(view),position=placement(track.sb),mp4=/\/mp4(?:\s*;|\s*$)/i.test(track.mime);
  const kind=mp4?mp4ReplayKind(view):null;
  const bucket=track.seen.get(key)||[];
  const duplicate=bucket.find(prior=>equalBytes(prior.bytes,view));
  if(duplicate){
   if(kind==='init'||kind==='header'||(kind==='media'&&track.sb.mode==='segments'&&duplicate.position===position))return {duplicate:true};
   return {error:'Um fragmento repetido mudou de posição ou usa um formato que não permite confirmar a repetição.'};
  }
  if(kind==='init'&&track.init)return {error:'O player trocou a configuração da mídia durante a reprodução.'};
  if(used+view.byteLength>MAX_TOTAL||rec.bytes+view.byteLength>MAX_ONE)return {error:'O vídeo ultrapassou o limite de memória da captura local.'};
  return {key,position,kind,bytes:new Uint8Array(view)};
 }
 function interrupted(rec,track){
  if(!track.pending)return;
  const size=track.pending.bytes?.byteLength||0;
  rec.bytes-=size;used-=size;track.pending=null;
  track.error='O player interrompeu a leitura de um fragmento antes de confirmar a captura.';
 }
 function updated(rec,track){
  const accepted=track.pending;
  track.pending=null;
  if(!accepted||track.error||rec.discarded)return;
  if(accepted.error){track.error=accepted.error;return;}
  if(accepted.bytes){
   if(accepted.kind==='init')track.init=true;
   const bucket=track.seen.get(accepted.key)||[];
   bucket.push(accepted);track.seen.set(accepted.key,bucket);
   track.chunks.push(accepted.bytes);
  }
  try{rememberCoverage(track);}catch{track.error='Não foi possível verificar os intervalos da transmissão.';}
  rec.updated=Date.now();
 }
 document.addEventListener('encrypted',e=>{if(e.target instanceof HTMLMediaElement)encrypted.add(e.target);},true);
 const create=URL.createObjectURL;URL.createObjectURL=function(obj){let url=Reflect.apply(create,this,arguments);if(allowed()&&obj instanceof MediaSource){let rec={url,source:obj,tracks:[],bytes:0,updated:Date.now(),discarded:false};records.set(url,rec);bySource.set(obj,rec);}return url;};
 const add=MediaSource.prototype.addSourceBuffer;
 MediaSource.prototype.addSourceBuffer=function(mime){
  const sb=Reflect.apply(add,this,arguments),rec=bySource.get(this);
  if(rec&&!rec.discarded){
   const track={mime:String(mime),chunks:[],coverage:[],seen:new Map(),error:null,init:false,pending:null,sb};
   rec.tracks.push(track);byBuffer.set(sb,{rec,track});
   sb.addEventListener('error',()=>interrupted(rec,track));
   sb.addEventListener('abort',()=>interrupted(rec,track));
   sb.addEventListener('updateend',()=>updated(rec,track));
  }
  return sb;
 };
 const changeType=SourceBuffer.prototype.changeType;
 if(changeType)SourceBuffer.prototype.changeType=function(mime){
  const result=Reflect.apply(changeType,this,arguments);
  const track=byBuffer.get(this)?.track;
  if(track&&track.mime.toLowerCase()!==String(mime).toLowerCase()){
   if(track.chunks.length)track.error='O player alterou o formato durante a reprodução.';
   else track.mime=String(mime);
  }
  return result;
 };
 const append=SourceBuffer.prototype.appendBuffer;
 SourceBuffer.prototype.appendBuffer=function(input){
  prune();
  const pair=byBuffer.get(this);
  if(!pair||pair.rec.discarded||pair.track.error||!allowed()||this.updating)return Reflect.apply(append,this,arguments);
  const {rec,track}=pair;
  let pending;
  try{pending=prepareAppend(rec,track,input);}catch{pending={error:'Não foi possível guardar um fragmento da transmissão.'};}
  // Synchronous rejections (for example QuotaExceededError) can legitimately be retried.
  const result=Reflect.apply(append,this,arguments);
  track.pending=pending;
  const size=pending?.bytes?.byteLength||0;
  rec.bytes+=size;used+=size;
  return result;
 };
 // Revocation can happen as soon as a player has attached the MediaSource.
 // The element keeps playing it, so expiration still governs our copy.
 new MutationObserver(()=>{if(!allowed())prune();}).observe(document.documentElement||document,{subtree:true,childList:true});
 setInterval(prune,15000);addEventListener('pagehide',()=>{for(const r of records.values())discard(r);});
 addEventListener('message',event=>{
  const msg=event.data;if(event.source!==window||!msg||msg.channel!=='media-collector-mse-request'||typeof msg.id!=='string')return;
  const respond=data=>window.postMessage({channel:'media-collector-mse-response',id:msg.id,...data},location.origin);
  prune();if(!allowed()||msg.pathname!==location.pathname)return respond({error:'O Story ou post mudou durante a captura.'});
  const el=[...document.querySelectorAll('video')].find(v=>(v.currentSrc||v.src)===msg.blob);const rec=records.get(msg.blob);
  if(!el||!el.isConnected)return respond({error:'O player mudou. Atualize a lista de mídias.'});
  if(encrypted.has(el)||el.mediaKeys)return respond({error:'Este vídeo usa proteção e não pode ser processado.'});
  if(expired.has(msg.blob))return respond({error:'Os trechos guardados expiraram. Reabra o player com a captura ativa e reproduza o vídeo.'});
  if(!rec||rec.discarded)return respond({error:'O player foi carregado antes da captura ou não expôs os trechos aqui. Reabra o player com a captura ativa.'});
  const duration=el.duration;if(!Number.isFinite(duration)||duration<=0)return respond({retry:true,error:'A duração do vídeo ainda não está disponível.'});
  const failed=rec.tracks.find(t=>t.error);
  if(failed)return respond({error:failed.error});
  if(!rec.tracks.length||rec.tracks.some(t=>t.pending||!t.chunks.length))return respond({retry:true,error:'Aguardando os próximos fragmentos de vídeo.'});
  for(const track of rec.tracks){
   const ranges=track.coverage;
   if(ranges.length!==1||ranges[0][0]>.15||ranges[0][1]<duration-Math.max(.35,duration*.02))return respond({retry:true,error:'A reprodução ainda não disponibilizou todos os trechos de vídeo e áudio.'});
  }
  const videos=rec.tracks.filter(t=>/^video\//i.test(t.mime)),audios=rec.tracks.filter(t=>/^audio\//i.test(t.mime));
  if(videos.length!==1||audios.length>1||videos.length+audios.length!==rec.tracks.length)return respond({error:'As faixas do vídeo são ambíguas; não é possível identificar áudio e vídeo com segurança.'});
  const embedded=/mp4a|opus|vorbis/i.test(videos[0].mime);if(embedded&&audios.length)return respond({error:'Há múltiplas fontes de áudio; não é possível determinar qual corresponde ao vídeo.'});
  if(!embedded&&!audios.length)return respond({error:'Não foi possível confirmar a faixa de áudio deste vídeo.'});
  const tracks=[...rec.tracks].sort((a,b)=>(/^video\//i.test(b.mime)?1:0)-(/^video\//i.test(a.mime)?1:0)).map(t=>({mime:t.mime,chunks:t.chunks}));rec.updated=Date.now();respond({duration,tracks});
 });
})();
