const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','traffic-bridge.js'),'utf8');
function harness(pathname='/home'){
 const listeners=new Map(),sent=[];let body='',now=Date.now(),article=null;
 const origin='https://x.com';
 const window={
  fetch:async resource=>({ok:true,url:String(resource),headers:{get:name=>name==='content-length'?String(body.length):null},clone(){return{async text(){return body;}}}}),
  addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
  removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(current=>current!==fn));},
  postMessage(data,targetOrigin){sent.push(data);if(targetOrigin===origin)for(const fn of listeners.get('message')||[])fn({source:window,origin,data});}
 };
 function FakeXHR(){this.listeners={};this.status=200;}
 FakeXHR.prototype.open=function(_method,url){this.responseURL=url;};
 FakeXHR.prototype.addEventListener=function(type,fn){(this.listeners[type]||=[]).push(fn);};
 FakeXHR.prototype.send=function(){for(const fn of this.listeners.load||[])fn();};
 const context=vm.createContext({window,location:{origin,pathname},document:{querySelector:()=>article},URL,XMLHttpRequest:FakeXHR,Date:{now:()=>now},Map,WeakMap,WeakSet,Set,Array,Object,Number,String,RegExp,JSON,Math});
 context.globalThis=context;
 vm.runInContext(source,context,{filename:'traffic-bridge.js'});
 return{window,origin,sent,listeners,FakeXHR,setBody(value){body=value;},setArticle(value){article=value;},advanceTime(ms){now+=ms;}};
}
function response(tweetId='2046009031613907029'){
 const poster='https://pbs.twimg.com/ext_tw_video_thumb/2046009031613907029/pu/img/abc.jpg';
 return {
  data:{
   tweet:{
    rest_id:tweetId,
    legacy:{
     extended_entities:{media:[{
      type:'video',media_url_https:poster,
      video_info:{duration_millis:53070,variants:[
       {content_type:'application/x-mpegURL',url:'https://video.twimg.com/ext_tw_video/1/pu/pl/playlist.m3u8?tag=12'},
       {content_type:'video/mp4',bitrate:832000,url:'https://video.twimg.com/ext_tw_video/1/pu/vid/480x854/low.mp4?tag=12'},
       {content_type:'video/mp4',bitrate:2176000,url:'https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/high.mp4?tag=12'}
      ]}
     }]}
    }
   }
  }
 };
}
async function harvest(h,data=response(),pathname='/i/api/graphql/hash/HomeTimeline'){
 const json=JSON.stringify(data);
 h.setBody(json);
 await h.window.fetch(h.origin+pathname);
 await new Promise(resolve=>setImmediate(resolve));
}
function query(h,tweetId='2046009031613907029',poster='https://pbs.twimg.com/ext_tw_video_thumb/2046009031613907029/pu/img/abc.jpg'){
 const id='abcd-1234';
 h.window.postMessage({channel:'__mc_traffic_query',id,tweetId,posters:[poster]},h.origin);
 return h.sent.findLast(message=>message.channel==='__mc_traffic_query_response'&&message.id===id)?.media||null;
}

test('X bridge escolhe o MP4 de maior bitrate pré-play e preserva post, poster e duração',async()=>{
 const h=harness();await harvest(h);
 const media=query(h);
 assert.equal(media.tweetId,'2046009031613907029');
 assert.equal(media.poster,'/ext_tw_video_thumb/2046009031613907029/pu/img/abc');
 assert.equal(media.url,'https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/high.mp4?tag=12');
 assert.equal(media.format,'direct');
 assert.equal(media.duration,53.07);
});

test('X bridge observa resposta XHR JSON e não exige iniciar a reprodução',()=>{
 const h=harness(),xhr=new h.FakeXHR();
 xhr.responseType='json';xhr.response=response();
 xhr.open('GET',h.origin+'/i/api/graphql/hash/TweetDetail');xhr.send();
 const media=query(h);
 assert.equal(media?.format,'direct');
 assert.match(media?.url||'',/720x1280\/high\.mp4/);
});

test('X bridge associa a variante ao poster do vídeo correto em publicação com múltiplos vídeos',async()=>{
 const h=harness();
 const data=response('2046009031613907029');
 const media=data.data.tweet.legacy.extended_entities.media;
 media.push({type:'animated_gif',media_url_https:'https://pbs.twimg.com/tweet_video_thumb/second/pu/img/xyz.png',video_info:{variants:[
  {content_type:'video/mp4',bitrate:512000,url:'https://video.twimg.com/tweet_video/second/pu/vid/480x270/clip.mp4'}
 ]}});
 await harvest(h,data);
 const found=query(h,'2046009031613907029','https://pbs.twimg.com/tweet_video_thumb/second/pu/img/xyz.png');
 assert.equal(found?.expectedAudio,false);
 assert.equal(found?.url,'https://video.twimg.com/tweet_video/second/pu/vid/480x270/clip.mp4');
 assert.equal(query(h,'2046009031613907029','https://pbs.twimg.com/media/unrelated.jpg'),null);
});

