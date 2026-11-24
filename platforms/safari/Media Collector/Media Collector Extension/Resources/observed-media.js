/* Validates standalone media responses without guessing which player owns them. */
(() => {
 'use strict';

 const videoExtensions=new Set(['mp4','m4v','webm','mov','ogv','mkv']);
 const audioExtensions=new Set(['mp3','m4a','aac','wav','ogg','flac','opus']);
 const segmentExtensions=new Set(['m4s','ts','cmfv','cmfa','mp2t','aacp']);
 const imageExtensions=new Set(['jpg','jpeg','png','webp','avif','gif','svg','bmp','ico','tif','tiff','jxl']);
 const hlsMimes=new Set(['application/vnd.apple.mpegurl','application/x-mpegurl','audio/mpegurl','audio/x-mpegurl']);
 const dashMimes=new Set(['application/dash+xml']);
 const genericMimes=new Set(['','application/octet-stream','binary/octet-stream','application/mp4','application/x-mp4']);
 const deniedMimes=new Set([
  'text/html','text/plain','application/json','application/xml','text/xml',
  'application/vnd.ms-playready.initiator+xml','application/vnd.ms-playready'
 ]);

 function normalizeMime(value){return String(value||'').split(';')[0].trim().toLowerCase();}
 function sourceKey(item){return JSON.stringify([item?.documentId,item?.frameId,item?.url]);}
 function opaqueId(value){let hash=14695981039346656037n;for(const char of String(value)){hash^=BigInt(char.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(16).padStart(16,'0');}
 function inspect(record){
  if(!record||![200,206].includes(Number(record.status)))return null;
  let url;
  try{url=new URL(record.url);}catch{return null;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
  const extension=url.pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||'';
  const mime=normalizeMime(record.mime);
  if(/[?&](?:range|bytestart|byteend)=/i.test(url.search)||segmentExtensions.has(extension)||mime==='video/mp2t'||mime==='application/octet-stream-segment')return null;
  if(imageExtensions.has(extension)||/^image\//.test(mime)||deniedMimes.has(mime)||record.protected===true)return null;

  let format='',kind='';
  const directExtensionKind=videoExtensions.has(extension)?'video':audioExtensions.has(extension)?'audio':'';
  const mediaMime=/^(?:video|audio)\/[a-z0-9.+-]+$/.test(mime);
  if(mime&&!genericMimes.has(mime)&&!hlsMimes.has(mime)&&!dashMimes.has(mime)&&!mediaMime)return null;
  if((extension==='m3u8'||hlsMimes.has(mime))&&directExtensionKind)return null;
  if((extension==='mpd'||dashMimes.has(mime))&&directExtensionKind)return null;
  if(extension==='m3u8'||hlsMimes.has(mime)){format='hls';kind='video';}
  else if(extension==='mpd'||dashMimes.has(mime)){format='dash';kind='video';}
  else {
   const extensionKind=directExtensionKind;
   const mimeKind=/^video\/[a-z0-9.+-]+$/.test(mime)?'video':/^audio\/[a-z0-9.+-]+$/.test(mime)?'audio':'';
   if(extensionKind&&mimeKind&&extensionKind!==mimeKind)return null;
   kind=mimeKind||extensionKind;
   if(!kind)return null;
   format='direct';
  }
  const pageOrigin=(()=>{try{return record.page?new URL(record.page).origin:'';}catch{return '';}})();
  return {url:url.href,origin:url.origin,sourceHost:url.hostname,pageOrigin,mime,format,kind,
   expectedBytes:Number.isSafeInteger(record.expectedBytes)&&record.expectedBytes>0?record.expectedBytes:undefined,
   status:Number(record.status)};
 }

 function candidates(observed,players,site){
  const playerKeys=new Set((players||[]).filter(item=>item?.association==='player'&&item?.url&&typeof item.documentId==='string'&&Number.isInteger(item.frameId)).map(sourceKey));
  const protectedKeys=new Set((players||[]).filter(item=>item?.association==='player'&&(item?.protected===true||(!item?.available&&/prote[cç][aã]o de m[ií]dia/i.test(item?.reason||'')))).map(sourceKey));
  const found=new Map();
  for(const record of observed||[]){
   if(typeof record?.documentId!=='string'||!record.documentId||!Number.isInteger(record.frameId))continue;
   const key=sourceKey(record);
   if(playerKeys.has(key)||protectedKeys.has(key))continue;
   const media=inspect(record);
   if(!media)continue;
   found.set(key,{
    id:'observed:'+record.frameId+':'+opaqueId(key),kind:media.kind,url:media.url,format:media.format,available:true,
    width:0,height:0,site:site||record.site||media.pageOrigin,
    page:record.page||'',sourceOrigin:media.origin,sourceHost:media.sourceHost,pageOrigin:media.pageOrigin,
    documentId:record.documentId,frameId:record.frameId,association:'observed-candidate',
    mime:media.mime,status:media.status,expectedBytes:media.expectedBytes,
    reason:media.kind==='video'?'Fonte de rede confirmada; não associada a um player. Confirme as dimensões antes de baixar o vídeo.':'Fonte de rede confirmada; não associada a um player.'
   });
  }
  return [...found.values()];
 }

 globalThis.ObservedMedia={inspect,candidates,sourceKey};
})();
