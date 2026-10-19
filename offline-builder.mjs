import {build} from 'esbuild';
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
export async function writeOffline(root,destination,{device,html}){
  const payloads=await Promise.all(device.variants.map(async v=>({id:v.id,bytes:await fs.readFile(path.join(root,'assets',v.model.fallback))})));
  const loader=`import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {MeshoptDecoder} from './vendor/meshopt_decoder.mjs';const metrics={source:'embedded',bytes:0,attempts:0};window.__HMI_LOAD__=metrics;export async function loadModel(variant,onProgress){onProgress('解码内嵌模型…');const data=atob(document.getElementById('embedded-'+variant.id).textContent.trim());const bytes=new Uint8Array(data.length);for(let i=0;i<data.length;i++)bytes[i]=data.charCodeAt(i);if(bytes.length!==variant.model.decodedBytes)throw new Error('内嵌模型数据不完整');metrics.bytes=bytes.length;metrics.attempts++;await MeshoptDecoder.ready;return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer,'');}`;
  const result=await build({absWorkingDir:root,entryPoints:['app.js'],bundle:true,minify:true,format:'iife',target:['es2020'],write:false,legalComments:'eof',plugins:[{name:'standalone',setup(b){b.onResolve({filter:/model-loader\.js$/},()=>({path:'embedded-loader',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:loader,resolveDir:root,loader:'js'}));b.onResolve({filter:/^three$/},()=>({path:path.join(root,'vendor/three.module.js')}));b.onResolve({filter:/^three\/addons\//},a=>({path:path.join(root,'vendor/addons',a.path.slice(13))}));}}]});
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('<link rel="stylesheet" href="./styles.css">','<style></style>');
  const css=await fs.readFile(path.join(root,'styles.css'),'utf8');html=html.replace('<style></style>',()=>`<style>${css}</style>`).replace('<title>','<title>离线 · ');
  const code=result.outputFiles[0].text.replaceAll('</script','<\\/script');
  const embedded=payloads.map(p=>`<script id="embedded-${p.id}" type="application/octet-stream">${p.bytes.toString('base64')}</script>`).join('');
  html=html.replace('</body>',()=>`${embedded}<script>${code}</script></body>`);
  if(/<script\b[^>]*\bsrc=|<link\b[^>]*rel="stylesheet"|type="module"|type="importmap"/i.test(html))throw new Error('Standalone contains external dependency');
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,html);
  return {file:path.basename(destination),bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),embeddedModels:payloads.map(p=>({id:p.id,bytes:p.bytes.length,sha256:createHash('sha256').update(p.bytes).digest('hex')}))};
}
