import { Parser } from 'm3u8-parser';
import { parse as parseMpd } from 'mpd-parser';
function abs(url,base){let u=new URL(url,base);if(!['http:','https:'].includes(u.protocol))throw Error('Endereço de mídia não suportado.');return u.href;}
async function getText(url){let r=await fetch(url,{credentials:'include',cache:'no-store'});if([401,403].includes(r.status))throw Error('O site recusou o acesso ao manifesto (HTTP '+r.status+'). Reproduza o vídeo na sua sessão e tente novamente.');if([404,410].includes(r.status))throw Error('O manifesto está indisponível ou expirou (HTTP '+r.status+'). Reabra o player e atualize a lista.');if(!r.ok)throw Error(`Não foi possível ler o manifesto (${r.status}).`);let s=await r.text();if(s.length>4*1024*1024)throw Error('Manifesto grande demais.');return s;}
function hls(text){let p=new Parser();p.push(text);p.end();return p.manifest;}
function hlsSegments(playlist,base){
 if(!playlist.endList)throw Error('Transmissões ao vivo ainda não são suportadas.');
 if(!playlist.segments?.length)throw Error('O manifesto não contém segmentos.');
 let out=[],lastMap='',lastRangeEnd=0;
 for(const seg of playlist.segments){
  if(seg.key?.method && seg.key.method!=='NONE')throw Error('Vídeo criptografado ou protegido não é suportado.');
  if(seg.discontinuity)throw Error('Transmissão com descontinuidades não é suportada nesta versão.');
  if(seg.map){let u=abs(seg.map.uri,base);const r=seg.map.byterange||null;let k=u+JSON.stringify(r);if(k!==lastMap){out.push({url:u,range:r});lastMap=k;}}
  let range=seg.byterange?{length:seg.byterange.length,offset:seg.byterange.offset ?? lastRangeEnd}:null;
  if(range)lastRangeEnd=range.offset+range.length;
  out.push({url:abs(seg.uri,base),range});
 }
 return out;
}
function dashSegments(list,base){let out=[],last='';for(const s of list||[]){if(s.key||s.contentProtection)throw Error('Vídeo protegido não é suportado.');if(s.map){let u=abs(s.map.resolvedUri||s.map.uri,base),r=s.map.byterange||null,k=u+JSON.stringify(r);if(k!==last){out.push({url:u,range:r});last=k;}}out.push({url:abs(s.resolvedUri||s.uri,base),range:s.byterange||null});}return out;}
function quality(p,i){return {id:String(i),label:`${p.attributes?.RESOLUTION?.height ? p.attributes.RESOLUTION.height+'p' : 'Vídeo'}${p.attributes?.BANDWIDTH ? ' · '+Math.round(p.attributes.BANDWIDTH/1000)+' kb/s':''}`,width:p.attributes?.RESOLUTION?.width||0,height:p.attributes?.RESOLUTION?.height||0,bandwidth:p.attributes?.BANDWIDTH||0};}
async function inspect(url,format){let text=await getText(url);if(format==='hls'){let m=hls(text);return (m.playlists||[]).map(quality).sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);}if(/<ContentProtection\b/i.test(text))throw Error('Vídeo protegido não é suportado.');let m=parseMpd(text,{manifestUri:url});return (m.playlists||[]).map(quality).sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);}
async function resolve(url,format,choice){
 let text=await getText(url),tracks=[];
 if(format==='hls'){
  let m=hls(text), videoBase=url, audio=null;
  if(m.playlists?.length){let variants=m.playlists.map((p,i)=>({p,...quality(p,i)})).sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);let chosen=variants.find(v=>v.id===String(choice))||variants[0];videoBase=abs(chosen.p.uri,url);let group=chosen.p.attributes?.AUDIO;if(group && m.mediaGroups?.AUDIO?.[group]){let entries=Object.values(m.mediaGroups.AUDIO[group]);let a=entries.find(x=>x.default&&x.uri)||entries.find(x=>x.uri);if(a)audio=abs(a.uri,url);}m=hls(await getText(videoBase));}
  tracks.push(hlsSegments(m,videoBase));if(audio)tracks.push(hlsSegments(hls(await getText(audio)),audio));
 }else if(format==='dash'){
  if(/<ContentProtection\b/i.test(text))throw Error('Vídeo criptografado ou protegido não é suportado.');
  if(/<MPD\b[^>]*\btype=["']dynamic["']/i.test(text))throw Error('Transmissões ao vivo ainda não são suportadas.');
  let m=parseMpd(text,{manifestUri:url});let variants=(m.playlists||[]).map((p,i)=>({p,...quality(p,i)})).sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);let chosen=variants.find(v=>v.id===String(choice))||variants[0];if(!chosen)throw Error('Nenhuma faixa de vídeo compatível encontrada.');tracks.push(dashSegments(chosen.p.segments,url));
  const groups=m.mediaGroups?.AUDIO||{};const audios=Object.values(groups).flatMap(g=>Object.values(g)).flatMap(x=>x.playlists||[]).sort((a,b)=>(b.attributes?.BANDWIDTH||0)-(a.attributes?.BANDWIDTH||0));if(audios[0])tracks.push(dashSegments(audios[0].segments,url));
 }else throw Error('Formato de transmissão não reconhecido.');
 if(tracks.some(t=>!t.length))throw Error('A transmissão não contém segmentos utilizáveis.');return tracks;
}
export {inspect,resolve};
