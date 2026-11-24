/* Safari does not support Manifest V3's world: "MAIN" key. */
(() => {
  const files = ['mse-observer.js'];
  if (/(^|\.)(x|twitter)\.com$/i.test(location.hostname)) files.push('traffic-bridge.js');
  const parent = document.documentElement || document.head;
  for (const file of files) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(file);
    script.async = false;
    script.dataset.mediaCollectorBridge = file;
    script.addEventListener('load', () => script.remove(), {once: true});
    script.addEventListener('error', () => script.remove(), {once: true});
    parent.append(script);
  }
})();
