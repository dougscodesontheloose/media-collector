let fixedTabId=Number(new URL(location.href).searchParams.get('tab'))||null;let tabId=fixedTabId;
const $=id=>document.getElementById(id),selected=new Set(),quality=new Map(),qualityLists=new Map(),imageVariants=new Map(),imageVariantLists=new Map(),imageVariantPending=new Set(),imageVariantErrors=new Map(),verifiedVideos=new Map();
let transfers={},starting=new Map(),statusBusy=false;
let items=[],state={},history={},job=null,fingerprint='',busy=false,playerItems=[],lastPlayerScan=0,webGeneral=false,currentPageKey='';
async function askTab(action,extra={}){if(!tabId)throw Error('Nenhuma aba selecionada.');const r=await chrome.tabs.sendMessage(tabId,{target:'collector',action,...extra},{frameId:0});if(r?.error)throw Error(r.error);return r;}
async function askWorker(action,extra={}){const r=await chrome.runtime.sendMessage({target:'worker',action,...extra});if(r?.error)throw Error(r.error);return r;}
function report(e){const status=$('action-status');status.hidden=false;status.textContent=e?.message||String(e);}
function historyKey(id){return MediaNativeStream.transferKey(String(id),'history');}
function wasDownloaded(id){return !!(history[historyKey(id)]||history[id]);}
const imageSizes=[100,200,400,600,800,1000,1001];
let overlayPort, lastConnectAttempt=0, hoverHost='', hoverDisabled={};
let nativeDestination=false;
function syncHoverSite(host){
 hoverHost=host;
 $('web-hover-site').checked=!hoverDisabled[host];
}
$('web-hover-site').onchange=async event=>{
 if(!hoverHost)return;
 const disabled={...hoverDisabled};
 if(event.target.checked)delete disabled[hoverHost];else disabled[hoverHost]=true;
 hoverDisabled=disabled;
 await chrome.storage.local.set({webHoverDisabled:disabled});
 syncOverlay();
};
function persistHoverFilters(){
 chrome.storage.local.set({webHoverOptions:imageFilters()}).catch(report);
}
function showFile(downloadId,filename){
 return filename?askWorker('destination-reveal',{filename}):chrome.downloads.show(downloadId);
}
async function refreshDestination(){
 const result=await askWorker('destination-get');
 nativeDestination=result.available;
 $('destination-choose').disabled=!nativeDestination;
 $('destination-choose').textContent=result.destination?.mode==='folder'?'Alterar pasta padrão':'Escolher pasta para os downloads';
 if(result.destination)$('destination-browser').checked=result.destination.mode==='browser';
 $('destination-status').textContent=result.error||(
  result.destination?.mode==='browser'
   ?nativeDestination?'Pasta Downloads configurada no navegador. Essa preferência será usada nas próximas páginas.':'Pasta Downloads configurada no navegador. Para selecionar outra pasta, instale o auxiliar local.'
   :result.destination?.folder
    ?nativeDestination?`Memorizada: ${result.destination.folder}`:`Memorizada: ${result.destination.folder}. O auxiliar local está indisponível; os downloads não serão desviados para outra pasta.`
    :'Auxiliar local indisponível. Escolha Downloads do navegador ou instale o auxiliar para selecionar outra pasta.');
}
async function chooseSaveDestination(remember=false){
 if(!nativeDestination)return {mode:'ask'};
 const result=await askWorker('destination-choose',{remember});
 if(result.cancelled)return null;
 return result.destination;
}
$('destination-choose').onclick=()=>action(async()=>{
 const chosen=await chooseSaveDestination(true);
 if(!chosen||chosen.mode!=='folder')return;
 await refreshDestination();
});
$('destination-browser').onchange=()=>action(async()=>{
 await askWorker('destination-browser',{enabled:$('destination-browser').checked});
 await refreshDestination();
});
function currentImageSize(){return $('web-image-filter').checked?(imageSizes[Number($('web-image-size').value)]||600):0;}
function syncOverlay(){
 if(!tabId)return;
 if(!overlayPort){
  const port=chrome.runtime.connect({name:'media-collector-web-overlay'});
  overlayPort=port;
  port.onDisconnect.addListener(()=>{if(overlayPort===port)overlayPort=null;});
 }
 const originals=items.filter(i=>i.kind==='image'&&imageVariantLists.has(i.id)).slice(0,200)
  .map(i=>[i.url,imageVariantLists.get(i.id).filter(size=>size.url!==i.url&&passesImageFilter({kind:'image',...size}))
   .sort((a,b)=>b.width*b.height-a.width*a.height)]);
 try{
  overlayPort.postMessage({tabId,enabled:webGeneral&&!hoverDisabled[hoverHost]&&['all','image'].includes($('kind').value),
   minimum:currentImageSize(),includeInterface:$('web-image-interface').checked,minWidth:Number($('min-width').value)||0,minHeight:Number($('min-height').value)||0,originals});
 }catch{overlayPort=null;}
}
function updateImageSize(){
 const size=currentImageSize(),label=!size?'Sem mínimo':size===1001?'Acima de 1000 × 1000 px':`A partir de ${size} × ${size} px`;
 $('web-image-size').disabled=!size;
 $('web-image-size-label').textContent=label;
 $('web-image-size').setAttribute('aria-valuetext',label);
 syncOverlay();
}
function effectiveItem(item){return {...item,...(imageVariants.get(item.id)||{})};}
function passesImageFilter(item){
 return imageAllowed(item,imageFilters());
}
function imageFilters(){
 return {includeInterface:$('web-image-interface').checked,minimum:currentImageSize(),
  minWidth:Number($('min-width').value)||0,minHeight:Number($('min-height').value)||0};
}
function imageAllowed(item,filters){
 return (!item.interface||filters.includeInterface)&&item.width>=Math.max(filters.minimum,filters.minWidth)&&item.height>=Math.max(filters.minimum,filters.minHeight);
}
function needsImageVariant(item){return webGeneral&&item.kind==='image'&&item.variants?.length>1&&!passesImageFilter(effectiveItem(item));}
function needsVerification(item){return webGeneral&&item.kind==='video'&&(!item.width||!item.height)&&item.url;}
function filtered(){return items.filter(i=>{
 if(webGeneral&&i.kind==='image'){
  if(!['all','image'].includes($('kind').value)||i.interface&&!$('web-image-interface').checked)return false;
  return !i.available||needsImageVariant(i)||passesImageFilter(effectiveItem(i));
 }
 if(needsVerification(i)||(i.kind==='video'&&i.association==='player'&&!i.available&&!i.url))return ['all','video'].includes($('kind').value);
 if(needsImageVariant(i))return ['all','image'].includes($('kind').value);
 const effective=effectiveItem(i);
 return (!webGeneral||MediaCore.webEligible(effective,0))&&MediaCore.visible(effective,{kind:$('kind').value,minWidth:$('min-width').value,minHeight:$('min-height').value});
});}
function selectedItems(){return filtered().filter(i=>i.available&&!needsVerification(i)&&!needsImageVariant(i)&&selected.has(i.id)).map(i=>{const variant=imageVariants.get(i.id);return {...i,...(variant||{}),id:variant?(webGeneral?variant.url:MediaCore.key(variant.url)):i.id,quality:quality.get(i.id)};});}
async function loadQuality(item,button){button.disabled=true;button.textContent='Lendo…';try{let options=await StreamTools.inspect(item.url,item.format);if(webGeneral&&item.kind==='video')options=options.filter(q=>q.width>500&&q.height>500);if(!options.length)throw Error('Nenhuma qualidade confirmada acima de 500 × 500 px.');qualityLists.set(item.id,options);if(!quality.has(item.id))quality.set(item.id,options[0].id);renderGrid();}catch(e){button.textContent=e.message||'Qualidades indisponíveis';button.disabled=false;}}
function transferFor(item){
 const output=item.kind==='audio'&&!['mp3','m4a','audio-original'].includes($('video-format').value)?'audio-original':$('video-format').value;
 return transfers[MediaNativeStream.transferKey(item.url,output)];
}
function mediaState(item){
 if(starting.has(item.id))return {state:'starting',phase:'Iniciando…'};
 return transferFor(item);
}
async function quickDownload(item,again=false,destination){
 if(starting.has(item.id))return;
 starting.set(item.id,true);renderGrid();
 try{
  if(needsVerification(item)){
   if(item.association==='observed-candidate')await verifyVideo(item);
   else{
    const confirmation=await askWorker('player-confirm',{tabId,documentId:item.documentId,player:item.player,url:item.url});
    const output=$('video-format').value;
    if(!confirmation.mp4||!['mp4','original'].includes(output))await verifyVideo(item);
   }
  }
  await downloadMedia([{...item,quality:quality.get(item.id)}],true,again,destination);
 }catch(error){
  const output=item.kind==='audio'&&!['mp3','m4a','audio-original'].includes($('video-format').value)?'audio-original':$('video-format').value;
  transfers[MediaNativeStream.transferKey(item.url,output)]={output,state:'failed',error:error.message,updatedAt:Date.now()};
  await askWorker('transfer-error',{item:{...item,output},error:error.message}).catch(()=>{});
  report(error);
 }finally{starting.delete(item.id);renderGrid();await refresh();}
}
async function verifyVideo(item){
 const verifiedTab=tabId;
     let size;
     if(item.association==='observed-candidate'){
      const confirmation=await askWorker('observed-source-confirm',{tabId,frameId:item.frameId,documentId:item.documentId,url:item.url});
      if(confirmation.kind!==item.kind||confirmation.format!==item.format||confirmation.origin!==item.sourceOrigin)
       throw Error('A fonte mudou de tipo ou origem. Atualize a lista.');
      item.mime=confirmation.mime;item.expectedBytes=confirmation.expectedBytes;
      item.mp4Direct=confirmation.kind==='video'&&confirmation.format==='direct'&&confirmation.mime==='video/mp4';
     }
     if(['hls','dash'].includes(item.format)){
      const options=(await StreamTools.inspect(item.url,item.format)).filter(q=>q.width>500&&q.height>500);
      if(!options.length)throw Error('Nenhuma qualidade com dimensões verificadas acima de 500 × 500 px.');
      qualityLists.set(item.id,options);quality.set(item.id,options[0].id);size=options[0];
      if(item.association==='observed-candidate')await StreamTools.resolve(item.url,item.format,options[0].id);
     }else{
      size=item.association==='player'?await askWorker('player-metadata',{tabId,documentId:item.documentId,player:item.player,url:item.url}).catch(()=>null):null;
      if(!size?.width)size=await new Promise((resolve,reject)=>{
       const video=document.createElement('video');let timer;
       const finish=(result,error)=>{clearTimeout(timer);video.removeAttribute('src');video.load();error?reject(Error(error)):resolve(result);};
       timer=setTimeout(()=>finish(null,'Não foi possível verificar as dimensões.'),12000);
       video.onloadedmetadata=()=>finish({width:video.videoWidth,height:video.videoHeight});
       video.onerror=()=>finish(null,'Não foi possível ler os metadados do vídeo.');video.preload='metadata';video.src=item.url;
      });
      if(size.width<=500||size.height<=500)throw Error('O vídeo não ultrapassa 500 × 500 px.');
     }
     if(tabId!==verifiedTab||!items.some(current=>current.id===item.id&&current.url===item.url))throw Error('A página mudou. Atualize a lista.');
     verifiedVideos.set(item.id,{url:item.url,width:size.width,height:size.height});item.width=size.width;item.height=size.height;fingerprint='';renderGrid();
}
function renderGrid(){
 const list=filtered(),available=list.filter(i=>i.available&&!needsVerification(i)&&!needsImageVariant(i));$('count').textContent=`${list.length} · ${available.filter(i=>selected.has(i.id)).length}`;$('select-all').textContent=available.length&&available.every(i=>selected.has(i.id))?'Limpar seleção':'Selecionar visíveis';$('empty').hidden=!!list.length;$('grid').replaceChildren();
 for(const item of list){const tile=document.createElement('div');tile.dataset.mediaId=item.id;tile.className=`tile${item.available?'':' disabled'}`;
  const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(item.id);check.disabled=!item.available||needsVerification(item)||needsImageVariant(item);check.setAttribute('aria-label',`Selecionar ${item.kind==='image'?'foto':item.kind==='audio'?'áudio':'vídeo'}`);check.onchange=()=>{check.checked?selected.add(item.id):selected.delete(item.id);renderGrid();};tile.append(check);
  if(item.kind==='image'&&item.preview){const im=document.createElement('img');im.loading='lazy';im.alt='Prévia';im.src=item.preview;im.referrerPolicy='no-referrer';tile.append(im);}else{const p=document.createElement('span');p.className='placeholder';p.textContent=item.kind==='video'?'▷':item.kind==='audio'?'♫':'◇';tile.append(p);}
  const variant=imageVariants.get(item.id);const historyIdentity=variant?(webGeneral?variant.url:MediaCore.key(variant.url)):item.id;
  const meta=document.createElement('span');meta.className='meta';meta.textContent=`${item.kind==='video'?'Vídeo':item.kind==='audio'?'Áudio':'Foto'}${item.association==='observed-candidate'?` · Candidato de rede · ${item.sourceHost||'origem desconhecida'} · quadro ${item.frameId}`:''}${item.playerLabel?` · ${item.playerLabel}`:''}${item.format==='hls'?' · HLS':item.format==='dash'?' · DASH':''}${item.width&&item.height?` · ${item.width}×${item.height}`:''}${item.duration?` · ${Math.round(item.duration)} s`:''}${item.kind==='video'?' · áudio desconhecido':item.kind==='audio'?' · faixa de áudio':''}${wasDownloaded(historyIdentity)?' · baixado':''}${item.reason?` · ${item.reason}`:''}`;tile.append(meta);
  if(needsVerification(item)&&item.available&&['player','observed-candidate'].includes(item.association)){
   const button=document.createElement('button');button.className='text-button quality';button.textContent='Verificar fonte';
   button.onclick=async()=>{
    button.disabled=true;button.textContent='Verificando…';
    try{await verifyVideo(item);}catch(error){button.textContent=error.message||'Não foi possível verificar';button.disabled=false;}
   };tile.append(button);
  }
  if(item.kind==='image' && item.variants?.length>1){
   const known=imageVariantLists.get(item.id);
   const choices=known?.filter(size=>passesImageFilter({kind:'image',...size}));
   if(choices?.length){
    const select=document.createElement('select');select.className='quality';select.setAttribute('aria-label','Resolução da imagem');
    for(const size of choices){const option=document.createElement('option');option.value=size.url;option.textContent=`${size.width} × ${size.height}`;select.append(option);}
    const saved=imageVariants.get(item.id);select.value=choices.some(size=>size.url===(saved?.url||item.url))?(saved?.url||item.url):choices[0].url;
    imageVariants.set(item.id,choices.find(size=>size.url===select.value));check.disabled=!item.available;
    select.onchange=()=>{imageVariants.set(item.id,choices.find(size=>size.url===select.value));renderGrid();};tile.append(select);
   }else if(known){
    const notice=document.createElement('span');notice.className='meta';notice.textContent='Nenhuma resolução atende ao filtro atual.';tile.append(notice);
   }else{
    const button=document.createElement('button');button.className='text-button quality';button.textContent=imageVariantPending.has(item.id)?'Verificando…':imageVariantErrors.get(item.id)||'Ver resoluções';button.disabled=imageVariantPending.has(item.id);
    button.onclick=async()=>{
     const verifiedPage=currentPageKey;imageVariantPending.add(item.id);imageVariantErrors.delete(item.id);renderGrid();
     const sizes=await Promise.all(item.variants.map(url=>new Promise(resolve=>{
      const image=new Image();const timeout=setTimeout(()=>resolve(null),10000);
      image.onload=()=>{clearTimeout(timeout);resolve({url,width:image.naturalWidth,height:image.naturalHeight});};
      image.onerror=()=>{clearTimeout(timeout);resolve(null);};image.src=url;
     })));
     if(verifiedPage!==currentPageKey)return;
     imageVariantPending.delete(item.id);const verified=sizes.filter(Boolean);
     if(verified.length)imageVariantLists.set(item.id,verified);else imageVariantErrors.set(item.id,'Resoluções indisponíveis');
     renderGrid();
    };tile.append(button);
   }
  }
  if(['hls','dash'].includes(item.format)){const options=qualityLists.get(item.id);if(options){let sel=document.createElement('select');sel.className='quality';sel.setAttribute('aria-label','Qualidade do vídeo');for(const q of options){let opt=document.createElement('option');opt.value=q.id;opt.textContent=q.label;sel.append(opt);}sel.value=quality.get(item.id)||options[0].id;sel.onchange=()=>quality.set(item.id,sel.value);tile.append(sel);}else{let b=document.createElement('button');b.className='text-button quality';b.textContent='Qualidade ▾';b.onclick=()=>loadQuality(item,b);tile.append(b);}}
  if(webGeneral&&item.available&&item.kind!=='image'&&['player','observed-candidate'].includes(item.association)&&!needsVerification(item)){
   const quick=document.createElement('button');
   quick.className='text-button quality';
   const transfer=mediaState(item);
   const labels={starting:'Iniciando…',queued:'Na fila',downloading:'Baixando',processing:'Processando',paused:'Pausado',saved:'Salvo',failed:'Falhou',cancelled:'Cancelado'};
   const active=transfer&&['starting','queued','downloading','processing','paused'].includes(transfer.state);
   quick.textContent=active?labels[transfer.state]:transfer?.state==='saved'?'Baixar novamente':
    transfer&&['failed','cancelled'].includes(transfer.state)?'Tentar novamente':item.kind==='audio'?'Baixar áudio':'Baixar vídeo';
   quick.disabled=!!active;
   quick.onclick=()=>quickDownload(item,!!transfer);
   if(transfer){
    const feedback=document.createElement('span');feedback.className='meta transfer-state';
    feedback.setAttribute('role','status');
    const bytes=transfer.bytes||0,total=transfer.totalBytes||0;
    const amount=bytes>0?' · '+(bytes/1048576).toFixed(1)+' MB'+(total>0?' / '+(total/1048576).toFixed(1)+' MB · '+Math.floor(bytes*100/total)+'%':''):'';
    feedback.textContent=(labels[transfer.state]||transfer.state)+(transfer.phase&&transfer.phase!==labels[transfer.state]?' · '+transfer.phase:'')+amount+(transfer.error?' · '+transfer.error:'');
    tile.append(feedback);
    if(active){const progress=document.createElement('progress');progress.max=100;if(total>0)progress.value=bytes*100/total;else if(transfer.total>0)progress.value=transfer.completed*100/transfer.total;tile.append(progress);}
    if(transfer.state==='saved'&&(transfer.filename||Number.isInteger(transfer.downloadId))){
     const show=document.createElement('button');show.className='text-button quality';show.textContent='Mostrar na pasta';
     show.onclick=()=>action(()=>showFile(transfer.downloadId,transfer.filename));tile.append(show);
    }
   }
   if(transfer?.publicationId){
    const retry=document.createElement('button');
    retry.className='text-button quality';retry.textContent='Tentar gravar novamente';
    retry.onclick=()=>action(()=>askWorker('destination-retry',{id:transfer.publicationId}));tile.append(retry);
   }
   tile.append(quick);
   if(!active){
    const saveAs=document.createElement('button');
    saveAs.className='text-button quality';saveAs.textContent='Salvar em…';
    saveAs.onclick=()=>action(async()=>{
     await refreshDestination();
     const destination=await chooseSaveDestination();
     if(destination)await quickDownload(item,!!transfer,destination);
    });
    tile.append(saveAs);
   }
  }
  $('grid').append(tile);
 }
 const found=items.filter(item=>item.kind==='image'&&item.available&&(!item.interface||$('web-image-interface').checked));
 const status=$('image-hover-status');
 const message=!webGeneral||!['all','image'].includes($('kind').value)?'':
  found.length&&!found.some(item=>passesImageFilter(effectiveItem(item)))?
   'Nenhuma imagem verificada atende ao filtro. Diminua o tamanho mínimo ou verifique as resoluções.':
   'Passe o mouse sobre uma imagem elegível para baixá-la.';
 if(status.textContent!==message)status.textContent=message;
 syncOverlay();
}
function setProgress(el,percent,indeterminate){if(indeterminate)el.removeAttribute('value');else el.value=Math.max(0,Math.min(100,percent||0));}
function renderState(){
 const phases={idle:'Pronto',running:'Coletando',paused:'Pausada',cancelled:'Interrompida',finished:'Parcial possível',limited:'Limite atingido'};$('collect-state').textContent=phases[state.phase]||'Pronto';
 const collecting=['running','paused'].includes(state.phase),profile=state.mode==='profile'||state.mode==='feed';
 $('collect-count').textContent=profile?`${state.posts||0} post(s)`:`${items.length} mídia(s)`;setProgress($('collect-progress'),0,collecting);
 $('collect-detail').textContent=profile?`${state.posts||0} examinadas · ${state.mode==='feed'?(state.mediaCount||0):(items.length+(state.savedVideos||0))} mídias · ${(state.pending||[]).length} pendentes. ${state.current?'Post '+state.current+'. ':''}${state.stopReason||''} ${state.autoStatus||''}`:(state.stopReason||'Aguardando uma coleta.');
 $('profile-pending').textContent=(state.pending||[]).map(p=>`${p.id}: ${p.reason}`).join('\n')||'Nenhuma pendência.';$('errors').textContent=job?.errors?.join('\n')||'';
 $('feed-download').disabled=collecting;$('profile-scan').disabled=collecting;$('profile-download').disabled=collecting||!!(job&&['running','paused'].includes(job.status));$('collect-pause').disabled=!collecting;$('collect-pause').textContent=state.phase==='paused'?'Retomar coleta':'Pausar coleta';$('stop').disabled=!collecting;
 $('download-file-actions').hidden=!job?.lastSavedPath&&!Number.isInteger(job?.lastDownloadId);
 $('open-download').hidden=!Number.isInteger(job?.lastDownloadId);
 $('retry-publication').hidden=!job?.lastPublicationId;
 const active=job&&['running','paused'].includes(job.status);$('download').disabled=!!active;$('download-as').disabled=!!active;$('download-pause').disabled=!active;$('cancel-download').disabled=!active;$('download-pause').textContent=job?.status==='paused'?'Retomar fila':'Pausar fila';
 const processed=(job?.done||0)+(job?.failed||0),total=job?.total||0;setProgress($('download-progress'),total?100*processed/total:0,false);$('download-count').textContent=total?`${processed} / ${total}`:'—';
 const labels={running:'Baixando',paused:'Fila pausada',cancelled:'Fila cancelada',finished:'Fila finalizada'};$('download-state').textContent=job?`${labels[job.status]||job.status} · ${job.done} concluído(s), ${job.failed} falha(s).`:'Nenhuma fila ativa.';
 let current=job?.current;const inspection=current?.inspection||job?.lastInspection;
 $('file-state').textContent=current?(current.total>0?`${current.phase}: ${current.completed||0} / ${current.total}`:(current.totalBytes>0?`${current.phase}: ${Math.round((current.bytes||0)*100/current.totalBytes)}%`:`${current.phase||'Processando'}…`)) : inspection?`Último arquivo: ${inspection.video?'vídeo · ':''}${inspection.audio?'áudio presente':inspection.audioExpected==='unknown'?'áudio não identificado na origem':'sem áudio'}${Number.isFinite(inspection.duration)?` · ${Math.round(inspection.duration)} s`:''}`:'';
}
function resetPage(){
 selected.clear();quality.clear();qualityLists.clear();verifiedVideos.clear();imageVariants.clear();
 imageVariantLists.clear();imageVariantPending.clear();imageVariantErrors.clear();
 items=[];state={};playerItems=[];lastPlayerScan=0;fingerprint='';currentPageKey='';
 $('capture-status').hidden=true;$('action-status').hidden=true;
}
async function attachedSnapshot(){
 try{return await askTab('snapshot');}catch{}
 if(!tabId||Date.now()-lastConnectAttempt<3000)return null;
 lastConnectAttempt=Date.now();
 await askWorker('collector-connect',{tabId});
 return askTab('snapshot');
}
async function refreshTransfers(){
 if(statusBusy)return;
 statusBusy=true;
 try{
  const worker=await askWorker('status');
  history=worker.history||{};job=worker.job;transfers=worker.transfers||{};
  const next=JSON.stringify([items,history,transfers]);
  if(next!==fingerprint){fingerprint=next;renderGrid();}
  renderState();
 }catch(error){report(error);}finally{statusBusy=false;}
}
async function refresh(){
 if(busy)return;
 busy=true;
 try{
  if(!fixedTabId){
   const saved=(await chrome.storage.session.get('panel-tab'))['panel-tab'];
   const next=saved||tabId||(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.id;
   if(next!==tabId){tabId=next;resetPage();lastConnectAttempt=0;}
  }
  let snapshot, scannedItems=[], connectionError='';
  try{snapshot=await attachedSnapshot();}catch(error){connectionError=error.message||'';}
  const connection=$('connection-status');
  connection.hidden=!!snapshot;
  connection.textContent=snapshot?'':/permission|cannot access|host/i.test(connectionError)?
   'A extensão precisa de acesso a este site. Libere o acesso e clique em Atualizar aba ativa.':
   'Conectando à página. Se o painel continuar vazio, clique em Atualizar aba ativa.';
  webGeneral=!!snapshot&&MediaAdapters.select(new URL(snapshot.url).hostname).id==='generic';
  $('web-filter-info').hidden=!webGeneral;
  if(snapshot){
   syncHoverSite(new URL(snapshot.url).hostname);
   const pageKey=tabId+':'+snapshot.documentToken+':'+snapshot.url;
   if(currentPageKey&&currentPageKey!==pageKey)resetPage();
   currentPageKey=pageKey;
   state=snapshot.state||{};
   $('site').textContent=snapshot.adapter+' · '+snapshot.url;
   scannedItems=snapshot.items||[];
   if(Date.now()-lastPlayerScan>10000){
    if(webGeneral)await askWorker('collector-connect',{tabId,framesOnly:true}).catch(()=>{});
    const scan=await askWorker('player-scan',{tabId}).catch(()=>({items:[]}));
    playerItems=scan.items||[];
    lastPlayerScan=Date.now();
   }
   if(webGeneral){const result=await askWorker('web-images',{tabId,step:'read'}).catch(()=>({frames:[]}));scannedItems=pageImages(result.frames);}
  }else{
   if(currentPageKey)resetPage();
   syncHoverSite('');
   $('site').textContent='Aguardando a página';
  }
  const [,detect]=await Promise.all([refreshTransfers(),snapshot?askWorker('detected',{tabId}):{items:[]}]);
  items=scannedItems;
  mergeMedia(snapshot,detect.items||[]);
  const next=JSON.stringify([items,history,transfers]);
  if(next!==fingerprint){fingerprint=next;renderGrid();}
  else syncOverlay();
  renderState();
 }catch(e){report(e);}finally{busy=false;}
}
function mergeMedia(snapshot,observed){
 const site=snapshot?new URL(snapshot.url).hostname:null;
 const network=new Map();
 const key=item=>JSON.stringify([item.documentId,item.frameId,item.url]);
 for(const item of observed)if(item.documentId)network.set(key(item),item);
 const urls=new Set(items.map(item=>item.url).filter(Boolean));
 const playerKeys=new Set();
 for(const item of playerItems.filter(item=>item.kind)){
  const identity=key(item);
  if(webGeneral&&playerKeys.has(identity)||!webGeneral&&item.url&&urls.has(item.url))continue;
  playerKeys.add(identity);
  const matched=item.documentId&&item.url&&network.get(key(item));
  const confirmed={...item,site:site||item.site};
  if(matched&&confirmed.available){
   confirmed.format=matched.format;
   if([401,403].includes(matched.status))confirmed.reason='O site recusou esta fonte. Abra ou reproduza o vídeo na sua sessão e tente novamente.';
   if([404,410].includes(matched.status))confirmed.reason='A fonte está indisponível ou expirou. Reabra o player para renovar a fonte.';
  }
  items.push(confirmed);
  if(item.url)urls.add(item.url);
 }
 if(webGeneral){
  for(const item of ObservedMedia.candidates(observed,playerItems,site)){items.push(item);urls.add(item.url);}
 }
 const remaining=webGeneral?playerItems.filter(item=>!item.kind):[...observed,...playerItems.filter(item=>!item.kind)];
 for(const item of remaining){
  if(!item.url||urls.has(item.url))continue;
  if(webGeneral&&item.documentId&&playerKeys.has(key(item)))continue;
  items.push({id:MediaCore.key(item.url),kind:item.mediaKind||'video',url:item.url,format:item.format,width:0,height:0,
   site:site||'pagina',page:'',available:!webGeneral,reason:'Fonte observada na aba; associação ao player não confirmada.'});
  urls.add(item.url);
 }
 for(const item of items){
  const verification=verifiedVideos.get(item.id);
  if(verification?.url===item.url){item.width=verification.width;item.height=verification.height;}
 }
}
function pageImages(frames){
 const result=new Map();
 for(const frame of frames)for(const item of frame.items){
  const previous=result.get(item.id);
  if(!previous){result.set(item.id,item);continue;}
  const preferred=previous.available?previous:item;
  result.set(item.id,{...preferred,interface:previous.interface&&item.interface,
   variants:[...new Set([...(previous.variants||[]),...(item.variants||[])])]});
 }
 return [...result.values()];
}
let imageWalk=null;
async function downloadPageImages(){
 if(imageWalk||!webGeneral)return;
 const walk={id:crypto.randomUUID(),tab:tabId,page:currentPageKey,cancelled:false};
 imageWalk=walk;
 const filters=imageFilters(),skip=$('skip').checked,found=new Map();
 const status=$('web-images-status'),button=$('web-images-download'),cancel=$('web-images-cancel');
 const read=step=>askWorker('web-images',{tabId:walk.tab,walkId:walk.id,step});
 button.disabled=true;status.hidden=false;cancel.hidden=false;
 const deadline=Date.now()+30000;
 let stable=0, count=0, step='start', pending=0;
 try{
  await askWorker('collector-connect',{tabId:walk.tab,framesOnly:true});
  while(!walk.cancelled&&Date.now()<deadline&&stable<3){
   const {frames}=await read(step);
   const main=frames.find(frame=>frame.frameId===0);
   if(!main||walk.page!==walk.tab+':'+main.documentToken+':'+main.url||walk.tab!==tabId)throw Error('A página mudou. Atualize a aba ativa para iniciar outra coleta.');
   const images=pageImages(frames);
   pending=0;
   for(const item of images){
    if(item.interface&&!filters.includeInterface)continue;
    if(!item.available)pending++;
    if(item.available&&imageAllowed(item,filters))found.set(item.id,item);
   }
   stable=frames.every(frame=>frame.atEnd)&&found.size===count?stable+1:0;
   count=found.size;
   status.textContent='Buscando imagens na página · '+count+' encontradas';
   step='advance';
   if(stable<3)await new Promise(resolve=>setTimeout(resolve,400));
  }
  if(walk.cancelled){status.textContent='Busca cancelada.';return;}
  const partial=stable<3||pending;
  if(!count){status.textContent='Nenhuma imagem disponível para os filtros atuais.';return;}
  const ready=[...found.values()].filter(item=>!skip||!wasDownloaded(item.id));
  if(ready.length)await askWorker('enqueue',{items:ready,skip});
  status.textContent=ready.length?ready.length+' imagem(ns) na fila.'+(partial?' A coleta pode estar incompleta.':''):'As imagens encontradas já foram baixadas.';
 }catch(error){status.textContent=error.message;}
 finally{
  await read('restore').catch(()=>{});
  button.disabled=false;cancel.hidden=true;imageWalk=null;
  await refresh();
 }
}
async function action(fn){$('action-status').hidden=true;try{await fn();await refresh();}catch(e){report(e);}}
async function profileStart(autoDownload){selected.clear();fingerprint='';await askTab('profile-start',{limit:$('profile-limit').value,kind:$('profile-kind').value,autoDownload,skip:$('skip').checked,outputFormat:$('video-format').value});}
$('feed-download').onclick=()=>action(()=>askTab('feed-start',{skip:false,outputFormat:$('video-format').value}));$('profile-scan').onclick=()=>action(()=>profileStart(false));$('profile-download').onclick=()=>action(()=>profileStart(true));$('collect-pause').onclick=()=>action(()=>askTab('pause'));$('stop').onclick=()=>action(()=>askTab('stop'));
$('refresh').onclick=()=>action(async()=>{
 const browserWindow=await chrome.windows.getLastFocused({windowTypes:['normal']});
 const [active]=await chrome.tabs.query({active:true,windowId:browserWindow.id});
 if(!active?.id||!/^https?:/i.test(active.url||''))throw Error('Abra uma página HTTP ou HTTPS na aba ativa e tente novamente.');
 fixedTabId=null;tabId=active.id;await chrome.storage.session.set({'panel-tab':tabId});
 resetPage();lastConnectAttempt=0;syncOverlay();
});
$('video-format').addEventListener('change',renderGrid);
for(const id of ['kind','min-width','min-height'])$(id).addEventListener('input',()=>{renderGrid();syncOverlay();});
$('web-images-download').onclick=downloadPageImages;
$('web-images-cancel').onclick=()=>{if(imageWalk)imageWalk.cancelled=true;};
$('web-image-interface').addEventListener('input',renderGrid);
$('web-image-filter').addEventListener('input',()=>{updateImageSize();renderGrid();});
$('web-image-size').addEventListener('input',()=>{updateImageSize();renderGrid();});updateImageSize();
$('select-all').onclick=()=>{let vis=filtered().filter(i=>i.available&&!needsVerification(i)&&!needsImageVariant(i)),clear=vis.length&&vis.every(i=>selected.has(i.id));for(const i of vis)clear?selected.delete(i.id):selected.add(i.id);renderGrid();};
$('enable-capture').onclick=()=>action(async()=>{await askWorker('web-capture-enable',{tabId});$('capture-status').hidden=false;$('capture-status').textContent='Captura ativa. Reabra o player nesta página e inicie a reprodução.';lastPlayerScan=0;});
async function downloadMedia(chosen,quick=false,again=false,destination){
 const captures=chosen.filter(item=>item.capture);
 if(webGeneral){
  await Promise.all(chosen.filter(item=>item.association==='observed-candidate'&&!item.capture).map(async item=>{
   const confirmation=await askWorker('observed-source-confirm',{tabId,frameId:item.frameId,documentId:item.documentId,url:item.url});
   if(confirmation.kind!==item.kind||confirmation.format!==item.format||confirmation.origin!==item.sourceOrigin)
    throw Error('A fonte observada mudou de tipo ou origem. Atualize a lista.');
   item.mime=confirmation.mime;item.expectedBytes=confirmation.expectedBytes;
   item.mp4Direct=confirmation.kind==='video'&&confirmation.format==='direct'&&confirmation.mime==='video/mp4';
  }));
  await Promise.all(chosen.filter(item=>item.association==='player'&&!item.capture).map(async item=>{
   const confirmation=await askWorker('player-confirm',{tabId,documentId:item.documentId,player:item.player,url:item.url});
   item.mp4Direct=confirmation.mp4===true&&item.format==='direct';
   item.expectedBytes=confirmation.expectedBytes;
  }));
  for(const item of chosen.filter(i=>i.kind==='video'&&['hls','dash'].includes(i.format))){
   const options=await StreamTools.inspect(item.url,item.format);
   if(!options.length&&item.format==='hls'&&item.quality===undefined)continue;
   const eligible=options.filter(q=>q.width>500&&q.height>500);
   if(!eligible.length)throw Error('Nenhuma qualidade confirmada acima de 500 × 500 px.');
   if(item.quality!==undefined&&!eligible.some(q=>q.id===item.quality))throw Error('A qualidade selecionada saiu do manifesto. Atualize a lista.');
   item.quality??=eligible[0].id;
  }
 }
 if(captures.length){if(chosen.length!==1)throw Error('Baixe uma fonte temporária por vez.');await askWorker('web-capture-run',{tabId,frameId:captures[0].frameId,documentId:captures[0].documentId,player:captures[0].player,source:captures[0].source,outputFormat:$('video-format').value,destination});}
 else await askWorker(quick?'enqueue':'download',{items:chosen,skip:again?false:$('skip').checked,outputFormat:$('video-format').value,useNative:!quick&&$('use-native').checked,destination});
}
$('download').onclick=()=>action(()=>downloadMedia(selectedItems()));
$('download-as').onclick=()=>action(async()=>{
 const chosen=selectedItems();
 if(!chosen.length)throw Error('Selecione as mídias antes de escolher a pasta.');
 await refreshDestination();
 const destination=await chooseSaveDestination();
 if(destination)await downloadMedia(chosen,false,false,destination);
});
$('retry-publication').onclick=()=>action(()=>askWorker('destination-retry',{id:job?.lastPublicationId}));
$('download-pause').onclick=()=>action(()=>askWorker('pause'));$('cancel-download').onclick=()=>action(()=>askWorker('cancel'));$('clear-history').onclick=()=>action(async()=>{await askWorker('history-clear');fingerprint='';});
let canOpenFile=false;
chrome.permissions.contains({permissions:['downloads.open']}).then(value=>{canOpenFile=value;}).catch(()=>{});
$('show-download').onclick=()=>action(()=>showFile(job.lastDownloadId,job.lastSavedPath));
$('open-download').onclick=()=>{
 if(canOpenFile){
  action(()=>chrome.downloads.open(job.lastDownloadId));
  return;
 }
 chrome.permissions.request({permissions:['downloads.open']}).then(granted=>{
  canOpenFile=granted;
  report(granted?'Acesso liberado. Clique em Abrir arquivo.':'O acesso para abrir arquivos não foi concedido.');
 }).catch(report);
};
chrome.storage.local.get('downloadNotifications').then(settings=>{
 $('download-notifications').checked=settings.downloadNotifications===true;
});
$('download-notifications').onchange=event=>{
 const control=event.target;
 if(!control.checked){chrome.storage.local.set({downloadNotifications:false}).catch(report);return;}
 chrome.permissions.request({permissions:['notifications']}).then(granted=>{
  control.checked=granted;
  return chrome.storage.local.set({downloadNotifications:granted});
 }).catch(error=>{control.checked=false;report(error);});
};
for(const id of ['web-image-interface','web-image-filter','web-image-size','min-width','min-height'])
 $(id).addEventListener('change',persistHoverFilters);
chrome.storage.local.get(['webHoverOptions','webHoverDisabled']).then(settings=>{
 const filters=settings.webHoverOptions;
 if(filters){
  $('web-image-filter').checked=!!filters.minimum;
  const sizeIndex=imageSizes.indexOf(filters.minimum);
  if(sizeIndex>=0)$('web-image-size').value=sizeIndex;
  $('min-width').value=filters.minWidth||'';
  $('min-height').value=filters.minHeight||'';
  $('web-image-interface').checked=filters.includeInterface===true;
 }
 hoverDisabled=settings.webHoverDisabled||{};
 syncHoverSite(hoverHost);
 updateImageSize();
 renderGrid();
}).catch(report);
refreshDestination().catch(report);refreshTransfers();refresh();setInterval(()=>{refreshTransfers();refresh();},1500);
