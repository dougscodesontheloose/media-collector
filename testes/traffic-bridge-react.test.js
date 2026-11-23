const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const tweetId='123';
const poster='https://pbs.twimg.com/amplify_video_thumb/123/img/poster.jpg';
const reactPoster='https://pbs.twimg.com/media/HXk_T7cWcAAEUL9';
const fragment='https://video.twimg.com/amplify_video/123/vid/avc1/0/0/720x1280/init.mp4';
const playlist='https://video.twimg.com/amplify_video/123/pl/avc1/720x1280/index.m3u8';

async function queryBridge(variants,durationMillis=12000){
 const listeners=new Map(),posted=[];
 const media={type:'video',media_url_https:poster,video_info:{duration_millis:durationMillis,variants}};
 const body={data:{tweet_results:{result:{rest_id:tweetId,legacy:{id_str:tweetId,extended_entities:{media:[media]}}}}}};
 const response={ok:true,url:'https://x.com/i/api/graphql/hash/TweetResultByRestId',headers:{get:()=>null},
  clone(){return{text:async()=>JSON.stringify(body)}}};
 class FakeXHR{open(){}send(){}addEventListener(){}}
 const window={addEventListener(type,fn){listeners.set(type,fn);},fetch:async()=>response,
  postMessage(message){posted.push(message);}};
 const context=vm.createContext({window,document:{querySelector:()=>null},XMLHttpRequest:FakeXHR,location:{origin:'https://x.com',pathname:'/home'},URL,Date,Map,Set,WeakSet,Array,Object,String,Number,RegExp,JSON});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','traffic-bridge.js'),'utf8'),context);
 await window.fetch(response.url);
 await new Promise(resolve=>setTimeout(resolve,0));
 listeners.get('message')({source:window,origin:'https://x.com',data:{channel:'__mc_traffic_query',id:'aa-1',tweetId,
  posters:[poster]}});
 return posted.at(-1)?.media||null;
}

async function queryReactPlayer({contentTweetId=tweetId,playerPoster=reactPoster,requestedPoster=playerPoster,src=playlist,progressiveSrc=fragment,extraProps={}}={}){
 const listeners=new Map(),posted=[];
 const fiber={memoizedProps:{...extraProps,content:{tweetId:contentTweetId,contentId:'987',durationMs:100714,
  contentType:'video',mediaAssetUrl:src},poster:playerPoster,src,
  progressiveSrc,downloadUrl:null},return:null};
 const article={attrs:{'data-mc-q':'beef-1234'},querySelectorAll:()=>[],
  getAttribute(name){return this.attrs[name]||null;},['__reactFiber$fixture']:fiber};
 const window={addEventListener(type,fn){listeners.set(type,fn);},fetch:async()=>({}),postMessage(message){posted.push(message);}};
 class FakeXHR{open(){}send(){}addEventListener(){}}
 const document={querySelector(selector){return selector.includes('data-mc-q="beef-1234"')?article:null;}};
 const context=vm.createContext({window,document,XMLHttpRequest:FakeXHR,location:{origin:'https://x.com',pathname:'/home'},URL,Date,Map,Set,WeakSet,Array,Object,String,Number,RegExp,JSON});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','traffic-bridge.js'),'utf8'),context);
 listeners.get('message')({source:window,origin:'https://x.com',data:{channel:'__mc_traffic_query',id:'beef-1234',tweetId,
  posters:[requestedPoster]}});
 return posted.at(-1)?.media||null;
}

test('X traffic bridge prefere HLS quando a variante MP4 tem o padrão ambíguo de fragmento MSE',async()=>{
 const media=await queryBridge([
  {content_type:'video/mp4',url:fragment,bitrate:1000000},
  {content_type:'application/x-mpegURL',url:playlist,bitrate:0}
 ]);
 assert.ok(media);
 assert.equal(media.format,'hls');
 assert.equal(media.url,playlist);
 assert.equal(media.poster,'/amplify_video_thumb/123/img/poster');
});

test('X traffic bridge não promove fragmento MP4 ambíguo a arquivo completo',async()=>{
 const media=await queryBridge([{content_type:'video/mp4',url:fragment,bitrate:1000000}]);
 assert.equal(media,null);
});

test('X traffic bridge obtém a fonte do player React e associa vídeo, post e poster',async()=>{
 const media=await queryReactPlayer();
 assert.ok(media);
 assert.equal(media.tweetId,tweetId);
 assert.equal(media.poster,'/media/HXk_T7cWcAAEUL9');
 assert.equal(media.format,'hls');
 assert.equal(media.url,playlist);
 assert.equal(media.duration,100.714);
});

