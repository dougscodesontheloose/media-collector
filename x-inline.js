(() => {
 if (globalThis.__coletorX) return;
 globalThis.__coletorX = true;
 const C = MediaCore, adapter = MediaAdapters.select(location.hostname);
 const playerSelector = '[data-testid="videoPlayer"], [data-testid="videoComponent"]';
 const photoSelector = '[data-testid="tweetPhoto"] img';
 document.querySelectorAll('.coletor-x-button,.coletor-x-message').forEach(el=>el.remove());

 function knownPoster(raw){
  try{
   const url=new URL(raw);
   return url.hostname==='pbs.twimg.com'&&/^\/(?:ext_tw_video|amplify_video|tweet_video)_thumb\//.test(url.pathname);
  }catch{return false;}
 }

 function owned(scope,selector,article=scope) {
  return [...scope.querySelectorAll(selector)].filter(el => el.closest('article') === article);
 }
 function notice(text) {
  document.querySelector('.coletor-x-message')?.remove();
  const el = document.createElement('div');
  el.className = 'coletor-x-message';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 6500);
 }
 function postInfo(article) {
  const ownLinks = owned(article,'a[href*="/status/"]');
  const candidates = [ownLinks.find(link => link.querySelector('time'))?.href,
   ...ownLinks.map(link => link.href)];
  if (document.querySelectorAll('article').length === 1) candidates.push(location.href);
  for (const href of candidates) {
   if (!href) continue;
   const url = new URL(href, location.origin);
   const match = /^(?:\/([A-Za-z0-9_]+)\/status|\/i\/web\/status)\/(\d+)(?:\/|$)/.exec(url.pathname);
   if (url.origin === location.origin && match) {
    const path = match[1] ? '/' + match[1] + '/status/' : '/i/web/status/';
    return {page:match[1] || '', post:match[2], postUrl:location.origin + path + match[2]};
   }
  }
  return {page:'',post:'',postUrl:''};
 }
 function item(info, kind, url, format='direct') {
  url = adapter.transform(url);
  return {id:info.post ? 'x:' + info.post + ':' + C.key(url) : C.key(url), kind, url,
   format, width:0, height:0, site:'x.com', ...info, available:true};
 }
 function sourceOf(video) {
  if (!video) return null;
  const src = C.absolute(MediaInline.sourceOf(video),document.baseURI);
  if (!src || /[?&](range|bytestart|byteend)=/i.test(src)) return null;
  const path = new URL(src).pathname;
  const sourceType=[...video.querySelectorAll('source[src]')].find(node=>node.src===src)?.type||'';
  return {url:src,sourceType,format:/\.m3u8$/i.test(path)?'hls':/\.mpd$/i.test(path)?'dash':'direct'};
 }
 function checkProtection(video) {
  if (video?.mediaKeys) throw Error('Este vídeo usa proteção e não pode ser processado.');
 }
 function assetKey(raw, poster) {
  try {
   const url = new URL(raw, location.origin);
   if (poster && url.hostname !== 'pbs.twimg.com' && url.hostname !== 'video.twimg.com') return null;
   const path=poster?url.pathname.replace(/^(\/(?:ext_tw_video|amplify_video|tweet_video))_thumb\//,'$1/'):url.pathname;
   return /^\/(?:ext_tw_video|amplify_video)\/\d+/.exec(path)?.[0]||
    /^\/tweet_video\/[A-Za-z0-9_-]+/.exec(path)?.[0]||null;
  } catch { return null; }
 }
 function postPosters(video,player,article){
  const posterUrls=new Set([video?.poster,...owned(player,'img',article).map(img=>img.currentSrc||img.src),
   ...owned(article,photoSelector).map(img=>img.currentSrc||img.src).filter(knownPoster)]);
  for(const el of owned(player,'[style*="twimg.com"]',article)){
   for(const match of el.style.backgroundImage.matchAll(/url\(["']?(https:\/\/[^"')]+)["']?\)/g))
    posterUrls.add(match[1]);
  }
  return [...posterUrls];
 }
 async function matchingSource(video, player, article) {
  const posterUrls = postPosters(video,player,article);
  const keys = new Set(posterUrls.map(url => assetKey(url,true)).filter(Boolean));
  if (keys.size !== 1) return null;
  const [key] = keys;
  const {items=[]} = await chrome.runtime.sendMessage({target:'worker',action:'detected'});
  checkProtection(video);
  const sources = [...new Map(items.filter(found => assetKey(found.url,false) === key)
   .map(found => [found.url,found])).values()];
  if(sources.length===1)return {...sources[0],observed:true};
  const manifests=sources.filter(found=>found.format!=='direct');
  return manifests.length===1?{...manifests[0],observed:true}:null;
 }

 function bridgeVariant(media,tweetId,posters){
  if(media?.tweetId!==tweetId)return null;
  const url=C.absolute(media.url);
  if(!url)return null;
  const parsed=new URL(url);
  if(parsed.origin!=='https://video.twimg.com'||parsed.username||parsed.password||
    [...parsed.searchParams.keys()].some(key=>/^(?:range|bytestart|byteend)$/i.test(key)))return null;
  const format=/\.mp4$/i.test(parsed.pathname)?'direct':/\.m3u8$/i.test(parsed.pathname)?'hls':null;
  if(!format||format!==media.format)return null;
  const visiblePosters=posters.filter(knownPoster).map(value=>new URL(value).pathname.replace(/\.(?:jpe?g|png|webp|gif)$/i,''));
  if(visiblePosters.length&&!visiblePosters.includes(media.poster))return null;
  return {url,format,duration:Number.isFinite(media.duration)&&media.duration>0?media.duration:null,
   expectedAudio:media.expectedAudio===false?false:null};
 }
 function resolveBridgeMedia(tweetId,posters,article){
  if(!tweetId)return Promise.resolve(null);
  const id=crypto.randomUUID();
  return new Promise(resolve=>{
   const finish=result=>{
    clearTimeout(timer);
    window.removeEventListener('message',onReply);
    if(article.getAttribute('data-mc-q')===id)article.removeAttribute('data-mc-q');
    resolve(result);
   };
   const timer=setTimeout(()=>finish(null),350);
   function onReply(event){
    if(event.source!==window||event.origin!==location.origin||
       event.data?.channel!=='__mc_traffic_query_response'||event.data?.id!==id)return;
    finish(bridgeVariant(event.data.media,tweetId,posters));
   }
   window.addEventListener('message',onReply);
   article.setAttribute('data-mc-q',id);
   window.postMessage({channel:'__mc_traffic_query',id,tweetId,posters},location.origin);
  });
 }

 async function download(button, article) {
  button.disabled = true;
  let videoError;
  try {
   const info=postInfo(article),route=location.href;
   const current=()=>article.isConnected&&location.href===route&&postInfo(article).postUrl===info.postUrl;
   const items = [];

   const player = owned(article,playerSelector)[0] || article;
   const videos = owned(player,'video',article).filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
   });
   const playButton = owned(player,'[data-testid="playButton"],button[aria-label="Play"],button[aria-label="Reproduzir"]',article)[0];
   const posterUrls=postPosters(videos[0],player,article);
   const bridgeMedia = await resolveBridgeMedia(info.post, posterUrls.filter(knownPoster), article);
   const hasVideo = Boolean(bridgeMedia || player !== article || videos.length || playButton || posterUrls.some(knownPoster));

   const photos = owned(article,photoSelector).filter(img => {
    const source=img.currentSrc||img.src;
    if(img.closest(playerSelector)||knownPoster(source)||posterUrls.some((url,index)=>index===0&&url&&url===source))return false;
    if(!hasVideo)return true;
    try{
     const url=new URL(source);
     return url.hostname==='pbs.twimg.com'&&url.pathname.startsWith('/media/');
    }catch{return false;}
   });

   for(const [index,img] of photos.entries()){
    const url=C.bestSource(img.currentSrc||img.src,img.getAttribute('srcset'),document.baseURI);
    if(url)items.push(item({...info,mediaPosition:photos.length>1?index+1:undefined},'image',url));
   }

   let savedVideo = false;
   if (hasVideo) {
    try {
     let video = videos.length === 1 ? videos[0] : null;
     if (bridgeMedia && bridgeMedia.url) {
      checkProtection(video);
      const selected={...item(info,'video',bridgeMedia.url,bridgeMedia.format),
       duration:bridgeMedia.duration,expectedAudio:bridgeMedia.expectedAudio};
      const confirmed=await MediaInline.confirm(selected,()=>current()&&!video?.mediaKeys,{
       sourceType:selected.format==='direct'?'video/mp4':''
      });
      items.push(confirmed);
     } else {
      let source = sourceOf(video) || await matchingSource(video,player,article);
      if (!source && playButton) {
       notice('Identificando o vídeo deste post…');
       video = await MediaCapture.startPlayer(player,playButton);
       if (video.closest('article') !== article) throw Error('O player encontrado pertence a outro post.');
       source = sourceOf(video) || await matchingSource(video,player,article);
      }
      checkProtection(video);
      if(source){
       const selected=source;
       const confirmed=await MediaInline.confirm(item(info,'video',selected.url,selected.format),()=>
        current()&&(!video||video.isConnected&&video.closest('article')===article)&&
        (selected.observed||sourceOf(video)?.url===selected.url),{
         observed:selected.observed,sourceType:selected.sourceType
        });
       if(selected.observed&&(await matchingSource(video,player,article))?.url!==selected.url){
        throw Error(MediaInline.retry);
       }
       items.push(confirmed);
      } else {
       if(!video)throw Error('Ainda não há uma fonte de vídeo confirmada para este post. Reabra a publicação e tente novamente.');
       if (!info.postUrl) throw Error('O link deste post não foi identificado.');
       await MediaCapture.download(video,{...info,site:'x.com'},'mp4',true,()=>false,
        () => notice('Aguardando os trechos deste vídeo…'), () => notice('Processando vídeo no navegador…'),()=>{
         if(!current()||!video.isConnected||video.closest('article')!==article)throw Error(MediaInline.retry);
        });
       savedVideo = true;
      }
     }
    } catch (error) { videoError = error; }
   }
   if(!current())throw Error(MediaInline.retry);
   if(videoError&&!items.length)throw videoError;
   if (items.length) {
    const unique = [...new Map(items.map(entry => [entry.id, entry])).values()];
    const response = await chrome.runtime.sendMessage({target:'worker',action:'enqueue',items:unique,skip:false});
    if (response?.error) throw Error(response.error);
    notice(videoError
     ? `${unique.length} ${unique.length===1?'foto':'fotos'} na fila. Vídeo não baixado: ${MediaInline.errorMessage(videoError,'fonte indisponível.')}`
     : unique.length + ' mídia(s) na fila.');
   } else if (savedVideo) notice('Vídeo salvo.');
   else throw videoError || Error('Nenhuma mídia identificável neste post.');
  }catch(error){notice(MediaInline.errorMessage(error,'Não foi possível iniciar o download.'));}
  finally { button.disabled = false; }
 }
 function scan() {
  for (const article of document.querySelectorAll('article')) {
   const group=owned(article,'[role="group"]').find(el=>!el.closest(playerSelector));
   const media=owned(article,playerSelector+',video,'+photoSelector);
   const first=media[0];
   const host=first&&(group||first.closest(playerSelector)||first.parentElement);
   let button=owned(article,'.coletor-x-button')[0];
   if(!host){button?.remove();continue;}
   if(button&&button.parentElement===host&&button.classList.contains('coletor-x-overlay')===!group)continue;
   button?.remove();
   button = document.createElement('button');
   button.type = 'button';
   button.className=group?'coletor-x-button':'coletor-x-button coletor-x-overlay';
   button.title = 'Baixar mídias deste post';
   button.setAttribute('aria-label', button.title);
   const icon = document.createElement('img');
   icon.src = chrome.runtime.getURL('assets/icon-32.png');
   icon.alt = '';
   button.append(icon);
   button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if(!event.isTrusted)return;
    download(button,article);
   });
   host.append(button);
  }
 }
 let timer;
 function scheduleScan(){if(!timer)timer=setTimeout(()=>{timer=null;scan();},350);}
 new MutationObserver(scheduleScan).observe(document.documentElement,{
  childList:true,subtree:true,attributes:true,attributeFilter:['data-testid','poster','src','role','href']
 });
 window.addEventListener('popstate',scheduleScan);
 window.navigation?.addEventListener('currententrychange',scheduleScan);
 scan();
})();
