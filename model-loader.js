import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from './vendor/meshopt_decoder.mjs';
const metrics={source:'',bytes:0,attempts:0,started:0,decodedAt:0};
window.__HMI_LOAD__=metrics;
const isGLB=b=>b[0]===103&&b[1]===108&&b[2]===84&&b[3]===70;
async function download(url,model,progress){
  const controller=new AbortController();let timer;
  const alive=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),45000);};alive();
  try{
    metrics.attempts++;const response=await fetch(url,{signal:controller.signal});
    if(!response.ok)throw new Error(`模型下载失败 (${response.status})`);
    let loaded=0,total=url.endsWith('.gz')?model.compressedBytes:model.decodedBytes;const chunks=[];
    if(response.body?.getReader){const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;alive();if(!loaded&&isGLB(value))total=model.decodedBytes;loaded+=value.byteLength;if(loaded>model.decodedBytes)throw new Error('模型数据异常');chunks.push(value);progress(`下载模型 ${(loaded/1e6).toFixed(2)} / ${(total/1e6).toFixed(2)} MB（${Math.min(100,Math.floor(loaded/total*100))}%）`);}}
    else {const b=new Uint8Array(await response.arrayBuffer());chunks.push(b);loaded=b.length;}
    const bytes=new Uint8Array(loaded);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}
    if(loaded!==(isGLB(bytes)?model.decodedBytes:model.compressedBytes))throw new Error('模型下载不完整');metrics.bytes=loaded;return bytes;
  }catch(e){if(e.name==='AbortError')throw new Error('模型下载超过45秒没有收到数据');throw e;}finally{clearTimeout(timer);}
}
export async function loadModel(variant,onProgress){
  const model=variant.model;metrics.started=performance.now();metrics.bytes=0;metrics.attempts=0;
  const filename=typeof DecompressionStream!=='undefined'?model.compressed:model.fallback;
  const url=new URL('./assets/'+filename,import.meta.url).href;
  let cache;try{if('caches'in window)cache=await caches.open('hmi-models-v1');}catch{}
  async function parse(bytes){
    let buffer;if(isGLB(bytes))buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    else buffer=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(buffer.byteLength!==model.decodedBytes||!isGLB(new Uint8Array(buffer)))throw new Error('模型解码校验失败');
    onProgress('整理模型部件…');await MeshoptDecoder.ready;
    const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer,'');metrics.decodedAt=performance.now();return gltf;
  }
  try{const cached=await cache?.match(url);if(cached){metrics.source='cache';return await parse(new Uint8Array(await cached.arrayBuffer()));}}catch{try{await cache?.delete(url);}catch{}}
  metrics.source='network';for(let n=0;n<2;n++){try{if(n)onProgress('下载中断，正在重试…');const bytes=await download(url,model,onProgress);const gltf=await parse(bytes);try{await cache?.put(url,new Response(bytes));}catch{}return gltf;}catch(e){if(n)throw e;}}
}
