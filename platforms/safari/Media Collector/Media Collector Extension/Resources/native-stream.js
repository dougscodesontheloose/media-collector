/* Bounded, acknowledged native-message transfer. No URLs or credentials enter the host. */
(function(root){
 'use strict';
 const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
 const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
 class SHA256{
  constructor(){this.h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.buf=new Uint8Array(64);this.pos=0;this.len=0;}
  block(b){const w=new Uint32Array(64);for(let i=0;i<16;i++)w[i]=((b[i*4]<<24)|(b[i*4+1]<<16)|(b[i*4+2]<<8)|b[i*4+3])>>>0;for(let i=16;i<64;i++){const a=w[i-15],z=w[i-2];w[i]=(w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-7]+(rotr(z,17)^rotr(z,19)^(z>>>10)))>>>0;}let [a,b1,c,d,e,f,g,h]=this.h;for(let i=0;i<64;i++){const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b1)^(a&c)^(b1&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b1;b1=a;a=(t1+t2)>>>0;}this.h[0]=(this.h[0]+a)>>>0;this.h[1]=(this.h[1]+b1)>>>0;this.h[2]=(this.h[2]+c)>>>0;this.h[3]=(this.h[3]+d)>>>0;this.h[4]=(this.h[4]+e)>>>0;this.h[5]=(this.h[5]+f)>>>0;this.h[6]=(this.h[6]+g)>>>0;this.h[7]=(this.h[7]+h)>>>0;}
  update(data){this.len+=data.length;let i=0;while(i<data.length){let n=Math.min(64-this.pos,data.length-i);this.buf.set(data.subarray(i,i+n),this.pos);this.pos+=n;i+=n;if(this.pos===64){this.block(this.buf);this.pos=0;}}}
  digest(){const bits=BigInt(this.len)*8n;this.buf[this.pos++]=0x80;if(this.pos>56){this.buf.fill(0,this.pos);this.block(this.buf);this.pos=0;}this.buf.fill(0,this.pos,56);for(let i=0;i<8;i++)this.buf[63-i]=Number((bits>>BigInt(i*8))&255n);this.block(this.buf);return [...this.h].map(v=>v.toString(16).padStart(8,'0')).join('');}
 }
 function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
 async function transfer(port,response,config){
  const {id,filename,category,destination,kind,expectedBytes,expectedDuration,expectedAudio,signal,onProgress,waitIfPaused,onStart,onDispatch,onFinishing}=config;
  if(!response||response.status!==200||!response.body||response.headers?.get('content-range'))throw Error('A fonte não forneceu um arquivo completo.');
  const mime=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(/^(?:text\/html|application\/(?:json|xml)|text\/plain)$/.test(mime))throw Error('A fonte retornou uma página em vez da mídia.');
  const lengthText=response.headers?.get('content-encoding')?null:response.headers?.get('content-length');
  const length=lengthText&&/^\d+$/.test(lengthText)?Number(lengthText):null;
  if(length!==null&&(!Number.isSafeInteger(length)||length<=0||length>50*1024**3))throw Error('Tamanho da mídia inválido.');
  if(expectedBytes!=null&&(!Number.isSafeInteger(expectedBytes)||expectedBytes<=0||(length!==null&&length!==expectedBytes)))throw Error('Tamanho da mídia não corresponde à fonte.');
  let awaiting=null,disconnected=false,started=false,reader,offset=0;const hash=new SHA256();
  function fail(err){if(awaiting){const p=awaiting;awaiting=null;clearTimeout(p.timer);p.reject(err);}}
  function onMessage(msg){if(msg?.id!==id||!awaiting)return;if(msg.event==='error'||msg.event==='cancelled'){fail(Error(msg.error||'Transferência cancelada.'));return;}if(msg.event!==awaiting.event)return;const p=awaiting;awaiting=null;clearTimeout(p.timer);p.resolve(msg);}
  function onDisconnect(){disconnected=true;fail(Error('Auxiliar desconectado.'));}
  const onAbort=()=>{try{port.postMessage({id,action:'stream-cancel'});}catch{} fail(Error('Transferência cancelada.'));reader?.cancel().catch(()=>{});};
  port.onMessage.addListener(onMessage);port.onDisconnect.addListener(onDisconnect);signal?.addEventListener('abort',onAbort,{once:true});
  function check(){if(signal?.aborted)throw Error('Transferência cancelada.');if(disconnected)throw Error('Auxiliar desconectado.');}
  function request(message,event){check();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail(Error('O auxiliar não respondeu; verifique o destino antes de tentar novamente.')),event==='done'?210000:30000);awaiting={resolve,reject,event,timer};try{port.postMessage(message);}catch(e){fail(e);}});}
  try{
   check();onDispatch?.();const first=await request({id,action:'stream-start',filename,category,destination,kind,expectedBytes:expectedBytes??length??undefined,expectedDuration,expectedAudio},'stream-ready');started=true;onStart?.();if(first.offset!==0)throw Error('Resposta inicial inválida do auxiliar.');
   reader=response.body.getReader();
   async function readChunk(){let timer;try{return await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('A fonte parou de enviar dados; verifique o resultado no destino.')),15000);})]);}finally{clearTimeout(timer);}}
   for(;;){check();await waitIfPaused?.();check();const {done,value}=await readChunk();if(done)break;if(!(value instanceof Uint8Array))throw Error('Dados de mídia inválidos.');
    for(let i=0;i<value.length;i+=262144){check();await waitIfPaused?.();check();const part=value.subarray(i,i+262144);if(offset+part.length>50*1024**3)throw Error('Mídia excede o limite local.');hash.update(part);const reply=await request({id,action:'stream-append',offset,data:b64(part)},'stream-ack');offset+=part.length;if(reply.offset!==offset)throw Error('Confirmação inválida do auxiliar.');onProgress?.(offset,expectedBytes??length??0);}
   }
   check();await waitIfPaused?.();check();if(!offset||(length!==null&&offset!==length)||(expectedBytes!=null&&offset!==expectedBytes))throw Error('A transferência da mídia está incompleta.');
   onFinishing?.();const result=await request({id,action:'stream-finish',sha256:hash.digest(),expectedBytes:offset},'done');if(!result.filename)throw Error('O auxiliar não confirmou o arquivo final.');return result;
  }catch(e){if(started&&!disconnected)try{port.postMessage({id,action:'stream-cancel'});}catch{}throw e;}
  finally{if(reader)try{await reader.cancel();}catch{}signal?.removeEventListener('abort',onAbort);port.onMessage.removeListener(onMessage);port.onDisconnect.removeListener(onDisconnect);}
 }
 function transferKey(url,output){
  const text=unescape(encodeURIComponent(String(url)+'\n'+String(output||'mp4')));
  const bytes=Uint8Array.from(text,c=>c.charCodeAt(0));
  const hash=new SHA256();hash.update(bytes);return 'sha256:'+hash.digest();
 }
 root.MediaNativeStream={transfer,SHA256,transferKey};
})(globalThis);
