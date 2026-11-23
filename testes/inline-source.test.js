const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','inline-source.js'),'utf8');

async function confirm(item,response){
 const context=vm.createContext({chrome:{runtime:{sendMessage:async()=>response}}});
 vm.runInContext(source,context,{filename:'inline-source.js'});
 return context.MediaInline.confirm(item,()=>true,{observed:true});
}

test('confirmação preserva tamanho da fonte quando a observação atual não tem Content-Length',async()=>{
 const item={url:'https://video.twimg.com/asset.mp4',kind:'video',format:'direct',duration:18,expectedBytes:800000};
 const result=await confirm(item,{format:'direct',mp4:true});
 assert.equal(result.expectedBytes,800000);
 assert.equal(result.duration,18);
});

test('confirmação prefere tamanho observado mais recente da resposta',async()=>{
 const item={url:'https://video.twimg.com/asset.mp4',kind:'video',format:'direct',expectedBytes:800000};
 const result=await confirm(item,{format:'direct',mp4:true,expectedBytes:900000});
 assert.equal(result.expectedBytes,900000);
});