test('X bridge preserva variantes do mesmo post quando as respostas chegam em partes',async()=>{
 const h=harness();await harvest(h);
 const partial=response();
 partial.data.tweet.legacy.extended_entities.media[0].media_url_https='https://pbs.twimg.com/ext_tw_video_thumb/second/pu/img/xyz.jpg';
 partial.data.tweet.legacy.extended_entities.media[0].video_info.variants=[
  {content_type:'video/mp4',bitrate:400000,url:'https://video.twimg.com/ext_tw_video/second/pu/vid/480x854/second.mp4'}
 ];
 await harvest(h,partial);
 const original=query(h,'2046009031613907029','https://pbs.twimg.com/ext_tw_video_thumb/2046009031613907029/pu/img/abc.jpg');
 const later=query(h,'2046009031613907029','https://pbs.twimg.com/ext_tw_video_thumb/second/pu/img/xyz.jpg');
 assert.match(original?.url||'',/720x1280\/high\.mp4/);
 assert.match(later?.url||'',/second\.mp4/);
});

test('X bridge volta às props React quando o registro de rede expirou',async()=>{
 const h=harness();await harvest(h);
 assert.match(query(h)?.url||'',/720x1280\/high\.mp4/);
 const article={querySelectorAll:()=>[],getAttribute:()=> 'abcd-1234',
  ['__reactFiber$fixture']:{memoizedProps:response()}};
 h.setArticle(article);h.advanceTime(11*60*1000);
 const recovered=query(h);
 assert.equal(recovered?.tweetId,'2046009031613907029');
 assert.match(recovered?.url||'',/720x1280\/high\.mp4/);
});

test('X bridge continua até a fibra do player quando a fibra do article não tem o tweet',async()=>{
 const h=harness();await harvest(h);query(h);h.advanceTime(11*60*1000);
 const article={querySelectorAll:()=>[player],['__reactFiber$article']:{memoizedProps:{}}};
 const player={['__reactFiber$player']:{memoizedProps:response()}};
 h.setArticle(article);
 const recovered=query(h);
 assert.equal(recovered?.tweetId,'2046009031613907029');
 assert.match(recovered?.url||'',/720x1280\/high\.mp4/);
});

test('X bridge ignora poster já armazenado e percorre fibras parciais até o poster pedido',async()=>{
 const h=harness();await harvest(h);
 const id='2046009031613907029';
 const partial=response(id);
 const media=partial.data.tweet.legacy.extended_entities.media[0];
 media.media_url_https='https://pbs.twimg.com/ext_tw_video_thumb/second/pu/img/xyz.jpg';
 media.video_info.variants=[{content_type:'video/mp4',bitrate:512000,
  url:'https://video.twimg.com/ext_tw_video/second/pu/vid/480x854/second.mp4'}];
 const articleFiber={memoizedProps:response(id)};
 const playerFiber={memoizedProps:partial};
 const player={['__reactFiber$player']:playerFiber};
 const article={querySelectorAll:()=>[player],getAttribute:()=> 'abcd-1234',
  ['__reactFiber$article']:articleFiber};
 h.setArticle(article);
 const recovered=query(h,id,'https://pbs.twimg.com/ext_tw_video_thumb/second/pu/img/xyz.jpg');
 assert.equal(recovered?.poster,'/ext_tw_video_thumb/second/pu/img/xyz');
 assert.equal(recovered?.url,'https://video.twimg.com/ext_tw_video/second/pu/vid/480x854/second.mp4');
});

test('X bridge sem poster examina todas as fibras e recusa múltiplas variantes ambíguas',async()=>{
 const h=harness();await harvest(h);
 const id='2046009031613907029';
 const partial=response(id);
 const media=partial.data.tweet.legacy.extended_entities.media[0];
 media.media_url_https='https://pbs.twimg.com/ext_tw_video_thumb/second/pu/img/xyz.jpg';
 media.video_info.variants=[{content_type:'video/mp4',bitrate:512000,
  url:'https://video.twimg.com/ext_tw_video/second/pu/vid/480x854/second.mp4'}];
 const player={['__reactFiber$player']:{memoizedProps:partial}};
 const article={querySelectorAll:()=>[player],getAttribute:()=> 'abcd-1234',
  ['__reactFiber$article']:{memoizedProps:response(id)}};
 h.setArticle(article);
 assert.equal(query(h,id,''),null,'sem poster, fontes múltiplas não podem ser atribuídas arbitrariamente');
});

test('X bridge ignora endpoints fora da lista, rotas privadas e variantes com intervalos',async()=>{
 const h=harness();
 await harvest(h,response(),'https://x.com/i/api/graphql/hash/UnknownOperation');
 assert.equal(query(h),null);
 const privateRoute=harness('/messages');await harvest(privateRoute);
 assert.equal(query(privateRoute),null);
 const invalid=response();
 invalid.data.tweet.legacy.extended_entities.media[0].video_info.variants=[
  {content_type:'video/mp4',bitrate:9999999,url:'https://video.twimg.com/ext_tw_video/1/vid/file.mp4?range=0-1'},
  {content_type:'video/mp4',bitrate:999999,url:'https://video.twimg.com.evil.test/file.mp4'}
 ];
 const restricted=harness();await harvest(restricted,invalid);
 assert.equal(query(restricted),null);
});
