(() => {
  if (globalThis.__coletorMidias) return;
  const C = globalThis.MediaCore, adapter = globalThis.MediaAdapters.select(location.hostname);
  const items = new Map();
  const documentToken=crypto.randomUUID?.()||String(Math.random());
  const state = {phase:'idle', rounds:0, limit:200, unchanged:0, stopReason:'', updated:Date.now()};
  let timer = null, scanTimer = null, running = false, stopped = false, paused = false, profileMode = false;
  const webGeneral = adapter.id === 'generic';
  const measuredImages = new Map();
  let lastWebPoint=null;
  function measureImage(url,element) {
    if(!url)return null;
    let entry=measuredImages.get(url);
    if(entry)return entry.loaded?entry:null;
    entry={loaded:false,width:0,height:0};measuredImages.set(url,entry);
    const probe=new Image();
    probe.onload=()=>{entry.loaded=true;entry.width=probe.naturalWidth;entry.height=probe.naturalHeight;if(element.isConnected)laterScan();if(lastWebPoint&&overlayState.enabled)refreshWebPointer();};
    probe.onerror=()=>{entry.loaded=true;};probe.src=url;
    return null;
  }
  const editorialBody='.entry-content,[itemprop="articleBody"]';
  const articleBody=editorialBody+',.post-content,.article-content';
  const contentRegion='main,article,[role="main"],'+articleBody;
  const surroundingRegion='header,nav,footer,aside,[role="banner"],[role="navigation"],[role="complementary"],[role="contentinfo"],#comments,.comments,.comments-area,#sidebar,#sidebar_main,.sidebar,.related-posts,table.related';
  const interfaceName=/(?:^|[\s_-])(logo|icon|ícone|avatar|sprite|arrow|seta|indicator|indicador|wpd-avatar)(?:$|[\s_-])/i;
  function parentOf(element){return element.parentElement||element.getRootNode().host;}
  function isInterface(element){
    const filename=element.localName==='img'?(element.currentSrc||element.src).split(/[?#]/)[0].split('/').at(-1):'';
    if(interfaceName.test(filename.replace(/\.[^.]+$/,'')))return true;
    const link=element.closest('a[href]');
    const table=element.closest('table');
    const body=table?.closest('[itemprop="articleBody"]');
    const specificBody=body?.querySelector('.entry-content');
    const withinEditorial=element.closest('.entry-content')||(body&&!specificBody);
    if(link&&table&&!withinEditorial&&document.querySelector(editorialBody)){
      const pageLink=C.absolute(link.href)&&link.pathname!==location.pathname&&
       !/\.(?:jpe?g|png|webp|avif|gif|svg|bmp|ico)(?:[?#]|$)/i.test(link.href)&&!link.hasAttribute('download');
      if(pageLink)return true;
    }
    for(let node=element;node&&node!==document.body;node=parentOf(node)){
      const labels=[node.id,node.getAttribute('class'),node.getAttribute('aria-label'),node.getAttribute('alt')].filter(Boolean).join(' ');
      if(interfaceName.test(labels)||node.matches(surroundingRegion))return true;
      if(node.matches(contentRegion))return false;
    }
    return false;
  }
  function rendered(element){
    if(!element.isConnected||!element.getClientRects().length)return false;
    const style=getComputedStyle(element);
    return style.visibility==='visible'&&style.opacity!=='0';
  }
  function imageAlternatives(image){
    const picture=image.closest('picture');
    const current=C.absolute(image.currentSrc,document.baseURI);
    const source=picture&&Array.from(picture.querySelectorAll('source[srcset]')).find(source=>
      (!source.media||matchMedia(source.media).matches)&&C.responsiveCandidates(source.getAttribute('srcset'),document.baseURI).includes(current));
    const attributes=source?[source.getAttribute('srcset')]:[image.getAttribute('srcset'),image.getAttribute('data-srcset')];
    const urls=attributes.flatMap(src=>C.responsiveCandidates(src,document.baseURI));
    const link=image.closest('a[href]');
    if(link&&(link.hasAttribute('download')||/\.(?:jpe?g|png|webp|avif|gif|svg|bmp|ico)(?:[?#]|$)/i.test(link.href))){
      const original=C.absolute(link.href);
      if(original)urls.push(original);
    }
    return [...new Set(urls)];
  }
  function backgroundSource(element){
    if(element===document.body||element===document.documentElement||!rendered(element))return null;
    const match=getComputedStyle(element).backgroundImage.match(/^url\("([^"]+)"\)$/);
    return C.absolute(match?.[1],document.baseURI);
  }
  function imageRecord(element){
    if(!rendered(element))return null;
    const photo=element.localName==='img';
    const shown=photo?C.absolute(element.currentSrc||element.getAttribute('src'),document.baseURI):backgroundSource(element);
    const lazy=photo&&C.absolute(element.getAttribute('data-src')||element.getAttribute('data-original')||element.getAttribute('data-lazy-src'),document.baseURI);
    const waiting=lazy&&(!shown||element.naturalWidth<=1&&shown!==lazy);
    const url=waiting?lazy:shown;
    if(!url){
      if(photo&&/^(blob:|data:)/i.test(element.currentSrc||element.src)){
        return {id:'local:'+element.localName+':'+(element.currentSrc||element.src).slice(0,100),kind:'image',
          available:false,width:element.naturalWidth,height:element.naturalHeight,
          interface:isInterface(element),reason:'Imagem temporária. Use o menu Salvar imagem como do navegador.'};
      }
      return null;
    }
    const dimensions=photo?{width:element.naturalWidth,height:element.naturalHeight}:measureImage(url,element);
    const ready=!!(!waiting&&dimensions?.width&&dimensions?.height&&(!photo||element.complete));
    return {id:url,kind:'image',webImage:true,url,preview:ready?url:'',
      width:ready?dimensions.width:0,height:ready?dimensions.height:0,available:ready,
      interface:isInterface(element),site:location.hostname,page:'',
      variants:photo?[...new Set([url,...imageAlternatives(element)])]:[],
      reason:ready?'':photo&&element.complete&&!waiting?'A página não conseguiu carregar esta imagem.':'Aguardando a imagem carregar.'};
  }
  function webImageInventory(){
    const found=new Map();
    function read(root){
      for(const element of root.querySelectorAll('*')){
        if(element.shadowRoot)read(element.shadowRoot);
        if(element.localName!=='img'&&!element.matches('div,article,section,span,a,figure,li,[role="img"],button,header,aside'))continue;
        const record=imageRecord(element);
        if(!record)continue;
        const previous=found.get(record.id);
        if(previous){
          const combined=previous.available?previous:record;
          combined.interface=previous.interface&&record.interface;
          combined.variants=[...new Set([...(previous.variants||[]),...(record.variants||[])])];
          found.set(record.id,combined);
        }else found.set(record.id,record);
      }
    }
    read(document);
    return [...found.values()];
  }
  const overlayState={enabled:false,minimum:0,minWidth:0,minHeight:0,includeInterface:false,image:null,source:'',button:null,originals:new Map()};
  let savedHoverOptions={}, disabledHoverSites={}, panelHoverOptions=null;
  const hoverSettingsKeys=['webHoverOptions','webHoverDisabled'];
  function applyHoverSettings(){
    const options=panelHoverOptions||savedHoverOptions;
    overlayState.enabled=disabledHoverSites[location.hostname]!==true;
    overlayState.minimum=[0,100,200,400,600,800,1000,1001].includes(options.minimum)?options.minimum:0;
    overlayState.includeInterface=options.includeInterface===true;
    overlayState.minWidth=Number.isFinite(options.minWidth)&&options.minWidth>=0?options.minWidth:0;
    overlayState.minHeight=Number.isFinite(options.minHeight)&&options.minHeight>=0?options.minHeight:0;
    overlayState.originals=new Map(panelHoverOptions?.originals||[]);
    if(!overlayState.enabled)hideWebOverlay();
    else if(lastWebPoint)refreshWebPointer();
  }
  function overlayEligible(dimensions){
    return !!dimensions&&dimensions.width>=overlayState.minimum&&dimensions.height>=overlayState.minimum&&
      dimensions.width>=overlayState.minWidth&&dimensions.height>=overlayState.minHeight;
  }
  function hideWebOverlay(){
    overlayState.image=null;overlayState.source='';
    if(overlayState.button){overlayState.button.hidden=true;overlayState.button.style.setProperty('display','none','important');}
  }
  function webNotice(message){
    document.querySelector('.mc-web-image-notice')?.remove();
    const notice=document.createElement('div');notice.className='mc-web-image-notice';notice.setAttribute('role','status');notice.textContent=message;
    Object.assign(notice.style,{position:'fixed',bottom:'20px',left:'50%',transform:'translateX(-50%)',zIndex:'2147483647',padding:'10px 14px',borderRadius:'8px',background:'#2b0307',color:'#fff',font:'13px/1.4 sans-serif',boxShadow:'0 2px 10px #0004'});
    (document.body||document.documentElement).append(notice);setTimeout(()=>notice.remove(),4500);
  }
  function hoverItem(element){
    if(!webGeneral||!overlayState.enabled||!element)return null;
    if(element.localName==='video'){
      if(!rendered(element)||element.mediaKeys)return null;
      const raw=MediaInline.sourceOf(element);
      const url=C.absolute(raw,document.baseURI);
      if(!url||/[?&](range|bytestart|byteend)=/i.test(url))return null;
      const path=new URL(url).pathname;
      const format=/\.m3u8$/i.test(path)?'hls':/\.mpd$/i.test(path)?'dash':'direct';
      const dimensions={width:element.videoWidth,height:element.videoHeight};
      return {url,dimensions,kind:'video',format};
    }
    const item=imageRecord(element);
    if(!item?.available||item.interface&&!overlayState.includeInterface)return null;
    if(overlayEligible(item))return {url:item.url,dimensions:item};
    const original=overlayState.originals.get(item.url)?.find(candidate=>item.variants.includes(candidate.url)&&overlayEligible(candidate));
    if(original)return {url:original.url,dimensions:original,original:true};
    for(const url of item.variants.filter(url=>url!==item.url).slice(0,8)){
      const dimensions=measureImage(url,element);
      if(overlayEligible(dimensions))return {url,dimensions,original:true};
    }
    return null;
  }
  function showWebOverlay(image){
    const item=hoverItem(image);
    if(!item)return hideWebOverlay();
    const rect=image.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||rect.bottom<=0||rect.right<=0||rect.top>=innerHeight||rect.left>=innerWidth)return hideWebOverlay();
    if(!overlayState.button){
      const control=document.createElement('button');
      control.type='button';control.className='mc-web-image-download';
      control.title='Baixar esta imagem';control.setAttribute('aria-label',control.title);
      control.textContent='↓';
      Object.assign(control.style,{position:'fixed',zIndex:'2147483646',width:'32px',height:'32px',padding:'0',border:'1px solid rgba(117,2,15,.20)',borderRadius:'8px',background:'#f8f5f1',color:'#75020f',font:'22px/1 sans-serif',cursor:'pointer',boxShadow:'0 1px 4px #0003'});
      control.hidden=true;control.style.setProperty('display','none','important');
      control.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();});
      control.addEventListener('click',async event=>{
        event.preventDefault();event.stopPropagation();
        if(!event.isTrusted)return;
        const target=overlayState.image,url=overlayState.source;
        const item=hoverItem(target);
        if(item?.url!==url){hideWebOverlay();return;}
        control.disabled=true;
        try{
          const {dimensions}=item;
          const kind=item.kind||'image';
          let media={id:url,kind,webImage:kind==='image',url,site:location.hostname,page:'',available:true,width:dimensions.width,height:dimensions.height,format:item.format};
          if(kind==='video'){
            const sourceType=[...target.querySelectorAll('source[src]')].find(node=>node.src===url)?.type||'';
            media=await MediaInline.confirm(media,()=>target.isConnected&&hoverItem(target)?.url===url,{sourceType});
          }
          const response=await chrome.runtime.sendMessage({target:'worker',action:'enqueue',items:[media],skip:false});
          if(response?.error)throw Error(response.error);
          control.title='Mídia adicionada à fila';control.setAttribute('aria-label',control.title);
          webNotice('Mídia adicionada à fila.');
        }catch(error){
          control.title=MediaInline.errorMessage(error,'Não foi possível baixar esta mídia.');
          control.setAttribute('aria-label',control.title);webNotice(control.title);
        }
        finally{control.disabled=false;}
      });
      (document.body||document.documentElement).append(control);overlayState.button=control;
    }
    const control=overlayState.button;
    overlayState.image=image;overlayState.source=item.url;
    control.title=item.kind==='video'?'Baixar este vídeo':item.original?'Baixar original':'Baixar esta imagem';
    control.setAttribute('aria-label',control.title);
    const focused=document.activeElement;
    if(focused!==control&&(focused===image||focused?.contains(image))&&focused!==document.body){
      focused.after(control);
    }
    const left=`${Math.max(0,Math.min(innerWidth-32,rect.right-36))}px`,top=`${Math.max(0,Math.min(innerHeight-32,rect.top+4))}px`;
    if(control.style.left!==left)control.style.left=left;
    if(control.style.top!==top)control.style.top=top;
    control.hidden=false;control.style.setProperty('display','block','important');
  }
  function refreshWebPointer(){
    if(!lastWebPoint||!overlayState.enabled)return;
    const {x,y}=lastWebPoint;
    let stack=document.elementsFromPoint(x,y);
    if(stack[0]===overlayState.button)return;
    for(let next=stack[0]?.shadowRoot;next;next=stack[0]?.shadowRoot){
      const inner=next.elementsFromPoint(x,y);
      if(!inner.length||inner[0]===stack[0])break;
      stack=inner;
    }
    const top=stack[0];
    const media=stack.find(el=>el.matches('img,video'));
    const owner=media?.closest('a,picture,figure,button')||media?.parentElement;
    if(media===top||owner&&top&&(owner.contains(top)||top.contains(media)))return showWebOverlay(media);
    showWebOverlay(stack.find(el=>el.contains(top)&&backgroundSource(el)));
  }
  if(webGeneral){
    document.querySelectorAll('.mc-web-image-download,.mc-web-image-notice').forEach(control=>control.remove());
    chrome.storage.local.get(hoverSettingsKeys).then(settings=>{
      savedHoverOptions=settings.webHoverOptions||{};
      disabledHoverSites=settings.webHoverDisabled||{};
      applyHoverSettings();
    }).catch(()=>{});
    chrome.storage.onChanged.addListener((changes,area)=>{
      if(area!=='local'||!hoverSettingsKeys.some(key=>key in changes))return;
      if(changes.webHoverOptions)savedHoverOptions=changes.webHoverOptions.newValue||{};
      if(changes.webHoverDisabled)disabledHoverSites=changes.webHoverDisabled.newValue||{};
      applyHoverSettings();
    });
    let scheduled=false;
    document.addEventListener('pointermove',event=>{
      if(!event.isTrusted)return;
      if(event.target===overlayState.button)return;
      lastWebPoint={x:event.clientX,y:event.clientY};
      if(!overlayState.enabled||scheduled)return;
      scheduled=true;
      requestAnimationFrame(()=>{
        scheduled=false;refreshWebPointer();
      });
    },true);
    document.addEventListener('pointerout',event=>{if(!event.relatedTarget){lastWebPoint=null;hideWebOverlay();}},true);
    document.addEventListener('focusin',event=>{
      if(!overlayState.enabled||event.target===overlayState.button)return;
      const media=event.target.matches?.('img,video')?event.target:event.target.querySelector?.('img,video');
      if(media)showWebOverlay(media);
      else hideWebOverlay();
    },true);
    addEventListener('scroll',hideWebOverlay,{passive:true,capture:true});
    addEventListener('resize',hideWebOverlay,{passive:true});
  }
  function pageName(element) {
    if (adapter.id === 'instagram') {
      const story = /^\/stories\/([A-Za-z0-9_.]+)\/(?:\d+\/?)?$/.exec(location.pathname);
      if (story && story[1] !== 'highlights') return story[1];
      const post = element.closest('article,[role="dialog"]');
      for (const link of post?.querySelectorAll('header a[href]') || []) {
        if (link.origin !== location.origin) continue;
        const account = /^\/([A-Za-z0-9_.]+)\/?$/.exec(link.pathname)?.[1];
        if (account && !/^(explore|reels?|stories|accounts|p)$/i.test(account)) return account;
      }
      return ProfileCollector.profileUrl() ? location.pathname.split('/')[1] : '';
    }
    if (adapter.id === 'x') {
      const tweet = element.closest('article');
      const timestamp = [...(tweet?.querySelectorAll('a[href*="/status/"] time') || [])]
        .find(time => time.closest('article') === tweet)?.closest('a');
      if (timestamp?.origin === location.origin) return /^\/([A-Za-z0-9_]+)\/status\/\d+/.exec(timestamp.pathname)?.[1] || '';
      if (tweet && document.querySelectorAll('article').length === 1) return /^\/([A-Za-z0-9_]+)\/status\/\d+/.exec(location.pathname)?.[1] || '';
    }
    return '';
  }
  function add(kind, source, width, height, raw, element) {
    const page = pageName(element);
    if (!source) {
      if (!raw || !/^(blob:|data:|mediastream:)/i.test(raw)) return;
      const id = `unavailable:${kind}:${raw.slice(0,200)}`;
      if (!items.has(id)) items.set(id, {id, kind, url:'', preview:'', width:width||0, height:height||0, site:location.hostname, page, available:false, reason:'Mídia em fluxo ou endereço temporário; download direto indisponível.'});
      return;
    }
    const url = adapter.transform(source), id = C.key(url);
    const previous = items.get(id);
    if (!previous) items.set(id, {id, kind, url, preview:url, width:width||0, height:height||0, site:location.hostname, page, available:true, reason:''});
    else { previous.width = Math.max(previous.width, width||0); previous.height = Math.max(previous.height, height||0); }
  }
  function scan() {
    if(webGeneral||!document.documentElement)return;
    for(const img of document.images){
      const pictureSources=[...(img.closest('picture')?.querySelectorAll('source[srcset]')||[])].map(source=>source.getAttribute('srcset'));
      const sourceSet=[img.getAttribute('srcset')||img.getAttribute('data-srcset'),...pictureSources].filter(Boolean).join(', ');
      const src=C.bestSource(img.currentSrc||img.getAttribute('src')||img.getAttribute('data-src'),sourceSet,document.baseURI);
      add('image',src,img.naturalWidth||img.width,img.naturalHeight||img.height,img.currentSrc||img.src,img);
    }
    for(const video of document.querySelectorAll('video')){
      if(video.mediaKeys)continue;
      const raw=video.currentSrc||video.getAttribute('src')||video.querySelector('source[src]')?.getAttribute('src');
      add('video',C.absolute(raw,document.baseURI),video.videoWidth||video.clientWidth,video.videoHeight||video.clientHeight,raw,video);
    }
    for(const source of document.querySelectorAll('video source[src]')){
      if(!source.closest('video')?.mediaKeys)add('video',C.absolute(source.getAttribute('src'),document.baseURI),0,0,source.getAttribute('src'),source);
    }
    for(const el of document.querySelectorAll('[style*="background-image"]')){
      const match=el.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/i);
      if(match)add('image',C.absolute(match[1],document.baseURI),el.clientWidth,el.clientHeight,match[1],el);
    }
    state.updated=Date.now();
  }
  function laterScan() { if(webGeneral||profileMode) return; clearTimeout(scanTimer); scanTimer = setTimeout(scan, 400); }
  if(!webGeneral)new MutationObserver(laterScan).observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset','style']});
  scan();
  function delay(ms) { return new Promise(resolve => { timer = setTimeout(resolve, ms); }); }
  async function collect(limit) {
    if (running) return;
    running = true; stopped = false; paused = false; state.phase='running'; state.rounds=0; state.unchanged=0; state.stopReason=''; state.limit=Math.max(1,Math.min(2000,Number(limit)||200));
    let previous = items.size;
    while (!stopped && items.size < state.limit && state.rounds < 100) {
      if (paused) { await delay(500); continue; }
      window.scrollBy({top:Math.max(window.innerHeight * 0.85, 500),behavior:'auto'});
      await delay(1400); scan(); state.rounds++;
      state.unchanged = items.size === previous ? state.unchanged + 1 : 0;
      previous = items.size;
      if (state.unchanged >= 5) { state.stopReason='Nenhuma mídia nova após cinco rolagens; a página pode ter terminado ou limitado o carregamento.'; break; }
    }
    if (stopped) { state.phase='cancelled'; state.stopReason='Coleta interrompida pelo usuário; o resultado é parcial.'; }
    else if (items.size >= state.limit) { state.phase='limited'; state.stopReason='Limite de itens atingido; o resultado pode ser parcial.'; }
    else { state.phase='finished'; if (!state.stopReason) state.stopReason='Limite de rolagens atingido; o resultado pode ser parcial.'; }
    running = false;
  }
  async function profileCollect(options) {
    if(running) return;
    running=true; stopped=false; paused=false; profileMode=true; clearTimeout(scanTimer); items.clear();
    const username=location.pathname.split('/').filter(Boolean)[0] || 'perfil';
    Object.assign(state,{phase:'running',mode:'profile',posts:0,discovered:0,savedVideos:0,pending:[],fatal:'',current:'',stopReason:'',autoStatus:''});
    const control={limit:Math.max(0,Math.min(5000,Number(options.limit)||0)),username,images:options.kind!=='video',videos:options.kind!=='image',stopped:()=>stopped,paused:()=>paused,fatal:()=>state.fatal,update:patch=>Object.assign(state,patch)};
    const handledBlob=new Set();
    control.saveVideo=async(modal,postId,postUrl,isReel,mediaPosition)=>{
      const videos=[...modal.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect();return r.width>=100&&r.height>=100;});
      if(!videos.length&&isReel&&options.autoDownload){
        const marker=modal.querySelector('[aria-label="Reproduzir"],[aria-label="Reproduzir vídeo"],[aria-label="Play"],[aria-label="Play video"]');
        if(marker) try{videos.push(await MediaCapture.startPlayer(modal,marker.closest('button,[role="button"]')||marker.parentElement));}
        catch(error){return {keys:[],issue:error.message};}
      }
      if(!videos.length)return {keys:[],issue:''};
      const keys=[];let issue='';
      for(const video of videos){
        if(video.mediaKeys){issue='Este vídeo usa proteção e não pode ser processado.';continue;}
        const route=location.href;
        const belongs=()=>modal.isConnected&&modal.contains(video)&&location.href===route;
        const direct=C.absolute(MediaInline.sourceOf(video),document.baseURI);
        if(!direct||/[?&](range|bytestart|byteend)=/i.test(direct)){
          const blob=video.currentSrc||video.src;
          if(handledBlob.has(blob)){keys.push('captura:'+postId);continue;}
          if(!options.autoDownload){issue='Vídeo temporário precisa ser baixado diretamente durante a coleta; selecione o modo de download.';continue;}
          try{
            await MediaCapture.download(video,{post:postId,postUrl,page:username,site:'instagram.com',mediaPosition},options.outputFormat,true,()=>stopped,
             undefined,undefined,()=>{if(!belongs())throw Error(MediaInline.retry);});
            handledBlob.add(blob);state.savedVideos=handledBlob.size;keys.push('captura:'+postId);
          }catch(error){issue=MediaInline.errorMessage(error,'Vídeo não verificado.');}
          continue;
        }
        const id='instagram-video:'+postId+':'+C.key(direct);
        const format=/\.m3u8(?:[?#]|$)/i.test(direct)?'hls':/\.mpd(?:[?#]|$)/i.test(direct)?'dash':'direct';
        const sourceType=[...video.querySelectorAll('source[src]')].find(node=>node.src===direct)?.type||'';
        try{
          const item=await MediaInline.confirm({id,kind:'video',url:direct,format,
            width:video.videoWidth||0,height:video.videoHeight||0,site:'instagram.com',page:username,post:postId,postUrl,mediaPosition,available:true},
           ()=>belongs()&&C.absolute(MediaInline.sourceOf(video),document.baseURI)===direct,{sourceType});
          items.set(id,item);keys.push(id);
        }catch(error){issue=MediaInline.errorMessage(error,'Vídeo não verificado.');}
      }
      return {keys,issue};
    };
    function save(img,postId,mediaPosition) {
      const pictureSources=[...(img.closest('picture')?.querySelectorAll('source[srcset]')||[])].map(s=>s.getAttribute('srcset')).join(', ');
      const sourceSet=[img.getAttribute('srcset'),pictureSources].filter(Boolean).join(', ');
      const url=C.bestSource(img.currentSrc||img.src,sourceSet,document.baseURI);
      if(!url) return null;
      let filename; try {filename=new URL(url).pathname.split('/').pop();} catch {return null;}
      const id=`instagram:${postId}:${filename}`;
      const old=items.get(id);
      const found={id,kind:'image',url,preview:url,width:img.naturalWidth||img.width||0,height:img.naturalHeight||img.height||0,site:'instagram.com',page:username,post:postId,mediaPosition,available:true,reason:''};
      if(!old || found.width>old.width) items.set(id,found);
      return id;
    }
    try {
      const result=await ProfileCollector.run(control,save);
      Object.assign(state,{phase:result.phase,stopReason:result.reason,pending:result.pending});
      if(options.autoDownload && result.phase!=='cancelled') {
        if(!items.size) state.autoStatus=state.savedVideos?`${state.savedVideos} vídeo(s) salvo(s).`:'Nenhuma mídia encontrada para iniciar o download.';
        else {
          state.autoStatus='Enviando mídias para a fila de download…';
          const response=await chrome.runtime.sendMessage({target:'worker',action:'enqueue',items:[...items.values()],skip:options.skip,outputFormat:options.outputFormat});
          state.autoStatus=response?.error ? `Não foi possível iniciar a fila: ${response.error}` : `Fila iniciada com até ${items.size} mídia(s); confira o andamento abaixo.`;
        }
      }
    } catch(error) { Object.assign(state,{phase:'finished',stopReason:error.message || 'Não foi possível coletar este perfil.',autoStatus:''}); }
    finally { running=false; }
  }
  async function feedCollect(options){
   if(running)return;running=true;stopped=false;paused=false;profileMode=true;clearTimeout(scanTimer);items.clear();Object.assign(state,{phase:'running',mode:'feed',posts:0,discovered:0,pending:[],stopReason:'',autoStatus:''});
   try{const result=await ColetorFeed.collect(patch=>Object.assign(state,patch),()=>stopped,()=>paused,options.outputFormat);for(const item of result.items)items.set(item.id,item);state.pending=result.pending;state.phase=stopped?'cancelled':'finished';state.stopReason=stopped?'Coleta interrompida; resultado parcial.':'Feed carregado examinado; itens indisponíveis constam nas pendências.';if(result.savedVideos)state.autoStatus=result.savedVideos+' vídeo(s) salvo(s).';if(!stopped&&result.items.length){let r=await chrome.runtime.sendMessage({target:'worker',action:'enqueue',items:result.items,skip:options.skip,outputFormat:options.outputFormat});state.autoStatus=[state.autoStatus,r?.error||'Mídias adicionadas à fila.'].filter(Boolean).join(' ');}}
   catch(e){state.phase='finished';state.stopReason=e.message||'Falha ao examinar o feed.';}finally{running=false;}
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message || message.target !== 'collector') return;
    if (message.action === 'web-overlay-settings') {
      if(sender.id!==chrome.runtime.id||!webGeneral){reply({ok:false});return;}
      panelHoverOptions=message.enabled===true?message:null;
      applyHoverSettings();
      reply({ok:true});return;
    }
    if (message.action === 'snapshot') { if(!profileMode) scan(); reply({items:[...items.values()], state:{...state}, adapter:adapter.label, url:location.href, documentToken}); }
    if (message.action === 'start') { if(!running){profileMode=false; state.mode='page'; collect(message.limit);} reply({ok:true}); }
    if (message.action === 'feed-start') { if(running) reply({error:'Já existe uma coleta em andamento.'}); else if(!globalThis.ColetorFeed) reply({error:'Abra o feed do Instagram.'}); else { feedCollect(message);reply({ok:true}); } }
    if (message.action === 'profile-start') { if(running) reply({error:'Já existe uma coleta em andamento.'}); else if(!ProfileCollector.profileUrl()) reply({error:'Abra a grade de um perfil do Instagram antes de iniciar.'}); else { profileCollect(message); reply({ok:true}); } }
    if (message.action === 'pause') { if (running) { paused = !paused; state.phase = paused ? 'paused' : 'running'; } reply({ok:true}); }
    if (message.action === 'stop') { stopped=true; paused=false; reply({ok:true}); }
    if (message.action === 'clear') { items.clear(); if(!profileMode) scan(); reply({ok:true}); }
  });
  if(webGeneral){
    let walk;
    globalThis.ColetorWebImages=(step,id)=>{
      if(step==='restore'){
        if(walk?.id===id){window.scrollTo({left:walk.x,top:walk.y,behavior:'instant'});walk=null;}
        return null;
      }
      if(step==='start'||step==='advance'&&walk?.id!==id){
        walk={id,x:scrollX,y:scrollY};
        window.scrollTo({left:scrollX,top:0,behavior:'instant'});
      }else if(step==='advance'){
        window.scrollBy({top:Math.max(100,innerHeight*0.8),behavior:'instant'});
      }
      const scroll=document.scrollingElement;
      return {documentToken,url:location.href,items:webImageInventory(),atEnd:!scroll||scroll.scrollHeight<=scroll.scrollTop+innerHeight+2};
    };
  }
  globalThis.ColetorInline={startProfile:opts=>{if(running)return false;profileCollect(opts);return true;},isRunning:()=>running};
  globalThis.__coletorMidias = true;
})();
