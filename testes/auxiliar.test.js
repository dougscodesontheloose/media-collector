const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('fila encaminha faixas ao auxiliar e registra sucesso verificado', async () => {
 const db={},handlers={};let portHandler,disconnected=false,request;
 const event=name=>({addListener(fn){handlers[name]=fn;}});
 const port={onMessage:{addListener(fn){portHandler=fn;}},onDisconnect:{addListener(){}},
  postMessage(value){request=value;},disconnect(){disconnected=true;}};
 const chrome={
  webRequest:{onBeforeRequest:event('before'),onHeadersReceived:event('headers')},
  tabs:{onRemoved:event('remove'),onUpdated:event('update')},
  storage:{session:{async get(){return{};},async set(){},async remove(){}},local:{
   async get(keys){return Object.fromEntries(keys.filter(k=>k in db).map(k=>[k,structuredClone(db[k])]));},
   async set(value){Object.assign(db,structuredClone(value));}
  }},
  offscreen:{async hasDocument(){return true;}},
  runtime:{onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed'),
   async sendMessage(message){assert.equal(message.action,'native-resolve');return {tracks:[[{url:'https://media.test/clip.mp4'}]]};},
   async sendNativeMessage(name,message){assert.equal(name,'com.media_collector.processor');assert.equal(message.action,'destination-get');return {event:'done'};},
   connectNative(name){assert.equal(name,'com.media_collector.processor');return port;}},
  downloads:{onChanged:event('changed')},action:{onClicked:event('click')},scripting:{}
 };
 const context=vm.createContext({chrome,URL,console,structuredClone,setTimeout,crypto:{randomUUID:()=> 'token'}});
 context.importScripts=file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8'),context);
 const call=(action,extra={})=>new Promise(resolve=>handlers.message({target:'worker',action,...extra},{},resolve));
 const response=await call('download',{useNative:true,outputFormat:'mp4',items:[{id:'a',kind:'video',url:'https://media.test/clip.mp4',site:'site.test',available:true,duration:2}]});
 assert.ok(response.ok);assert.equal(request.action,'start');assert.equal(request.id,'token');
 assert.match(request.filename,/^site\.test-video-[a-f0-9]{8}\.mp4$/);assert.equal(request.tracks[0][0].url,'https://media.test/clip.mp4');
 portHandler({id:'token',event:'done',duration:2,hasAudio:true,hasVideo:true});
 const status=await call('status');
 assert.equal(status.job.done,1);assert.equal(status.job.status,'finished');assert.equal(status.job.lastInspection.audio,true);assert.ok(disconnected);
});
