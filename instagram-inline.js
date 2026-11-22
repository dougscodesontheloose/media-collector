(()=>{
 if(globalThis.__coletorIg)return;globalThis.__coletorIg=true;
 const C=globalThis.MediaCore,wait=ms=>new Promise(r=>setTimeout(r,ms));let collecting=false;
 const overlayOwners=new WeakMap();
 document.querySelectorAll('.coletor-ig-control,.coletor-ig-toast').forEach(el=>el.remove());
 function toast(text){document.querySelector('.coletor-ig-toast')?.remove();let d=document.createElement('div');d.className='coletor-ig-toast';d.setAttribute('role','status');d.textContent=text;(document.querySelector('dialog:modal')||document.body).append(d);setTimeout(()=>d.remove(),5000);}
 function button(label,fn){let b=document.createElement('button');b.type='button';b.className='coletor-ig-control';b.title=label;b.setAttribute('aria-label',label);let icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');let path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M12 3v11m-4-4 4 4 4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.8');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');icon.append(path);b.append(icon);b.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(!e.isTrusted||collecting||b.disabled)return;b.disabled=true;try{await fn();}catch(error){toast(MediaInline.errorMessage(error,'Não foi possível baixar esta mídia.'));}finally{b.disabled=false;}});return b;}
 const reelViewerPath=/^\/(?:reels|reels?\/[A-Za-z0-9_-]+)\/?$/i;
 const profileReelsPath=/^\/([A-Za-z0-9._]+)\/reels\/?$/i;
 function publication(path){
  const match=path.match(/^(?:\/[A-Za-z0-9._]+)?\/(p|reels?)\/([A-Za-z0-9_-]+)\/?$/i);
  if(!match)return null;
  return {post:match[2],postUrl:new URL('/'+(match[1]==='p'?'p':'reel')+'/'+match[2]+'/',location.origin).href};
 }
 function authorIn(scope){
  const links=[...scope.querySelectorAll('header a[href]'),...scope.querySelectorAll('a[href]')];
  return links.filter(a=>a.origin===location.origin).map(a=>a.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/)?.[1])
   .find(name=>name&&!/^(p|reels?|explore|stories|accounts|direct)$/i.test(name))||'';
 }
 function postInfo(scope){
  if(location.pathname.startsWith('/stories/')){let parts=location.pathname.split('/').filter(Boolean);return {post:parts[2]||'',postUrl:location.href,page:parts[1]||''};}
  const links=[...scope.querySelectorAll('a[href]')].filter(a=>a.origin===location.origin);
  const linkedPost=links.map(a=>publication(a.pathname)).find(Boolean);
  return {...(linkedPost||publication(location.pathname)||{post:'',postUrl:''}),page:authorIn(scope)};
 }
 function media(el,context){let video=el.tagName==='VIDEO';if(video&&el.mediaKeys)return null;let raw=video?(el.currentSrc||el.getAttribute('src')||el.querySelector('source[src]')?.src):C.bestSource(el.currentSrc||el.src,el.getAttribute('srcset'),document.baseURI);let url=C.absolute(raw,document.baseURI);if(!url)return null;if(video&&/[?&](range|bytestart|byteend)=/i.test(url))return null;let info=context||postInfo(el.closest('article,[role=dialog]')||document);return {id:info.post?`instagram:${info.post}:${C.key(url)}`:C.key(url),kind:video?'video':'image',url,format:/\.m3u8(?:[?#]|$)/i.test(url)?'hls':/\.mpd(?:[?#]|$)/i.test(url)?'dash':'direct',width:el.naturalWidth||el.videoWidth||0,height:el.naturalHeight||el.videoHeight||0,site:'instagram.com',...info,available:true};}
 async function confirmVideo(el,item,current){
  const typed=[...el.querySelectorAll('source[src]')].find(node=>node.src===item.url)?.type||'';
  return MediaInline.confirm(item,()=>el.isConnected&&current()&&
   C.absolute(MediaInline.sourceOf(el),document.baseURI)===item.url,{sourceType:typed});
 }
 async function currentMedia(el,info,ensureCurrent){
  if(el.tagName==='VIDEO'&&el.mediaKeys)throw Error('Este vídeo usa proteção de mídia.');
  const item=media(el,info);
  if(item){
   await enqueue([item.kind==='video'?await confirmVideo(el,item,ensureCurrent):item]);
   return;
  }
  if(el.tagName==='VIDEO'){
   await savePlayer(el,info,location.pathname.startsWith('/stories/')?'Story':'vídeo',()=>{
    if(!el.isConnected||!ensureCurrent())throw Error(MediaInline.retry);
   });
   return;
  }
  throw Error('Esta mídia ainda não está disponível.');
 }
 async function enqueue(items){let uniq=[...new Map(items.filter(Boolean).map(x=>[x.id,x])).values()];if(!uniq.length)throw Error('A mídia não possui um endereço direto identificável. Abra o painel e verifique as fontes detectadas.');let r=await chrome.runtime.sendMessage({target:'worker',action:'enqueue',items:uniq,skip:false});if(r?.error)throw Error(r.error);toast(`${uniq.length} mídia(s) adicionada(s) à fila.`);}
 function visible(el){let r=el.getBoundingClientRect();return r.width>=180&&r.height>=180&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;}
 function current(scope){return [...scope.querySelectorAll('img,video')].filter(e=>!e.closest('.coletor-ig-control')&&visible(e)&&!/foto do perfil|profile picture/i.test(e.alt||''));}
 const playSelector='[aria-label="Reproduzir"],[aria-label="Reproduzir vídeo"],[aria-label="Play"],[aria-label="Play video"]';
 function playMarker(scope){return [...scope.querySelectorAll(playSelector)].find(el=>{
  const box=el.getBoundingClientRect();return box.width>0&&box.height>0;
 });}
 async function savePlayer(el,info,label,ensureCurrent){
  if(el.mediaKeys)throw Error('Este vídeo usa proteção e não pode ser processado.');
  await MediaCapture.download(el,{site:'instagram.com',...info},'mp4',true,()=>false,
   ()=>toast('Aguardando os trechos deste '+label+'…'),()=>toast('Processando '+label+' no navegador…'),ensureCurrent);
  toast(label==='Story'?'Story salvo na pasta de downloads.':'Vídeo salvo na pasta de downloads.');
 }
 function visibleNext(scope){return [...scope.querySelectorAll('button[aria-label]')].find(b=>/^(avançar|next|próximo)$/i.test(b.getAttribute('aria-label')||'')&&b.getBoundingClientRect().width>0);}
 async function carousel(scope){
  collecting=true;
  try{
   const info=postInfo(scope),all=[],route=location.href;
   const stillHere=()=>scope.isConnected&&location.href===route&&postInfo(scope).post===info.post;
   let steps=0,saved=0,videoError;
   const attempted=new Set();
   while(steps<30){
    const marker=playMarker(scope);
    let visibleMedia=current(scope);
    if(marker&&!visibleMedia.some(el=>el.tagName==='VIDEO')){
     try{
      const trigger=marker.closest('button,[role="button"]')||marker.parentElement;
      const video=await MediaCapture.startPlayer(scope,trigger);
      visibleMedia=[video];
     }catch(error){videoError=error;visibleMedia=[];}
    }
    const mediaPosition=steps||visibleNext(scope)?steps+1:undefined;
    for(const el of visibleMedia){
     const found=media(el,{...info,mediaPosition});
     if(found){
      if(found.kind==='image'){all.push(found);continue;}
      try{all.push(await confirmVideo(el,found,stillHere));}
      catch(error){videoError=error;}
      continue;
     }
     if(el.tagName!=='VIDEO')continue;
     const source=el.currentSrc||el.src;
     if(attempted.has(source))continue;
     attempted.add(source);
     try{
      await savePlayer(el,{...info,mediaPosition},'vídeo',()=>{if(!stillHere()||!el.isConnected)throw Error(MediaInline.retry);});
      saved++;
     }catch(error){videoError=error;}
    }
    if(!stillHere())throw Error(MediaInline.retry);
    const next=visibleNext(scope);
    if(!next)break;
    const signature=()=>location.href+'|'+current(scope).map(el=>el.currentSrc||el.src).join('|');
    const before=signature();
    next.click();await wait(1100);
    if(before===signature()){toast('O carrossel não confirmou o avanço.');break;}
    steps++;
   }
   if(all.length)await enqueue(all);
   if(videoError){if(!all.length&&!saved)throw videoError;toast('Vídeo pendente: '+videoError.message);}
   if(!all.length&&!saved&&!videoError)throw Error('Nenhuma mídia disponível nesta publicação.');
  }finally{collecting=false;}
 }
 function exploreGridLink(element){
  if(!/^\/explore\/?$/.test(location.pathname))return null;
  const link=element.closest('a[href]');
  return link?.origin===location.origin&&publication(link.pathname)?link:null;
 }
 async function downloadGridImage(link){
  const info=publication(link.pathname);
  const images=[...link.querySelectorAll('img')].filter(image=>!image.closest('.coletor-ig-control'));
  const image=images.find(item=>item.currentSrc||item.src);
  if(!info||!image)throw Error('A imagem deste cartão não está disponível.');
  await enqueue([media(image,{...info,page:''})]);
 }
 async function downloadGridCarousel(link){
  const target=publication(link.pathname);
  if(!target)throw Error('Não foi possível identificar esta publicação.');
  const alreadyOpen=document.querySelector('[role="dialog"],dialog[open]');
  if(alreadyOpen)throw Error('Feche a publicação aberta antes de baixar este carrossel.');
  link.click();
  for(let count=0;count<45;count++){
   await wait(150);
   const active=publication(location.pathname);
   const dialog=[...document.querySelectorAll('[role="dialog"],dialog[open]')].find(el=>visibleArea(el));
   if(active&&active.post!==target.post)throw Error('A publicação exibida mudou; nenhum carrossel foi baixado.');
   if(dialog&&active?.post===target.post){await carousel(dialog);return;}
  }
  throw Error('Não foi possível abrir o carrossel. Abra o post e use o botão ao lado de Salvar.');
 }
 function scanExploreImages(){
  if(!/^\/explore\/?$/.test(location.pathname))return;
  for(const link of document.querySelectorAll('main a[href], [role="main"] a[href]')){
   if(link.origin!==location.origin||!publication(link.pathname)||!link.querySelector('img')||link.querySelector('video'))continue;
   if(getComputedStyle(link).position==='static')link.style.position='relative';
   link.classList.add('coletor-ig-grid-card');
   link.querySelectorAll('.coletor-ig-container > .coletor-ig-overlay').forEach(el=>el.remove());
   if(!link.querySelector(':scope > .coletor-ig-grid-photo')){
    const control=button('Baixar imagem deste cartão',()=>downloadGridImage(link));
    control.classList.add('coletor-ig-grid-photo');link.append(control);
   }
   const isCarousel=!!link.querySelector('svg[aria-label="Carrossel"],svg[aria-label="Carousel"],svg[aria-label="Carrousel"]');
   const all=link.querySelector(':scope > .coletor-ig-grid-all');
   if(isCarousel&&!all){
    const control=button('Baixar todas as mídias do carrossel',()=>downloadGridCarousel(link));
    control.classList.add('coletor-ig-grid-all');control.append(document.createTextNode(' Todas'));link.append(control);
   }else if(!isCarousel)all?.remove();
  }
 }
 function storyMedia(){
  if(!location.pathname.startsWith('/stories/'))return null;
  const candidates=[...document.querySelectorAll('img,video')].filter(e=>!e.closest('.coletor-ig-control')&&visible(e)&&!/foto do perfil|profile picture/i.test(e.alt||'')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).opacity!=='0');
  const outside=candidates.filter(e=>!e.closest('main,[role=main],article'));const list=outside.length?outside:candidates;
  const distance=el=>{
   const box=el.getBoundingClientRect();
   return Math.abs(box.left+box.width/2-innerWidth/2);
  };
  return list.sort((a,b)=>{
   const delta=distance(a)-distance(b);
   return Math.abs(delta)>8?delta:Number(b.tagName==='VIDEO')-Number(a.tagName==='VIDEO');
  })[0]||null;
 }
 async function storyDownload(){
  const el=storyMedia();
  if(!el)throw Error('Story não identificado. Aguarde o carregamento.');
  const info=postInfo(document),route=location.href;
  await currentMedia(el,info,()=>location.href===route&&storyMedia()===el);
 }
 function updateStory(){
  let existing=document.querySelector('.coletor-ig-story');if(!location.pathname.startsWith('/stories/')){existing?.remove();return;}
  let el=storyMedia();if(!el){existing?.remove();return;}let r=el.getBoundingClientRect();
  if(!existing){existing=button('Baixar este Story',storyDownload);existing.classList.add('coletor-ig-story');document.body.append(existing);}
  existing.style.left=`${Math.max(8,Math.min(innerWidth-44,r.right-44))}px`;existing.style.top=`${Math.max(8,Math.min(innerHeight-44,r.top+96))}px`;
 }
 function visibleArea(el){
  if(el.closest('[hidden],[aria-hidden="true"]')||el.checkVisibility?.({visibilityProperty:true,opacityProperty:true})===false)return 0;
  const box=el.getBoundingClientRect();
  if(box.width<120||box.height<100)return 0;
  return Math.max(0,Math.min(innerWidth,box.right)-Math.max(0,box.left))
   *Math.max(0,Math.min(innerHeight,box.bottom)-Math.max(0,box.top));
 }
 function selectVisible(elements,target){
  const candidates=elements.map(el=>({el,area:visibleArea(target(el))})).filter(x=>x.area>0)
   .sort((a,b)=>b.area-a.area);
  // Two equally visible players may be crossing during a swipe.
  if(!candidates.length||(candidates[1]&&candidates[0].area<1.5*candidates[1].area))return null;
  return candidates[0].el;
 }
 function reelCard(player){
  let card=player.parentElement||player;
  const boundary=player.closest('article,[role="dialog"],dialog,main,[role="main"]')||document.body;
  while(card!==boundary&&card.parentElement&&card.parentElement.querySelectorAll('video').length<=1){
   if(card.parentElement===document.body)break;
   card=card.parentElement;
  }
  return card;
 }
 function playRegion(marker){
  for(let node=marker;node&&node!==document.body;node=node.parentElement){
   if(visibleArea(node))return node;
  }
  return marker;
 }
 function hasVideoSource(video){
  return video&&(video.currentSrc||video.src||video.querySelector('source[src]'));
 }
 function activeReel(){
  if(location.pathname.startsWith('/stories/'))return null;
  const viewer=reelViewerPath.test(location.pathname);
  const profile=location.pathname.match(profileReelsPath);
  if(!viewer&&!profile)return null;
  let root=[...document.querySelectorAll('[role="dialog"],dialog[open]')].reverse().find(dialog=>
   visibleArea(dialog)&&(dialog.querySelector('video')||playMarker(dialog)));
  if(!root&&!viewer)return null;
  root||=document.querySelector('main,[role="main"]')||document.body;
  const visibleVideos=[...root.querySelectorAll('video')].filter(video=>visibleArea(video)>0);
  const playing=visibleVideos.filter(video=>!video.paused&&!video.ended);
  const video=selectVisible(visibleVideos,el=>el)||(playing.length===1?playing[0]:null);
  if(!video&&visibleVideos.length)return null;
  const playbackScope=video?reelCard(video):root;
  const trigger=hasVideoSource(video)?null:selectVisible([...playbackScope.querySelectorAll(playSelector)]
   .map(marker=>marker.closest('button,[role="button"]')||marker.parentElement)
   .filter((trigger,index,all)=>trigger&&all.indexOf(trigger)===index),playRegion);
  if(!video&&!trigger)return null;
  const card=video?playbackScope:playRegion(trigger);
  const links=[...card.querySelectorAll('a[href]')].filter(a=>a.origin===location.origin)
   .map(a=>publication(a.pathname)).filter(info=>info&&info.postUrl.includes('/reel/'));
  const [onlyPost]=new Map(links.map(link=>[link.post,link])).values();
  const linked=links.every(link=>link.post===onlyPost?.post)?onlyPost:null;
  const routePost=publication(location.pathname);
  if(routePost&&linked&&routePost.post!==linked.post)return null;
  const info=routePost||linked||
   {post:'',postUrl:viewer?new URL('/reels/',location.origin).href:''};
  return {video,trigger,card,anchor:video||card,info:{...info,page:authorIn(card)||profile?.[1]||''}};
 }
 async function downloadReel(){
  const target=activeReel();
  if(!target)throw Error('Aguarde até que o Reel atual esteja visível.');
  const route=location.pathname;
  let player=target.video;
  if(!hasVideoSource(player)){
   player=await MediaCapture.startPlayer(target.card,target.trigger);
  }
  const current=activeReel();
  if(location.pathname!==route||current?.video!==player||(target.info.post&&current.info.post!==target.info.post))
   throw Error('O Reel mudou durante a identificação do player.');
  const info=current.info;
  if(!info.postUrl&&!media(player,info))throw Error('Abra o Reel para identificar o vídeo.');
  await currentMedia(player,info,()=>{
   const active=activeReel();
   return location.pathname===route&&active?.video===player&&active.info.postUrl===info.postUrl;
  });
 }
 function updateReel(){
  const existing=document.querySelector('.coletor-ig-reel');
  const target=activeReel();
  if(!target){existing?.remove();return false;}
  const host=target.anchor.closest('dialog[open]')||document.body;
  const control=existing||button('Baixar este Reel',downloadReel);
  if(!existing)control.classList.add('coletor-ig-reel');
  if(control.parentElement!==host)host.append(control);
  const box=target.anchor.getBoundingClientRect();
  control.style.left=`${Math.max(8,Math.min(innerWidth-44,box.right-44))}px`;
  control.style.top=`${Math.max(8,Math.min(innerHeight-44,box.top+12))}px`;
  return true;
 }
 function scan(){
  updateStory();
  const reelDisplayed=updateReel();
  if(reelViewerPath.test(location.pathname)||reelDisplayed)return;
  if(ProfileCollector.profileUrl()) {let h=document.querySelector('main header,main [role="heading"],[role="main"] header,header');if(h&&!h.querySelector('.coletor-ig-profile')){let b=button('Baixar mídias do perfil',()=>{if(!ColetorInline.startProfile({limit:0,kind:'all',autoDownload:true,skip:false}))throw Error('Já existe uma coleta em andamento.');toast('Coleta do perfil iniciada. Acompanhe o progresso no painel.');});b.classList.add('coletor-ig-profile');b.append(document.createTextNode(' Baixar perfil'));h.append(b);}}
  scanExploreImages();
  if(location.pathname.startsWith('/stories/'))return;
  const scopes=[...document.querySelectorAll('[role="dialog"],article,main')];
  for(const scope of scopes){
   for(const el of current(scope)){
    if(el.tagName==='IMG'&&exploreGridLink(el))continue;
    const parent=el.parentElement;
    if(!parent||parent.closest('.coletor-ig-control'))continue;
    const previous=parent.querySelector(':scope > .coletor-ig-overlay');
    if(previous&&overlayOwners.get(previous)?.isConnected)continue;
    previous?.remove();
    if(getComputedStyle(parent).position==='static')parent.style.position='relative';
    parent.classList.add('coletor-ig-container');
    const control=button('Baixar esta mídia',async()=>{
     const post=el.closest('article,[role=dialog]')||document;
     const info=postInfo(post),route=location.href;
     await currentMedia(el,info,()=>el.isConnected&&location.href===route&&postInfo(post).post===info.post);
    });
    control.classList.add('coletor-ig-overlay');
    overlayOwners.set(control,el);
    parent.append(control);
   }
  }
  const postScopes=[...document.querySelectorAll('[role="dialog"],article')];
  if(/^\/(p|reel)\//.test(location.pathname)&&!postScopes.length){
   const main=document.querySelector('main,[role="main"]');
   if(main)postScopes.push(main);
  }
  for(const scope of postScopes){
   if((!current(scope).length&&!playMarker(scope))||scope.querySelector('.coletor-ig-all'))continue;
   const save=scope.querySelector('svg[aria-label="Salvar"],svg[aria-label="Save"],button[aria-label="Salvar"],button[aria-label="Save"],[role="button"][aria-label="Salvar"],[role="button"][aria-label="Save"]');
   const anchor=save?.closest('button,[role="button"]')||save?.parentElement;
   if(!anchor?.parentElement)continue;
   const bar=anchor.parentElement;
   const b=button('Baixar todas as mídias desta publicação',()=>carousel(scope));
   b.classList.add('coletor-ig-all');bar.classList.add('coletor-ig-action-group');bar.insertBefore(b,anchor);
  }
 }
 globalThis.ColetorFeed={collect:async(update,stopped,paused,outputFormat)=>{
  const posts=[...document.querySelectorAll('main article,[role=main] article')],all=[],pending=[];let count=0,savedVideos=0;
  for(const scope of posts){while(paused()&&!stopped())await wait(250);if(stopped())break;const info=postInfo(scope);if(!info.post){pending.push({id:'post',reason:'Link da publicação não encontrado.'});continue;}scope.scrollIntoView({block:'center',behavior:'instant'});await wait(350);let step=0,found=[];
   while(step<30&&!stopped()){
    while(paused()&&!stopped())await wait(250);
    const mediaPosition=step||visibleNext(scope)?step+1:undefined;
    for(const el of current(scope)){
     const item=media(el,{...info,mediaPosition});
     if(!item)continue;
     if(item.kind==='image'){found.push(item);continue;}
     try{found.push(await confirmVideo(el,item,()=>scope.isConnected&&postInfo(scope).post===info.post));}
     catch(error){pending.push({id:info.post,reason:MediaInline.errorMessage(error,'Vídeo não verificado.')});}
    }
    const next=visibleNext(scope);
    if(!next)break;
    const signature=()=>current(scope).map(el=>el.currentSrc||el.src).join('|');
    const before=signature();
    next.click();
    await wait(1000);
    if(before===signature()){pending.push({id:info.post,reason:'Não foi possível confirmar o próximo item do carrossel.'});break;}
    step++;
   }
   let savedVideo=false;
   if(scope.querySelector('video')&&!found.some(x=>x.kind==='video')){
    const video=[...scope.querySelectorAll('video')].find(visible);
    if(video){
     const route=location.href,source=video.currentSrc||video.src;
     const ensureCurrent=()=>{
      const selected=[...scope.querySelectorAll('video')].find(visible);
      if(location.href!==route||!scope.isConnected||!posts.includes(scope)||
       !scope.contains(video)||!video.isConnected||selected!==video||
       (video.currentSrc||video.src)!==source||postInfo(scope).post!==info.post)
       throw Error(MediaInline.retry);
     };
     const stopIfChanged=()=>{ensureCurrent();return stopped();};
     try{
      await MediaCapture.download(video,{site:'instagram.com',...info},outputFormat,true,
       stopIfChanged,undefined,ensureCurrent,ensureCurrent);
      savedVideo=true;savedVideos++;
     }catch(e){pending.push({id:info.post,reason:e.message||'Vídeo não verificado.'});}
    }else pending.push({id:info.post,reason:'Vídeo não está visível para verificação.'});
   }
   if(!found.length&&!savedVideo&&!pending.some(p=>p.id===info.post))pending.push({id:info.post,reason:'Nenhuma mídia disponível foi identificada.'});
   all.push(...found);count++;update({posts:count,pending:[...pending],discovered:posts.length,mediaCount:all.length+savedVideos});
  }
  return {items:[...new Map(all.map(x=>[x.id,x])).values()],pending,savedVideos};
 }};
 let timer;
 function scheduleScan(){if(!timer)timer=setTimeout(()=>{timer=null;scan();},150);}
 new MutationObserver(scheduleScan).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','aria-label','aria-hidden','hidden','href','open','poster','role']});
 window.addEventListener('resize',scheduleScan,{passive:true});
 window.addEventListener('scroll',scheduleScan,{passive:true,capture:true});
 window.addEventListener('popstate',scheduleScan);
 window.navigation?.addEventListener('currententrychange',scheduleScan);
 scan();
})();
