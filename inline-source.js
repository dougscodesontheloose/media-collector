(() => {
 if (globalThis.MediaInline) return;

 const retry = 'A mídia exibida mudou. Passe o mouse novamente e tente baixar.';
 function errorMessage(error, fallback) {
  const message = error?.message || '';
  return /extension context invalidated|receiving end does not exist/i.test(message)
   ? 'A extensão foi atualizada. Recarregue esta aba para reativar o botão.'
   : message || fallback;
 }

 function sourceOf(video) {
  if (!video) return '';
  if (video.mediaKeys) throw Error('Este vídeo usa proteção de mídia.');
  return video.currentSrc || video.getAttribute('src') || video.querySelector('source[src]')?.src || '';
 }

 async function confirm(item, current, {observed = false, manifest = '', sourceType = ''} = {}) {
  if (!current()) throw Error(retry);
  const response = await chrome.runtime.sendMessage({
   target: 'worker',
   action: 'inline-source-confirm',
   url: item.url,
   observed,
   playerBound: !observed
  });
  if (response?.error) throw Error(response.error);
  if (!current()) throw Error(retry);

  const format = manifest || response?.format || item.format;
  const declaredMP4 = sourceType.split(';')[0].trim().toLowerCase() === 'video/mp4';
  return {
   ...item,
   format,
   mp4Direct: format === 'direct' && (response?.mp4 === true || declaredMP4),
   expectedBytes: response?.expectedBytes ?? item.expectedBytes
  };
 }

 globalThis.MediaInline = {confirm, errorMessage, sourceOf, retry};
})();
