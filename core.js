/* Funções puras compartilhadas entre a extensão e os testes. */
(function (root) {
  function absolute(raw, base) {
    try { if (typeof raw !== 'string' || !raw.trim()) return null; const u = new URL(raw, base); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
  }
  function candidates(srcset, base) {
    if (!srcset) return [];
    return srcset.split(',').map(part => {
      const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/);
      if (!match) return null;
      const url = absolute(match[1], base);
      return url ? {url, score: Number(match[2] || 1), unit: match[3] || 'x'} : null;
    }).filter(Boolean);
  }
  function bestSource(src, srcset, base) {
    const list = candidates(srcset, base);
    const widths = list.filter(x => x.unit === 'w');
    const chosen = (widths.length ? widths : list).sort((a,b) => b.score - a.score)[0];
    return chosen?.url || absolute(src, base);
  }
  function responsiveCandidates(srcset, base) {
    const urls = [];
    let rest = srcset || '';
    while ((rest = rest.replace(/^[,\t\n\f\r ]+/, ''))) {
      const token = rest.match(/^[^\t\n\f\r ]+/)[0];
      rest = rest.slice(token.length);
      const url = absolute(token.replace(/,+$/, ''), base);
      if (token.endsWith(',')) {
        if (url) urls.push(url);
        continue;
      }
      const separator = rest.indexOf(',');
      const descriptor = (separator < 0 ? rest : rest.slice(0, separator)).trim();
      rest = separator < 0 ? '' : rest.slice(separator + 1);
      if (url && (!descriptor || /^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor))) urls.push(url);
    }
    return urls;
  }
  function imageExtension(mime) {
    return ({
      'image/jpeg':'jpg','image/png':'png','image/apng':'png','image/webp':'webp','image/avif':'avif',
      'image/gif':'gif','image/svg+xml':'svg','image/bmp':'bmp','image/x-icon':'ico',
      'image/vnd.microsoft.icon':'ico','image/tiff':'tiff','image/jxl':'jxl'
    })[String(mime||'').split(';')[0].toLowerCase()];
  }
  function key(url) { try { const u = new URL(url); u.hash = ''; return u.href; } catch { return String(url); } }
  function clean(value, fallback = 'pagina') {
    const s = String(value || '').normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g,' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 70);
    return s || fallback;
  }
  function extension(item) {
    if (item.forceExtension) return item.forceExtension;
    try {
      const u = new URL(item.url);
      const m = u.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
      const format = m?.[1] || u.searchParams.get('format');
      if (format && /^(jpe?g|png|gif|webp|avif|mp4|m4v|webm|mov|ogv|mkv|mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|aiff?|wma)$/i.test(format)) return format.toLowerCase();
    } catch {}
    if (item.kind === 'audio') {
      const mime = String(item.mime || '').split(';')[0].trim().toLowerCase();
      return ({
        'audio/mpeg':'mp3','audio/mp3':'mp3','audio/x-mpeg':'mp3',
        'audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac',
        'audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav','audio/vnd.wave':'wav',
        'audio/ogg':'ogg','application/ogg':'ogg','audio/opus':'opus',
        'audio/flac':'flac','audio/x-flac':'flac','audio/aiff':'aiff','audio/x-aiff':'aiff',
        'audio/webm':'webm','audio/x-ms-wma':'wma'
      })[mime] || 'bin';
    }
    return item.kind === 'video' ? 'mp4' : 'jpg';
  }
  function sourceFolder(host) {
    if (/(^|\.)instagram\.com$/i.test(host || '')) return 'Instagram';
    if (/(^|\.)(x\.com|twitter\.com)$/i.test(host || '')) return 'X.com';
    if (/(^|\.)reddit\.com$/i.test(host || '')) return 'Reddit';
    return 'Web geral';
  }
  function filenamePart(value, fallback, limit) {
    const safe = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, limit);
    return safe || fallback;
  }
  function resourceId(item) {
    let resource = '';
    for (const value of [item.url, item.postUrl]) {
      if (!absolute(value)) continue;
      const url = new URL(value);
      resource = url.hostname + url.pathname;
      break;
    }
    let hash = 2166136261;
    for (let index = 0; index < resource.length; index++) {
      hash = Math.imul(hash ^ resource.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function basename(item) {
    const site = sourceFolder(item.site);
    const domain = String(item.site || '').toLowerCase().replace(/^www\./, '');
    const host = filenamePart(domain, 'pagina', 38);
    const profile = /^[A-Za-z0-9_.-]{1,64}$/.test(item.page || '') ? item.page : '';
    const owner = site === 'Web geral' ? host : filenamePart(profile, host, 38);
    const identity = /^[A-Za-z0-9_-]{1,40}$/.test(item.post || '') ? item.post : resourceId(item);
    const position = Number.isSafeInteger(item.mediaPosition) && item.mediaPosition > 0 && item.mediaPosition <= 99999 ? '-' + item.mediaPosition : '';
    const ext = filenamePart(extension(item), 'jpg', 6).toLowerCase();
    const kind = item.kind === 'image' ? (ext === 'gif' ? 'gif' : 'foto') : item.kind === 'audio' ? 'audio' : 'video';
    return `${owner}-${kind}-${identity}${position}.${ext}`;
  }
  function filename(item) {
    return `Media Collector/${sourceFolder(item.site)}/${basename(item)}`;
  }
  function visible(item, filter) {
    if (filter.kind && filter.kind !== 'all' && item.kind !== filter.kind) return false;
    if ((filter.minWidth || filter.minHeight) && (!item.width || !item.height)) return false;
    return item.width >= (Number(filter.minWidth) || 0) && item.height >= (Number(filter.minHeight) || 0);
  }
  function webEligible(item, imageMin = 500) {
    if (item.kind === 'audio') return true;
    const minimum = item.kind === 'image' ? imageMin : 500;
    return (item.kind === 'image' || item.kind === 'video') &&
      Number(item.width) > minimum && Number(item.height) > minimum;
  }
  function isYouTubePreview(pageHost, source, context = '') {
    let mediaHost = '';
    try { mediaHost = new URL(source).hostname.toLowerCase(); } catch {}
    if (/(^|\.)ytimg\.com$/i.test(mediaHost) || mediaHost === 'img.youtube.com') return true;
    const evidence = `${source || ''} ${context || ''}`;
    const videoLink = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch|shorts|live)(?:[/?#]|$)|youtu\.be\/)/i.test(evidence);
    const playerCard = /\b(?:ytd-thumbnail|ytd-video-renderer|ytd-compact-video-renderer|ytd-rich-grid-media|yt-lockup(?:-thumbnail|-view-model)?|youtube[-_ ]video[-_ ](?:thumbnail|preview))\b/i.test(evidence);
    const onYouTube = /(^|\.)youtube\.com$/i.test(String(pageHost || '').toLowerCase());
    return videoLink || (playerCard && onYouTube);
  }
  root.MediaCore = {absolute, candidates, bestSource, responsiveCandidates, imageExtension, key, clean, extension, sourceFolder, basename, filename, visible, webEligible, isYouTubePreview};
  if (typeof module !== 'undefined') module.exports = root.MediaCore;
})(globalThis);
