/* Initial Safari macOS compatibility layer. */
(() => {
  const api = globalThis.chrome || globalThis.browser;
  if (!api) throw new Error('A API de extensões do Safari não está disponível.');
  if (!globalThis.chrome) globalThis.chrome = api;

  const listeners = new Set();
  const entries = new Map();
  let nextId = 1;
  const event = {
    addListener(listener) { if (typeof listener === 'function') listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    hasListener(listener) { return listeners.has(listener); }
  };
  const emit = delta => queueMicrotask(() => {
    for (const listener of listeners) {
      try { listener(delta); } catch (error) { console.error(error); }
    }
  });

  if (!api.downloads) {
    api.downloads = {
      onChanged: event,
      onDeterminingFilename: {addListener() {}, removeListener() {}, hasListener() { return false; }},
      async download(options = {}) {
        if (options.saveAs) throw new Error('Salvar em… ainda não está disponível no Safari. Use Downloads.');
        const id = nextId++;
        const entry = {
          id, url: options.url, filename: '', state: 'in_progress', error: null,
          bytesReceived: 0, fileSize: -1, mime: '', byExtensionId: api.runtime.id
        };
        entries.set(id, entry);
        api.runtime.sendNativeMessage('com.media_collector.processor', {
          action: 'safari-download', id: String(id), url: options.url,
          filename: options.filename || 'Media Collector/midia'
        }).then(reply => {
          if (reply?.event !== 'done') throw new Error(reply?.error || 'O aplicativo do Safari não concluiu o download.');
          Object.assign(entry, {
            state: 'complete', filename: reply.filename || '',
            bytesReceived: Number(reply.size) || 0, fileSize: Number(reply.size) || 0,
            mime: reply.mime || ''
          });
          emit({id, state: {current: 'complete'}});
        }).catch(error => {
          entry.state = 'interrupted'; entry.error = error?.message || String(error);
          emit({id, state: {current: 'interrupted'}, error: {current: entry.error}});
        });
        return id;
      },
      async search(query = {}) {
        if (Number.isInteger(query.id)) return entries.has(query.id) ? [{...entries.get(query.id)}] : [];
        return [...entries.values()].map(value => ({...value}));
      },
      async cancel(id) {
        const entry = entries.get(id);
        if (!entry || entry.state !== 'in_progress') return;
        await api.runtime.sendNativeMessage('com.media_collector.processor', {action: 'safari-cancel', id: String(id)}).catch(() => {});
        entry.state = 'interrupted'; entry.error = 'USER_CANCELED';
        emit({id, state: {current: 'interrupted'}, error: {current: entry.error}});
      },
      async pause() { throw new Error('Pausa ainda não está disponível no Safari.'); },
      async resume() { throw new Error('Retomada ainda não está disponível no Safari.'); },
      async removeFile() {},
      async show(id) {
        const filename = entries.get(id)?.filename;
        if (filename) await api.runtime.sendNativeMessage('com.media_collector.processor', {action: 'safari-reveal', filename});
      },
      async open(id) {
        const filename = entries.get(id)?.filename;
        if (filename) await api.runtime.sendNativeMessage('com.media_collector.processor', {action: 'safari-open', filename});
      }
    };
  }

  if (!api.offscreen) {
    api.offscreen = {
      async hasDocument() { return false; },
      async createDocument() {
        throw new Error('O processamento HLS/DASH ainda não está disponível no Safari.');
      }
    };
  }
})();
