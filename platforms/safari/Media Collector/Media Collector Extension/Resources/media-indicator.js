/* Updates the toolbar without opening the panel. Only element and source counts leave the frame. */
(() => {
 if(globalThis.__mcMediaIndicator)return;
 globalThis.__mcMediaIndicator=true;
 let scheduled=false,last=-1;
 const events=new AbortController();
 function publish(){
  scheduled=false;
  if(!chrome.runtime?.id){observer.disconnect();events.abort();return;}
  const count=[...document.querySelectorAll('video,audio')].filter(media=>
   !media.mediaKeys&&(media.currentSrc||media.getAttribute('src')||media.querySelector('source[src]'))).length;
  if(count===last)return;
  last=count;
  chrome.runtime.sendMessage({target:'worker',action:'media-indicator',count}).catch(()=>{});
 }
 function schedule(){
  if(scheduled)return;
  scheduled=true;
  setTimeout(publish,180);
 }
 function hasMedia(node){return node.nodeType===1&&(node.matches('video,audio,source')||node.querySelector('video,audio,source'));}
 const observer=new MutationObserver(records=>{
  if(records.some(record=>record.type==='attributes'?hasMedia(record.target):
   [...record.addedNodes,...record.removedNodes].some(hasMedia)))schedule();
 });
 observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
 for(const event of ['loadedmetadata','emptied','encrypted']){
  document.addEventListener(event,schedule,{capture:true,signal:events.signal});
 }
 addEventListener('pageshow',()=>{last=-1;schedule();},{signal:events.signal});
 publish();
})();
