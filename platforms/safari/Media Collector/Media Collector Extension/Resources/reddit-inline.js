(() => {
 if (globalThis.__mediaCollectorReddit) return;
 globalThis.__mediaCollectorReddit = true;
 const C = MediaCore;
 const selector = 'shreddit-post,article[data-testid="post-container"],.thing.link';
 document.querySelectorAll('.mc-reddit-button,.mc-reddit-notice').forEach(el=>el.remove());
 const playerSelector='video,shreddit-player,[data-testid="video-player"]';
 function nodes(root, query) {
  const found = [...root.querySelectorAll(query)];
  for (const element of root.querySelectorAll('*')) {
   if (element.shadowRoot) found.push(...nodes(element.shadowRoot, query));
  }
  return found;
 }
 function notify(message) {
  document.querySelector('.mc-reddit-notice')?.remove();
  const el = document.createElement('div');
  el.className = 'mc-reddit-notice';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
 }
 function identity(post) {
  const author = (post.getAttribute('author') || post.getAttribute('data-author') ||
   nodes(post, 'a[href^="/user/"],a[href^="/u/"]')[0]?.getAttribute('href')?.split('/')[2] || '').replace(/^u\//,'');
  return /^[A-Za-z0-9_-]{1,32}$/.test(author) ? author : '';
 }
 function permalink(post){
  const declared=post.getAttribute('permalink')||post.getAttribute('data-permalink');
  const links=nodes(post,'a[href*="/comments/"]');
  const url=C.absolute(declared||links[0]?.href,location.href);
  if(!url)return {};
  const path=new URL(url).pathname;
  const id=/\/comments\/([a-z0-9]+)(?:\/|$)/i.exec(path)?.[1];
  return id?{post:id,postUrl:url}:{};
 }
 function collect(post) {
  const items=new Map(), sources=new Map(), assetKeys=new Set();
  const info={site:'reddit.com',page:identity(post),...permalink(post)};
  const player=nodes(post,playerSelector);
  function add(raw,kind,format='direct',extra={}){
   const url=C.absolute(raw,location.href);
   if(!url||new URL(url).protocol!=='https:')return;
   const id=C.key(url);
   items.set(id,{id,kind,url,format,...info,available:true,width:0,height:0,...extra});
  }
  function src(raw,hint='',sourceType=''){
   const url=C.absolute(raw,location.href);
   if(!url)return;
   const u=new URL(url);
   if(u.protocol!=='https:')return;
   const path=u.pathname;
   if(u.hostname==='v.redd.it'){
    const key=path.split('/')[1];
    if(key)assetKeys.add(key);
   }
   if(/[?&](?:range|bytestart|byteend)=/i.test(u.search)||/(?:DASH_AUDIO|\.m4s|\.cmfv|\.cmfa|\.ts$)/i.test(path))return;
   if(/^image\/gif\b/i.test(sourceType)||/\.gif$/i.test(path)&&u.searchParams.get('format')!=='mp4'){
    add(url,'image');return;
   }
   const format=hint||(/\.mpd$/i.test(path)||/dash\+xml/i.test(sourceType)?'dash':
    /\.m3u8$/i.test(path)||/mpegurl/i.test(sourceType)?'hls':
    /\.(?:mp4|webm)$/i.test(path)||/^video\//i.test(sourceType)||u.searchParams.get('format')==='mp4'?'direct':'');
   if(format)sources.set(url,{url,format,sourceType});
  }
  function variants(value){
   const pending=[value];
   for(let visited=0;pending.length&&visited<160;visited++){
    const object=pending.pop();
    if(!object||typeof object!=='object')continue;
    for(const [key,child] of Object.entries(object)){
     if(child&&typeof child==='object')pending.push(child);
     if(typeof child!=='string')continue;
     if(/^(?:dash[_-]?url|dashManifestUrl)$/i.test(key))src(child,'dash');
     else if(/^(?:hls[_-]?url|hlsManifestUrl)$/i.test(key))src(child,'hls');
     else if(/^(?:url|src|fallback[_-]?url|mp4[_-]?url|gif[_-]?url|download[_-]?url)$/i.test(key)){
      src(child,'',typeof object.type==='string'?object.type:'');
     }
    }
   }
  }
  for(const el of player){
   if(el.mediaKeys)throw Error('Este vídeo usa proteção de mídia.');
   src(el.currentSrc||el.getAttribute('src'));
   src(el.getAttribute('data-src'));
   src(el.getAttribute('fallback-url'));
   src(el.getAttribute('dash-url'),'dash');
   src(el.getAttribute('hls-url'),'hls');
   const json=el.getAttribute('playback-media-json');
   if(json?.length<=64000)try{variants(JSON.parse(json));}catch{}
   for(const source of nodes(el,'source[src]'))src(source.src,'',source.type);
  }
  for(const link of nodes(post,'a[href]')){
   const href=C.absolute(link.href,location.href);
   if(!href)continue;
   const u=new URL(href);
   if(u.hostname==='v.redd.it')src(href);
   else if(u.hostname==='i.redd.it'&&/\.(?:jpe?g|png|webp|avif|gif)$/i.test(u.pathname)){
    if(!player.length||/\.gif$/i.test(u.pathname))add(href,'image');
   }
  }
  // A still used as a video poster is distinct from the underlying media.
  if(!player.length&&!sources.size)for(const image of nodes(post,'img')){
   const raw=image.currentSrc||image.src;
   if(!raw)continue;
   try{
    const u=new URL(raw,location.href);
    if(['i.redd.it','preview.redd.it','external-preview.redd.it'].includes(u.hostname)&&
       /\.(?:jpe?g|png|webp|avif|gif)$/i.test(u.pathname)&&
       ![...items.values()].some(item=>new URL(item.url).pathname===u.pathname))add(raw,'image');
   }catch{}
  }
  return {items:[...items.values()],sources,assetKeys,hasPlayer:player.length>0,info};
 }
 async function download(button,post){
  button.disabled=true;
  try{
   const route=location.href, initial=permalink(post);
   const current=()=>post.isConnected&&location.href===route&&permalink(post).post===initial.post;
   const found=collect(post);
   const items=found.items;
   const originalGif=items.some(item=>/\.gif$/i.test(new URL(item.url).pathname));
   if(!originalGif&&found.assetKeys.size===1){
    const {items:observations=[]}=await chrome.runtime.sendMessage({target:'worker',action:'detected'});
    const [key]=found.assetKeys;
    for(const entry of observations){
     if(entry.format==='direct'||found.sources.has(entry.url))continue;
     const url=new URL(entry.url);
     if(url.hostname==='v.redd.it'&&url.pathname.split('/')[1]===key){
      found.sources.set(entry.url,{url:entry.url,format:entry.format,observed:true});
     }
    }
   }
   let sourceError;
   if(!originalGif&&found.sources.size){
    const candidates=[...found.sources.values()].sort((a,b)=>Number(a.format==='direct')-Number(b.format==='direct'));
    for(const candidate of candidates){
     const {url,format,observed,sourceType}=candidate;
     try{
      const confirmed=await MediaInline.confirm({id:C.key(url),kind:'video',url,format,
       ...found.info,available:true,width:0,height:0},()=>{
       if(!current())return false;
       const latest=collect(post);
       return observed
        ? latest.assetKeys.size===1&&latest.assetKeys.has(new URL(url).pathname.split('/')[1])
        : latest.sources.has(url);
      },{observed,manifest:format==='direct'?'':format,sourceType});
      items.push(confirmed);sourceError=null;break;
     }catch(error){sourceError=error;}
    }
    if(sourceError&&!items.length)throw sourceError;
   }
   if(!items.length)throw Error(found.hasPlayer ?
    'Fonte do vídeo indisponível. Abra a publicação ou inicie a reprodução e tente novamente.' :
    'Nenhuma mídia carregada nesta publicação.');
   if(!current())throw Error(MediaInline.retry);
   if(items.length>1)for(const [index,item] of items.entries())item.mediaPosition=index+1;
   const response=await chrome.runtime.sendMessage({target:'worker',action:'enqueue',items,skip:false});
   if(response?.error)throw Error(response.error);
   notify(sourceError
    ? items.length+' mídia(s) adicionada(s) à fila. Vídeo não baixado: '+MediaInline.errorMessage(sourceError,'fonte indisponível.')
    : items.length+' mídia(s) adicionada(s) à fila.');
  }catch(error){
   notify(MediaInline.errorMessage(error,'Não foi possível baixar esta publicação.'));
  }finally{button.disabled=false;}
 }
 function scan() {
  for (const post of document.querySelectorAll(selector)) {
   if (post.parentElement?.closest(selector) || post.querySelector(':scope > .mc-reddit-button')) continue;
   const button = document.createElement('button');
   button.type = 'button';
   button.className = 'mc-reddit-button';
   button.setAttribute('aria-label','Baixar mídias desta publicação');
   button.title = 'Baixar mídias desta publicação';
   button.textContent = '↓';
   button.addEventListener('click',event => {
    event.preventDefault();event.stopPropagation();if(!event.isTrusted)return;download(button,post);
   });
   post.append(button);
  }
 }
 let timer;
 new MutationObserver(() => {
  if (!timer) timer=setTimeout(() => {timer=null;scan();},350);
 }).observe(document.documentElement,{subtree:true,childList:true});
 window.addEventListener('popstate',scan);
 window.navigation?.addEventListener('currententrychange',scan);
 scan();
})();
