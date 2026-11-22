const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(statuses, isStopped = () => false, chunks = [new Uint8Array([1,2,3])]) {
  const calls = [];
  let listener;
  const video = {currentSrc:'blob:current',isConnected:true};
  const window = {
    addEventListener(_type, fn) { listener = fn; },
    postMessage(request) {
      listener({source:window,data:{channel:'media-collector-mse-response',id:request.id,
        duration:2,tracks:[{mime:'video/mp4',chunks}]}});
    }
  };
  const chrome = {runtime:{async sendMessage(message) {
    calls.push(message.action);
    if (message.action === 'mse-prepare') return {token:'token'};
    if (message.action === 'status') return {job:statuses.shift()};
    return {ok:true};
  }}};
  const context = {window,chrome,location:{pathname:'/stories/test/1/',origin:'https://www.instagram.com'},
    crypto:{randomUUID:()=>'id'},setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout() {},
    Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64')};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../mse-client.js'),'utf8'),context);
  return {calls,run:(ensureCurrent)=>context.MediaCapture.download(video,{post:'1'},'mp4',true,isStopped,undefined,undefined,ensureCurrent)};
}
test('lote espera a gravação terminar antes de avançar',async()=>{
  const s=setup([{captureToken:'token',status:'running'},{captureToken:'token',status:'finished',done:1,failed:0}]);
  await s.run();assert.equal(s.calls.filter(x=>x==='status').length,2);
});
test('lote informa falha da montagem',async()=>{
  const s=setup([{captureToken:'token',status:'finished',done:0,failed:1,errors:['Vídeo incompleto.']}]);
  await assert.rejects(s.run(),/Vídeo incompleto/);assert.ok(s.calls.includes('mse-abort'));
});
test('cancelar a coleta interrompe o processamento',async()=>{
  let checks=0;
  const s=setup([{captureToken:'token',status:'running'}],()=>++checks>1);
  await assert.rejects(s.run(),/interrompida/);assert.ok(s.calls.includes('mse-abort'));
});
test('cancelar durante envio de fragmentos aborta antes da montagem',async()=>{
  let s;
  s=setup([],()=>s.calls.filter(x=>x==='mse-append').length===1,[new Uint8Array(300000)]);
  await assert.rejects(s.run(),/interrompida/);
  assert.equal(s.calls.filter(x=>x==='mse-append').length,1);
  assert.ok(s.calls.includes('mse-abort'));
  assert.ok(!s.calls.includes('mse-finish'));
});
test('troca de Story durante envio aborta antes da montagem',async()=>{
  const s=setup([],()=>false,[new Uint8Array(300000)]);
  await assert.rejects(s.run(()=>{if(s.calls.includes('mse-append'))throw Error('Story mudou');}),/Story mudou/);
  assert.equal(s.calls.filter(x=>x==='mse-append').length,1);
  assert.ok(s.calls.includes('mse-abort'));
  assert.ok(!s.calls.includes('mse-finish'));
});
