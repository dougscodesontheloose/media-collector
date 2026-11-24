/* Navegação local por publicações do Instagram. Não usa APIs ou serviços externos. */
(() => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden'; };
  function matchPost(url) {
    try { const u=new URL(url,location.href); if (u.origin!==location.origin) return null; const m=u.pathname.match(/\/(?:p|reels?)\/([A-Za-z0-9_-]+)\/?$/); return m ? m[1] : null; } catch { return null; }
  }
  function profileUrl() { return /(^|\.)instagram\.com$/i.test(location.hostname) && /^\/[A-Za-z0-9._]+(?:\/reels)?\/?$/.test(location.pathname) && !/^(explore|reels|reel|p|accounts|direct|stories)$/i.test(location.pathname.split('/')[1]); }
  function dialog() { return [...document.querySelectorAll('[role="dialog"]')].find(visible) || null; }
  function links() {
    const scope = document.querySelector('main,[role="main"]') || document;
    const found=new Map();
    for (const a of scope.querySelectorAll('a[href]')) { const id=matchPost(a.href); if(id && a.querySelector('img') && !found.has(id)) found.set(id,a); }
    return found;
  }
  function nextButton(scope) {
    return [...scope.querySelectorAll('button[aria-label]')].find(b => /^(avançar|next|próximo|siguiente|suivant)$/i.test((b.getAttribute('aria-label')||'').trim()) && visible(b) && !b.disabled);
  }
  function images(scope) {
    return [...scope.querySelectorAll('img')].filter(img => {
      const r=img.getBoundingClientRect(), alt=(img.alt||'').toLowerCase();
      return r.width>=180 && r.height>=180 && !/foto do perfil|profile picture|profile photo|foto de perfil/.test(alt) && !!(img.currentSrc||img.src);
    });
  }
  function token(scope) {
    return location.href + '|' + images(scope).map(img=>{
      const r=img.getBoundingClientRect(); return `${img.currentSrc||img.src}:${Math.round(r.left)}:${Math.round(r.top)}`;
    }).join('|');
  }
  async function waitFor(check, ms, control) {
    const end=Date.now()+ms;
    while(Date.now()<end) { if(control.stopped()) return false; const v=check(); if(v) return v; await delay(150); }
    return false;
  }
  async function waitPause(control) { while(control.paused()&&!control.stopped()) await delay(250); return !control.stopped(); }
  async function closeModal(control) {
    const close=[...document.querySelectorAll('svg[aria-label],button[aria-label],[role="button"][aria-label]')].find(e => /^(fechar|close)$/i.test(e.getAttribute('aria-label')||'') && visible(e));
    if (close) (close.closest('button,[role="button"]') || close).click();
    else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    return !!await waitFor(()=>!dialog(),3500,control);
  }
  async function scanPost(anchor,id,control,save) {
    if(!anchor.isConnected || !await waitPause(control)) return {ok:false,reason:'Publicação saiu da tela antes de ser aberta.'};
    const isReel=/\/reels?\//.test(anchor.pathname);
    anchor.click();
    const modal=await waitFor(dialog,6500,control);
    if(!modal) return {ok:false,fatal:true,reason:'A publicação não abriu como janela; confira a sessão e a página.'};
    await waitFor(()=>images(modal).length>0 || modal.querySelector('video'),5000,control);
    await delay(700);
    let steps=0, problem='';
    const collected=new Set(); let videoIssue='';
    const mediaPosition=()=>steps||nextButton(modal)?steps+1:undefined;
    const saveVideos=async()=>{
      const postUrl=new URL(`/${isReel?'reel':'p'}/${id}/`,anchor.origin).href;
      const result=await control.saveVideo(modal,id,postUrl,isReel,mediaPosition());
      for(const key of result.keys) collected.add(key);
      if(result.issue) videoIssue=result.issue;
    };
    while(!control.stopped()) {
      if(!await waitPause(control)) break;
      if(!isReel && control.images) for(const img of images(modal)) { const key=save(img,id,mediaPosition()); if(key) collected.add(key); }
      if(control.videos) await saveVideos();
      const next=nextButton(modal);
      if(!next) break;
      if(steps>=30) { problem='Carrossel excedeu o limite de 30 avanços.'; break; }
      const before=token(modal); next.click();
      const changed=await waitFor(()=>token(modal)!==before || !nextButton(modal),3500,control);
      if(!changed) { problem='O carrossel não confirmou o avanço; imagens podem faltar.'; break; }
      steps++; await delay(1000);
    }
    if(!isReel && control.images) for(const img of images(modal)) { const key=save(img,id,mediaPosition()); if(key) collected.add(key); }
    if(control.videos && steps>0) await saveVideos();
    const closed=await closeModal(control);
    if(!closed && !control.stopped()) return {ok:false,fatal:true,reason:'Não foi possível fechar a publicação com segurança.'};
    if(control.stopped()) return {ok:false,reason:'Interrompida durante a publicação.'};
    if(!collected.size) return {ok:false,reason:videoIssue||'Nenhuma mídia identificada na publicação.'};
    return {ok:!problem&&!videoIssue,reason:problem||videoIssue,images:collected.size,steps};
  }
  async function run(control,save) {
    if(!profileUrl()) throw Error('Abra a grade de um perfil do Instagram antes de iniciar.');
    if(dialog()) throw Error('Feche a publicação aberta antes de começar a coleta do perfil.');
    const discovered=new Set(), visited=new Set(), pending=[];
    let noNew=0, rounds=0, reelsVisited=/\/reels\/?$/.test(location.pathname);
    control.update({phase:'running',mode:'profile',posts:0,discovered:0,pending:[],rounds:0,stopReason:''});
    while(!control.stopped()) {
      if(!await waitPause(control)) break;
      const found=links(); for(const id of found.keys()) discovered.add(id);
      control.update({discovered:discovered.size,rounds});
      for(const [id,anchor] of found) {
        if(visited.has(id)) continue;
        if(control.limit && visited.size>=control.limit) break;
        if(!await waitPause(control)) break;
        control.update({current:id});
        const current = links().get(id);
        const result=await scanPost(current || anchor,id,control,save);
        visited.add(id);
        if(!result.ok) pending.push({id,reason:result.reason});
        control.update({posts:visited.size,pending:[...pending],current:''});
        if(result.fatal) { control.update({fatal:result.reason}); break; }
        await delay(450);
      }
      if(control.fatal() || control.stopped() || (control.limit && visited.size>=control.limit)) break;
      const prior=discovered.size;
      window.scrollBy({top:Math.max(window.innerHeight*.85,500),behavior:'auto'});
      await delay(1500); rounds++;
      for(const id of links().keys()) discovered.add(id);
      noNew=discovered.size===prior?noNew+1:0;
      if(noNew>=5 || rounds>=1000) {
        if(control.videos&&!reelsVisited){
          reelsVisited=true; const user=control.username.toLowerCase();
          const reelTab=[...document.querySelectorAll('a[href]')].find(a=>{try {return new URL(a.href).pathname.toLowerCase()===`/${user}/reels/`;} catch{return false;}});
          if(reelTab){reelTab.click();const changed=await waitFor(()=>/\/reels\/?$/.test(location.pathname),6000,control);if(changed){noNew=0;rounds=0;window.scrollTo(0,0);await delay(1500);continue;}pending.push({id:'Reels',reason:'Não foi possível abrir a aba de Reels; resultado parcial.'});}
          else pending.push({id:'Reels',reason:'A aba de Reels não foi encontrada; resultado parcial.'});
          control.update({pending:[...pending]});
        }
        break;
      }
    }
    if(control.stopped()) return {phase:'cancelled',reason:'Interrompido pelo usuário; resultado parcial.',pending};
    if(control.fatal()) return {phase:'finished',reason:control.fatal()+' Resultado parcial.',pending};
    if(control.limit && visited.size>=control.limit) return {phase:'limited',reason:'Limite de publicações atingido; resultado pode ser parcial.',pending};
    return {phase:'finished',reason:'Sem novas publicações após a rolagem. O resultado pode ser parcial.',pending};
  }
  globalThis.ProfileCollector={run,matchPost,profileUrl};
})();