test('X traffic bridge não associa props React de outro post ou poster',async()=>{
 assert.equal(await queryReactPlayer({contentTweetId:'456'}),null);
 assert.equal(await queryReactPlayer({requestedPoster:'https://pbs.twimg.com/media/other-poster'}),null);
});

test('X bridge ignora HLS de faixa de áudio e permite MP4 ambíguo com tamanho completo observado',async()=>{
 const complete='https://video.twimg.com/amplify_video/123/vid/avc1/0/0/720x1280/complete.mp4';
 const media=await queryBridge([
  {content_type:'application/x-mpegURL',url:'https://video.twimg.com/amplify_video/123/pl/mp4a/128000/index.m3u8'},
  {content_type:'video/mp4',url:complete,expectedBytes:800000,bitrate:900000}
 ]);
 assert.equal(media?.format,'direct');
 assert.equal(media?.url,complete);
 assert.equal(media?.expectedBytes,800000);
});

test('X bridge descarta playlist de áudio quando nenhuma fonte de vídeo está disponível',async()=>{
 const media=await queryBridge([
  {content_type:'application/x-mpegURL',url:'https://video.twimg.com/amplify_video/123/pl/mp4a/128000/index.m3u8'}
 ]);
 assert.equal(media,null);
});

test('X bridge não promove tamanho observado sem duração de referência a MP4 completo',async()=>{
 const media=await queryBridge([
  {content_type:'video/mp4',url:'https://video.twimg.com/amplify_video/123/vid/avc1/0/0/720x1280/complete.mp4',expectedBytes:800000}
 ],null);
 assert.equal(media,null);
});

test('X bridge atualiza URL em cache com as props atuais do mesmo post e poster',async()=>{
 const listeners=new Map(),posted=[];
 const oldUrl='https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/old.mp4';
 const currentUrl='https://video.twimg.com/ext_tw_video/123/pl/current.m3u8';
 const tweet={rest_id:tweetId,legacy:{id_str:tweetId,extended_entities:{media:[{
  type:'video',media_url_https:reactPoster,video_info:{duration_millis:12000,variants:[
   {content_type:'video/mp4',url:oldUrl,bitrate:500000}
  ]}
 }]}}};
 const body={data:{tweet_results:{result:tweet}}};
 const response={ok:true,url:'https://x.com/i/api/graphql/hash/TweetResultByRestId',headers:{get:()=>null},clone(){return{text:async()=>JSON.stringify(body)}}};
 const fiber={memoizedProps:{content:{tweetId,contentId:'987',durationMs:12000,contentType:'video',mediaAssetUrl:currentUrl},poster:reactPoster,src:currentUrl},return:null};
 const article={querySelectorAll:()=>[],getAttribute:()=> 'beef-1234',['__reactFiber$fixture']:fiber};
 class FakeXHR{open(){}send(){}addEventListener(){}}
 const window={addEventListener(type,fn){listeners.set(type,fn);},fetch:async()=>response,postMessage(message){posted.push(message);}};
 const document={querySelector(selector){return selector.includes('data-mc-q="beef-1234"')?article:null;}};
 const context=vm.createContext({window,document,XMLHttpRequest:FakeXHR,location:{origin:'https://x.com',pathname:'/home'},URL,Date,Map,Set,WeakSet,Array,Object,String,Number,RegExp,JSON});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','traffic-bridge.js'),'utf8'),context);
 await window.fetch(response.url);
 await new Promise(resolve=>setTimeout(resolve,0));
 listeners.get('message')({source:window,origin:'https://x.com',data:{channel:'__mc_traffic_query',id:'beef-1234',tweetId,posters:[reactPoster]}});
 assert.equal(posted.at(-1)?.media?.url,currentUrl);
 assert.equal(posted.at(-1)?.media?.format,'hls');
});

test('X bridge não percorre em profundidade objetos arbitrários das props React',async()=>{
 const unrelated={rest_id:tweetId,legacy:{id_str:tweetId,extended_entities:{media:[{
  type:'video',media_url_https:reactPoster,video_info:{variants:[
   {content_type:'video/mp4',url:'https://video.twimg.com/ext_tw_video/123/vid/720x1280/unrelated.mp4'}
  ]}}
 ]}}};
 const media=await queryReactPlayer({src:'',progressiveSrc:'',requestedPoster:reactPoster,
  contentTweetId:'456',extraProps:{unrelated:{deep:{tweet:unrelated}}}});
 assert.equal(media,null);
});
