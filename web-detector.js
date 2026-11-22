/* Scanned only when the user opens or refreshes the panel. */
(() => {
 if (globalThis.MediaWebDetector) return;
 const mediaSelector = 'video,audio';
 let captureEnabled=false;
 const players=new Map(),ids=new WeakMap();
 function roots(root, result) {
  result.push(root);
  for (const element of root.querySelectorAll('*')) {
   if (element.shadowRoot) roots(element.shadowRoot, result);
  }
  return result;
 }
 function absolute(source) {
  if (!source) return null;
  try {
   const url = new URL(source, document.baseURI);
   return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
 }
 function format(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (/\.m3u8$/.test(path)) return 'hls';
  if (/\.mpd$/.test(path)) return 'dash';
  return 'direct';
 }
 function sources(element){
  return [element.currentSrc,element.getAttribute('src'),
   ...[...element.querySelectorAll('source[src]')].map(source=>source.getAttribute('src'))].filter(Boolean);
 }
 function scan() {
  const items = [], elements = [];
  const allRoots = roots(document, []);
  for (const root of allRoots) elements.push(...root.querySelectorAll(mediaSelector));
  for (const [index, element] of elements.entries()) {
   const kind = element.tagName === 'AUDIO' ? 'audio' : 'video';
   const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null;
   if(!ids.has(element)){const key=crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');ids.set(element,key);players.set(key,element);}
   const player = ids.get(element);
   const playerLabel = element.getAttribute('aria-label') || element.getAttribute('title') || 'Player ' + (index + 1);
   const general = !/(^|\.)(instagram\.com|x\.com|twitter\.com|reddit\.com)$/i.test(location.hostname);
   const currentSource = element.currentSrc;
   const protectedMedia = !!element.mediaKeys;
   const rawSources = sources(element);
   const seen = new Set();
   if (!rawSources.length) rawSources.push('');
   for (const raw of rawSources) {
    const url = absolute(raw);
    const key=url||raw||'temporaria';
    if (seen.has(key)) continue;
    seen.add(key);
    const blob=/^blob:/.test(raw);
    const capture=blob && captureEnabled && kind==='video' && !protectedMedia && element.getRootNode()===document;
    const unknown = !url;
    const current = !general || raw === currentSource || url && url === absolute(currentSource);
    const reason = protectedMedia ? 'Player com proteção de mídia.' :
     capture ? 'Fonte temporária em captura. Os trechos precisam cobrir toda a reprodução.' :
     blob ? 'Fonte temporária. Ative a captura e reabra o player nesta página.' :
     unknown ? 'Inicie a reprodução para o player disponibilizar a fonte.' : '';
    items.push({
     id: player + ':' + (url || raw || 'temporaria'), kind, url: url || '', source: capture ? raw : '', format: capture ? 'mse' : url ? format(url) : '',
     available: (!!url || capture) && !protectedMedia, reason,
     width: current ? element.videoWidth || (general ? 0 : element.clientWidth) : 0,
     height: current ? element.videoHeight || (general ? 0 : element.clientHeight) : 0,
     duration: current ? duration : null, capture,
     site: location.hostname, page: '', player, playerLabel,
     association: 'player', expectedAudio: kind === 'audio' ? true : null
    });
   }
  }
  return {items, frameUrl:location.href};
 }
 function enable(){captureEnabled=true;return true;}
 function confirm(id,url){
  const element=players.get(id);
  return !!element?.isConnected&&!element.mediaKeys&&sources(element).some(source=>absolute(source)===url);
 }
 async function capture(id,source,output){
  const element=players.get(id);
  if(!element?.isConnected||(element.currentSrc||element.src)!==source||!captureEnabled)throw Error('O player ou sua mídia mudou. Atualize a lista.');
  if(element.mediaKeys)throw Error('Este vídeo usa proteção e não pode ser processado.');
  return MediaCapture.download(element,{site:location.hostname,page:'',postUrl:location.href},output,true);
 }

 function directMP4(id,url){
  if(!confirm(id,url)||format(url)!=='direct')return false;
  const element=players.get(id);
  const typed=[...element.querySelectorAll('source[src]')].some(source=>
   absolute(source.getAttribute('src'))===url&&source.type.split(';')[0].trim().toLowerCase()==='video/mp4');
  return typed||/\.mp4$/i.test(new URL(url).pathname);
 }
 async function metadata(id,url){
  if(!confirm(id,url))return null;
  const element=players.get(id);
  if(element.currentSrc&&absolute(element.currentSrc)!==url)return null;
  if(element.readyState===0){
   element.preload='metadata';
   element.load();
  }
  const until=Date.now()+10000;
  while(Date.now()<until){
   if(!confirm(id,url)||element.error)return null;
   if(absolute(element.currentSrc)===url&&element.videoWidth&&element.videoHeight)
    return {width:element.videoWidth,height:element.videoHeight,duration:Number.isFinite(element.duration)?element.duration:null};
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  return null;
 }
 globalThis.MediaWebDetector = {scan,enable,confirm,directMP4,metadata,capture};
})();
