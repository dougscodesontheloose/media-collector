(() => {
  const byId = id => document.getElementById(id);
  const analyze = byId('page-analyze');
  const download = byId('page-download');
  const pause = byId('page-pause');
  const cancel = byId('page-cancel');
  const status = byId('page-status');
  const progress = byId('page-progress');
  const formats = byId('page-formats');
  let port, analysisId, activeId, pageUrl, pageTabId, paused = false;

  async function currentTab() {
    if (Number.isInteger(tabId)) return chrome.tabs.get(tabId);
    const window = await chrome.windows.getLastFocused({windowTypes: ['normal']});
    const [tab] = await chrome.tabs.query({active: true, windowId: window.id});
    return tab;
  }

  function busy(value) {
    analyze.disabled = value;
    pause.disabled = !value;
    cancel.disabled = !value;
    download.disabled = value || !analysisId;
  }
  function connect() {
    if (port) return port;
    port = chrome.runtime.connectNative('com.media_collector.processor');
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      port = null;
      analysisId = null;
      paused = false;
      pause.textContent = 'Pausar';
      progress.value = 0;
      byId('page-formats-label').hidden = true;
      busy(false);
      status.textContent = error?.message?.includes('not found')
        ? 'Auxiliar não encontrado. Registre-o para este navegador e tente novamente.'
        : 'Auxiliar desconectado. Confira a instalação e tente novamente.';
    });
    port.onMessage.addListener(message => {
      if (message.id !== activeId) return;
      if (message.event === 'started') {
        progress.removeAttribute('value');
        status.textContent = 'Processando no computador…';
      } else if (message.event === 'progress') {
        status.textContent = message.phase || 'Processando…';
        if (message.total > 0) progress.value = Math.min(100, message.completed / message.total * 100);
      } else if (message.event === 'ack' && message.accepted) {
        if (message.action === 'pause') status.textContent = 'Pausado.';
        if (message.action === 'resume') status.textContent = 'Processando no computador…';
        if (message.action === 'cancel') status.textContent = 'Cancelando…';
      } else if (message.event === 'page-formats') {
        analysisId = message.id;
        paused = false;
        pause.textContent = 'Pausar';
        formats.replaceChildren();
        for (const format of message.formats) {
          const option = document.createElement('option');
          option.value = format.id;
          option.textContent = `${format.audioOnly ? 'Áudio' : `${format.width} × ${format.height}`} · ${format.ext}${format.audio && !format.audioOnly ? ' · com áudio' : ''}`;
          formats.append(option);
        }
        byId('page-formats-label').hidden = false;
        progress.value = 100;
        busy(false);
        status.textContent = `${message.formats.length} qualidade(s) encontradas.`;
      } else if (['done', 'error', 'cancelled'].includes(message.event)) {
        paused = false;
        pause.textContent = 'Pausar';
        progress.value = message.event === 'done' ? 100 : 0;
        status.textContent = message.event === 'done' ? `Salvo em ${message.filename}` : message.event === 'cancelled' ? 'Operação cancelada.' : message.error;
        busy(false);
      }
    });
    return port;
  }
  analyze.onclick = async () => {
    busy(true);
    try {
      const tab = await currentTab();
      if (!tab?.url || !/^https?:/i.test(tab.url)) throw Error('Abra uma página para analisar.');
      pageTabId = tab.id;
      pageUrl = tab.url;
      paused = false;
      pause.textContent = 'Pausar';
      analysisId = null;
      byId('page-formats-label').hidden = true;
      activeId = crypto.randomUUID();
      busy(true);
      connect().postMessage({action: 'page-analyze', id: activeId, url: pageUrl, audioOnly: ['mp3', 'm4a'].includes(byId('video-format').value)});
    } catch (error) { busy(false); status.textContent = error.message; }
  };
  download.onclick = async () => {
    busy(true);
    try {
      const tab = await currentTab();
      if (tab?.id !== pageTabId || tab?.url !== pageUrl) throw Error('A página mudou. Analise a aba atual novamente.');
      const output = byId('video-format').value;
      if (!['mp4', 'webm', 'mp3', 'm4a'].includes(output)) throw Error('Escolha MP4, WebM, MP3 ou M4A para o auxiliar.');
      activeId = crypto.randomUUID();
      busy(true);
      const site=new URL(pageUrl).hostname;
      const kind=['mp3','m4a'].includes(output)?'audio':'video';
      const filename=MediaCore.basename({url:pageUrl,site,kind,forceExtension:output});
      connect().postMessage({action:'page-download',id:activeId,analysisId,url:pageUrl,formatId:formats.value,
        output,filename,category:MediaCore.sourceFolder(site)});
    } catch (error) { busy(false); status.textContent = error.message; }
  };
  pause.onclick = () => {
    paused = !paused;
    pause.textContent = paused ? 'Retomar' : 'Pausar';
    port?.postMessage({action: paused ? 'pause' : 'resume', id: activeId});
  };
  cancel.onclick = () => port?.postMessage({action: 'cancel', id: activeId});
})();
