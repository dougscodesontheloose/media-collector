/* Adaptadores preservam a coleta genérica quando o site muda. */
(function (root) {
  const adapters = [
    {id:'instagram', matches: host => /(^|\.)instagram\.com$/i.test(host), label:'Instagram', transform: url => url},
    {id:'x', matches: host => /(^|\.)(x\.com|twitter\.com)$/i.test(host), label:'X', transform: url => {
      try { const u = new URL(url); if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) u.searchParams.set('name','orig'); return u.href; } catch { return url; }
    }},
    {id:'reddit', matches: host => /(^|\.)reddit\.com$/i.test(host), label:'Reddit', transform: url => url},
    {id:'generic', matches: () => true, label:'Site', transform: url => url}
  ];
  root.MediaAdapters = { select: host => adapters.find(a => a.matches(host)) };
})(globalThis);
