/* Extracts video variants from responses the X page already received. */
(() => {
 if (globalThis.__mcTrafficBridge) return;
 globalThis.__mcTrafficBridge = true;
 const records = new Map();
 const allowedOperation = /^(?:Home(?:Latest)?Timeline|TweetDetail|TweetResultByRestId|User(?:Tweets(?:AndReplies)?|Media|Likes)|SearchTimeline|ListLatestTweetsTimeline|CommunityTweetsTimeline|Bookmarks)$/;
 const maxRecords = 250;
 const lifetime = 10 * 60 * 1000;

 function onPrivateRoute() {
  return /^\/(?:messages|direct|i\/chat)(?:\/|$)/i.test(location.pathname);
 }

 function isMediaResponse(raw) {
  if(onPrivateRoute())return false;
  try {
   const url = new URL(raw, location.origin);
   if (url.protocol !== 'https:' || !/^(?:api\.|www\.)?(?:x|twitter)\.com$/i.test(url.hostname)) return false;
   const graphql = /^\/(?:i\/api\/)?graphql\/[^/]+\/([^/]+)\/?$/.exec(url.pathname);
   if (graphql) return allowedOperation.test(graphql[1]);
   return /^\/(?:i\/api\/)?(?:2\/timeline\/(?:home|home_latest|profile|conversation)\/|1\.1\/statuses\/show\.json$)/.test(url.pathname);
  } catch { return false; }
 }

 function posterKey(raw) {
  try {
   const url = new URL(raw);
   if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com') return '';
   return url.pathname.replace(/\.(?:jpe?g|png|webp|gif)$/i, '');
  } catch { return ''; }
 }

 function variant(raw) {
  try {
   const url = new URL(raw.url);
   if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com' ||
       url.username || url.password || url.port ||
       [...url.searchParams.keys()].some(key => /^(?:range|bytestart|byteend)$/i.test(key))) return null;
   const mime = String(raw.content_type || '').toLowerCase();
   const format = mime === 'video/mp4' && /\.mp4$/i.test(url.pathname) ? 'direct' :
    /mpegurl/.test(mime) && /\.m3u8$/i.test(url.pathname) ? 'hls' : null;
   return format ? {url:url.href, format, bitrate:Number(raw.bitrate)||0} : null;
  } catch { return null; }
 }

 function harvest(data, onlyTweet = '') {
  const stack = [data];
  const seen = new WeakSet();
  let remaining = 20000;
  while (stack.length && remaining-- > 0) {
   const node = stack.pop();
   if (!node || typeof node !== 'object' || seen.has(node)) continue;
   seen.add(node);
   const owner = node.legacy || node;
   const tweetId = String(node.rest_id || owner.id_str || '');
   if (/^\d+$/.test(tweetId) && (!onlyTweet || tweetId === onlyTweet) &&
       Array.isArray(owner.extended_entities?.media)) {
    const found = new Map();
    for (const media of owner.extended_entities.media.slice(0, 8)) {
     if (!['video','animated_gif'].includes(media.type) || !Array.isArray(media.video_info?.variants)) continue;
     const poster = posterKey(media.media_url_https || media.media_url);
     if (!poster) continue;
     const variants = media.video_info.variants.slice(0, 24).map(variant).filter(Boolean);
     const choice = variants.filter(v=>v.format==='direct').sort((a,b)=>b.bitrate-a.bitrate)[0] ||
       variants.find(v=>v.format==='hls');
     if (!choice) continue;
     const ms = media.video_info.duration_millis;
     found.set(poster,{tweetId,poster,url:choice.url,format:choice.format,
      duration:Number.isFinite(ms)&&ms>0?ms/1000:null,
      expectedAudio:media.type==='animated_gif'?false:null});
    }
    if (found.size) {
     const previous=records.get(tweetId);
     const merged=previous&&previous.expires>Date.now()?new Map(previous.found):new Map();
     for(const [poster,media] of found)merged.set(poster,media);
     records.delete(tweetId);
     records.set(tweetId,{found:merged,expires:Date.now()+lifetime});
     if(records.size>maxRecords)records.delete(records.keys().next().value);
    }
   }
   for (const child of Object.values(node)) {
    if (child && typeof child==='object' && stack.length<20000)stack.push(child);
   }
  }
 }

 function readTweet(tweetId, posters) {
  const entry = records.get(tweetId);
  if (!entry || entry.expires<Date.now()) {records.delete(tweetId);return null;}
  const matches = [...new Set(posters.map(posterKey).filter(Boolean))]
    .flatMap(poster=>entry.found.has(poster)?[entry.found.get(poster)]:[]);
  if (matches.length===1)return matches[0];
  return !posters.some(posterKey)&&entry.found.size===1?[...entry.found.values()][0]:null;
 }

 function inspectArticle(id,tweetId,posters) {
  const article = document.querySelector('article[data-mc-q="'+id+'"]');
  const candidates = article ? [article, ...article.querySelectorAll('[data-testid="videoPlayer"],video')].slice(0,5):[];
  const hasRequestedPoster=posters.some(posterKey);
  for (const element of candidates) {
   const key = Object.keys(element).find(name=>name.startsWith('__reactFiber$'));
   let fiber = key && element[key];
   for (let depth=0;fiber && depth<6;depth++,fiber=fiber.return) {
    try {harvest(fiber.memoizedProps,tweetId);}catch{}
    // A cached record for another poster in this post is not enough to stop.
    // Keep walking fibers until the item requested by the caller is present.
    if(hasRequestedPoster&&readTweet(tweetId,posters))return;
   }
  }
 }

 const xhrUrls = new WeakMap();
 const open = XMLHttpRequest.prototype.open;
 const send = XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.open = function(method,url) {
  xhrUrls.set(this,url);
  return open.apply(this,arguments);
 };
 XMLHttpRequest.prototype.send = function() {
  if (isMediaResponse(xhrUrls.get(this))) this.addEventListener('load',()=>{
   if(this.status<200 || this.status>=300 || !isMediaResponse(this.responseURL))return;
   try {
    if(this.responseType==='json')harvest(this.response);
    else if((this.responseType==='' || this.responseType==='text') && this.responseText.length<=8*1024*1024)
     harvest(JSON.parse(this.responseText));
   } catch {}
  },{once:true});
  return send.apply(this,arguments);
 };

 const fetchPage = window.fetch;
 window.fetch = function(resource) {
  const pending = fetchPage.apply(this,arguments);
  const raw=typeof resource==='string'||resource instanceof URL?resource:resource?.url;
  if (isMediaResponse(raw)) pending.then(response=>{
   if(!response.ok||!isMediaResponse(response.url)||
      Number(response.headers.get('content-length'))>8*1024*1024)return;
   return response.clone().text().then(body=>{
    if(body.length<=8*1024*1024)harvest(JSON.parse(body));
   });
  }).catch(()=>{});
  return pending;
 };

 window.addEventListener('message',event=>{
  if(onPrivateRoute()||event.source!==window||event.origin!==location.origin)return;
  const query=event.data;
  if(query?.channel!=='__mc_traffic_query'||typeof query.id!=='string'||
     !/^[a-f0-9-]{1,36}$/i.test(query.id)||typeof query.tweetId!=='string'||
     !/^\d{1,32}$/.test(query.tweetId)||!Array.isArray(query.posters))return;
  const posters=query.posters.slice(0,10).filter(value=>typeof value==='string');
  const hasRequestedPoster=posters.some(posterKey);
  let media=hasRequestedPoster?readTweet(query.tweetId,posters):null;
  if(!media){inspectArticle(query.id,query.tweetId,posters);media=readTweet(query.tweetId,posters);}
  window.postMessage({channel:'__mc_traffic_query_response',id:query.id,media},location.origin);
 });
})();
