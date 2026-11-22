import {FFmpeg} from './vendor/ffmpeg/index.js';
let active=null;
const cap=512*1024*1024;
const send = message => chrome.runtime.sendMessage({target:'worker',...message}).catch(()=>{});
const delay = ms => new Promise(r=>setTimeout(r,ms));
const audioOutputs = new Set(['mp3','m4a','audio-original']);

// ffprobe in the bundled wasm may return a nonzero code even when it writes JSON.
// Treat a parseable report as authoritative, and fail if required fields are absent.
async function probe(ffmpeg, input, report) {
 await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration,format_name:stream=codec_type,codec_name,duration,pix_fmt','-of','json',input,'-o',report]);
 try {
  const result=JSON.parse(await ffmpeg.readFile(report,'utf8'));
  if(!Array.isArray(result.streams))throw Error('missing streams');
  return result;
 } catch { throw Error('Não foi possível inspecionar as faixas e a duração da mídia.'); }
}
function sourceDuration(report) {
 const values=[report.format?.duration,...report.streams.map(stream=>stream.duration)].map(Number).filter(value=>Number.isFinite(value)&&value>0);
 return values.length?Math.max(...values):null;
}
function outputSpec(task, inputs) {
 const mode=task.item.output||'mp4',audioOnly=audioOutputs.has(mode);
 const streams=inputs.flatMap(input=>input.streams);
 const video=streams.find(stream=>stream.codec_type==='video');
 const audio=streams.find(stream=>stream.codec_type==='audio');
 if(audioOnly&&!audio)throw Error('Nenhuma faixa de áudio foi identificada na mídia.');
 if(!audioOnly&&!video)throw Error('Nenhuma faixa de vídeo foi identificada na mídia.');
 if(mode==='mp3')return {extension:'mp3',mime:'audio/mpeg',audioOnly,codec:['-c:a','libmp3lame','-b:a','192k']};
 if(mode==='m4a')return {extension:'m4a',mime:'audio/mp4',audioOnly,codec:['-c:a','aac','-b:a','192k']};
 if(mode==='audio-original'){
  const formats={aac:['m4a','audio/mp4'],mp3:['mp3','audio/mpeg'],opus:['ogg','audio/ogg'],vorbis:['ogg','audio/ogg'],flac:['flac','audio/flac'],pcm_s16le:['wav','audio/wav']};
  const selected=formats[audio.codec_name];
  if(!selected)throw Error('O formato original do áudio não pode ser salvo com segurança. Escolha MP3 ou M4A.');
  return {extension:selected[0],mime:selected[1],audioOnly,codec:['-c:a','copy']};
 }
 if(mode==='webm')return {extension:'webm',mime:'video/webm',audioOnly:false,codec:['-c:v','libvpx','-deadline','realtime','-cpu-used','8','-c:a','libvorbis']};
 if(mode==='original'){
  const kind=inputs[0].format?.format_name||'';
  if(/(?:^|,)mov(?:,|$)|(?:^|,)mp4(?:,|$)/.test(kind))return {extension:'mp4',mime:'video/mp4',audioOnly:false,codec:['-c','copy']};
  if(/(?:^|,)webm(?:,|$)/.test(kind))return {extension:'webm',mime:'video/webm',audioOnly:false,codec:['-c','copy']};
  if(/(?:^|,)matroska(?:,|$)/.test(kind))return {extension:'mkv',mime:'video/x-matroska',audioOnly:false,codec:['-c','copy']};
  throw Error('O contêiner original não foi identificado com segurança. Escolha MP4 ou WebM.');
 }
 if(video.codec_name==='h264'&&video.pix_fmt==='yuv420p'&&(!audio||audio.codec_name==='aac'))return {extension:'mp4',mime:'video/mp4',audioOnly:false,codec:['-c','copy']};
 return {extension:'mp4',mime:'video/mp4',audioOnly:false,codec:['-c:v','libx264','-preset','ultrafast','-c:a','aac']};
}
async function checkpoint(task){while(task.paused&&!task.cancelled)await delay(250);if(task.cancelled)throw Error('Processamento cancelado.');}
async function run(task){
 try {
  await send({action:'stream-progress',token:task.token,phase:'Lendo manifesto',completed:0,total:0});
  const tracks=task.item.format==='mse'?[]:task.item.format==='convert'?[[{url:task.item.url}]]:await StreamTools.resolve(task.item.url,task.item.format,task.item.quality);
  const total=tracks.reduce((n,x)=>n+x.length,0);let completed=0,bytes=0;const files=[],rangeResources=new Map();
  if(task.item.format==='mse'){for(const track of task.parts){let size=track.reduce((n,p)=>n+p.length,0);let joined=new Uint8Array(size),position=0;for(const part of track){joined.set(part,position);position+=part.length;}files.push(joined);}task.parts=[];}
  for(const track of tracks){const parts=[];for(const part of track){
   await checkpoint(task);
   let headers={};if(part.range){let offset=part.range.offset||0;headers.Range=`bytes=${offset}-${offset+part.range.length-1}`;}
   const response=await fetch(part.url,{credentials:'include',headers,signal:task.abort.signal});
   if([401,403].includes(response.status))throw Error('O site recusou o acesso à mídia (HTTP '+response.status+'). Abra ou reproduza o vídeo na sua sessão e tente novamente.');
   if([404,410].includes(response.status))throw Error('A fonte da mídia está indisponível ou expirou (HTTP '+response.status+'). Reabra o player e atualize a lista.');
   if(!response.ok || (part.range ? response.status!==206 : response.status===206))throw Error(`Falha ao baixar segmento (${response.status}).`);
   const declared=Number(response.headers.get('content-length'))||0;if(bytes+declared>cap)throw Error('Vídeo excede o limite local de 512 MB para processamento.');
   if(part.range){const match=(response.headers.get('content-range')||'').match(/^bytes (\d+)-(\d+)\/(\d+)$/i);const start=part.range.offset||0,end=start+part.range.length-1;if(!match||Number(match[1])!==start||Number(match[2])!==end||Number(match[3])<=end)throw Error('Intervalo de mídia inconsistente; arquivo incompleto.');const metadata={total:Number(match[3]),etag:response.headers.get('etag'),modified:response.headers.get('last-modified')},prior=rangeResources.get(part.url);if(prior&&(prior.total!==metadata.total||(prior.etag&&metadata.etag&&prior.etag!==metadata.etag)||(prior.modified&&metadata.modified&&prior.modified!==metadata.modified)))throw Error('A origem mudou durante o download dos intervalos.');rangeResources.set(part.url,{total:metadata.total,etag:metadata.etag||prior?.etag,modified:metadata.modified||prior?.modified});}
   const data=new Uint8Array(await response.arrayBuffer());if(part.range&&data.length!==part.range.length)throw Error('Intervalo de mídia incompleto.');if(declared&&!response.headers.get('content-encoding')&&data.length!==declared)throw Error('Resposta de mídia incompleta.');bytes+=data.length;if(bytes>cap)throw Error('Vídeo excede o limite local de 512 MB para processamento.');parts.push(data);completed++;
   await send({action:'stream-progress',token:task.token,phase:'Baixando segmentos',completed,total});
  }let joined=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){joined.set(p,pos);pos+=p.length;}files.push(joined);}
  await checkpoint(task);await send({action:'stream-progress',token:task.token,phase:'Preparando vídeo',completed:0,total:0});
  task.ffmpeg=new FFmpeg();await task.ffmpeg.load({coreURL:chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.js'),wasmURL:chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.wasm')});
  await checkpoint(task);for(let i=0;i<files.length;i++)await task.ffmpeg.writeFile(`input${i}`,files[i]);
  const reports=[];
  for(let i=0;i<files.length;i++)reports.push(await probe(task.ffmpeg,`input${i}`,`source${i}.json`));
  const spec=outputSpec(task,reports),sources=reports.flatMap(report=>report.streams);
  const sourceAudio=sources.some(stream=>stream.codec_type==='audio');
  if(task.item.expectedAudio===true&&!sourceAudio)throw Error('A faixa de áudio esperada não foi encontrada.');
  const args=['-i','input0'];
  if(files.length>1)args.push('-i','input1');
  if(spec.audioOnly){
   const audioInput=reports.findIndex(report=>report.streams.some(stream=>stream.codec_type==='audio'));
   args.push('-map',`${audioInput}:a:0`,'-vn');
  }else if(files.length>1){
   const videoInput=reports.findIndex(report=>report.streams.some(stream=>stream.codec_type==='video'));
   const audioInput=reports.findIndex(report=>report.streams.some(stream=>stream.codec_type==='audio'));
   args.push('-map',`${videoInput}:v:0`);
   if(audioInput>=0)args.push('-map',`${audioInput}:a:0`);
  }else{
   args.push('-map','0:v:0');
   if(sourceAudio)args.push('-map','0:a:0');
  }
  args.push(...spec.codec);
  if(spec.extension==='mp4'||spec.extension==='m4a')args.push('-movflags','+faststart');
  const out=`output.${spec.extension}`;
  args.push(out);
  const code=await task.ffmpeg.exec(args);
  if(code!==0)throw Error('Não foi possível converter ou reunir as faixas desta mídia.');
  await checkpoint(task);
  const result=await probe(task.ffmpeg,out,'output-probe.json');
  const hasVideo=result.streams.some(stream=>stream.codec_type==='video');
  const hasAudio=result.streams.some(stream=>stream.codec_type==='audio');
  if(spec.audioOnly&&!hasAudio)throw Error('O arquivo de áudio não contém uma faixa de áudio verificável.');
  if(!spec.audioOnly&&!hasVideo)throw Error('O arquivo resultante não contém vídeo verificável.');
  if(sourceAudio&&!hasAudio)throw Error('A faixa de áudio identificada não está no arquivo final.');
  if(spec.audioOnly&&hasVideo)throw Error('O arquivo de áudio contém uma faixa de vídeo inesperada.');
  const duration=sourceDuration(result);
  if(!duration)throw Error('Não foi possível verificar a duração do arquivo final.');
  const sourceLengths=reports.map(sourceDuration).filter(Boolean);
  const expectedDuration=task.duration||(sourceLengths.length?Math.max(...sourceLengths):null);
  if(expectedDuration&&Math.abs(duration-expectedDuration)>Math.max(.75,expectedDuration*.05))
   throw Error('A duração do arquivo não corresponde à mídia identificada.');
  await send({action:'stream-progress',token:task.token,phase:'Verificando arquivo',completed:0,total:0});
  if(await task.ffmpeg.exec(['-xerror','-i',out,'-f','null','-'])!==0)
   throw Error('O arquivo final contém quadros ou áudio inválidos.');
  await checkpoint(task);
  const output=await task.ffmpeg.readFile(out);
  if(!output.byteLength)throw Error('O arquivo processado ficou vazio.');
  task.blobUrl=URL.createObjectURL(new Blob([output],{type:spec.mime}));
  const inspection={duration,video:hasVideo,audio:hasAudio,audioExpected:sourceAudio?'present':task.item.expectedAudio===false?'absent':'unknown'};
  await send({action:'stream-ready',token:task.token,blobUrl:task.blobUrl,extension:spec.extension,mime:spec.mime,inspection});
 }catch(error){await send({action:'stream-error',token:task.token,error:error?.name==='AbortError'?'Processamento cancelado.':(error?.message||String(error))});if(active===task)active=null;}
 finally{if(task.ffmpeg)task.ffmpeg.terminate();}
}
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
 if(message?.target!=='processor')return;
 if(message.action==='native-resolve'){
  (async()=>{
   try{
    const item=message.item;
    const tracks=['hls','dash'].includes(item.format)?await StreamTools.resolve(item.url,item.format,item.quality):[[{url:item.url}]];
    reply({tracks});
   }catch(e){reply({error:e.message||'Não foi possível identificar as faixas.'});}
  })();
  return true;
 }else if(message.action==='mse-begin'){
  if(active){reply({error:'Já existe um vídeo em processamento.'});return;}
  if(!Array.isArray(message.tracks)||!message.tracks.length||message.tracks.length>2||!/^video\//i.test(message.tracks[0])||(message.tracks.length===2&&!/^audio\//i.test(message.tracks[1]))||!Number.isFinite(message.duration)||message.duration<=0){reply({error:'Captura inválida.'});return;}
  active={token:message.token,item:message.item,duration:message.duration,parts:message.tracks.map(()=>[]),size:0,paused:false,cancelled:false,abort:new AbortController(),ffmpeg:null,blobUrl:null};reply({ok:true});
 }else if(message.action==='mse-append'){
  if(!active||active.token!==message.token||!active.parts?.[message.track]||typeof message.data!=='string'||message.data.length>360000){reply({error:'Fragmento inválido ou captura encerrada.'});return;}
  try{let raw=atob(message.data),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);active.size+=data.length;if(active.size>48*1024*1024)throw Error('Vídeo excede o limite temporário de 48 MB.');active.parts[message.track].push(data);reply({ok:true});}catch(e){reply({error:e.message||'Falha ao receber fragmento.'});}
 }else if(message.action==='mse-finish'){
  if(!active||active.token!==message.token||!active.parts?.every(p=>p.length)){reply({error:'Captura incompleta.'});return;}run(active);reply({ok:true});
 }else if(message.action==='start'){
  if(active){reply({error:'Já existe um vídeo em processamento.'});return;}
  active={token:message.token,item:message.item,paused:false,cancelled:false,abort:new AbortController(),ffmpeg:null,blobUrl:null};run(active);reply({ok:true});
 }else if(message.action==='pause'){if(active&&active.token===message.token)active.paused=!!message.paused;reply({ok:true});}
 else if(message.action==='cancel'){if(active&&active.token===message.token){active.cancelled=true;active.abort.abort();if(active.ffmpeg)active.ffmpeg.terminate();if(active.blobUrl)URL.revokeObjectURL(active.blobUrl);active=null;}reply({ok:true});}
 else if(message.action==='release'){if(active&&active.token===message.token){if(active.blobUrl)URL.revokeObjectURL(active.blobUrl);active=null;}reply({ok:true});}
});
