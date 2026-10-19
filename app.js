import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {acceleratedRaycast,computeBoundsTree} from './vendor/three-mesh-bvh.js';
import {loadModel} from './model-loader.js';
import device from './device.json';
function start(){
const $=id=>document.getElementById(id),stage=$('viewer');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene=new THREE.Scene();scene.background=new THREE.Color('#edf2f4');
const camera=new THREE.PerspectiveCamera(34,1,1,5000);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
stage.prepend(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.enablePan=false;
scene.add(new THREE.HemisphereLight(0xffffff,0x88939a,2.5));
for(const [pos,power]of [[[200,300,400],3], [[-250,100,-200],2],[[0,-200,100],.8]]){const light=new THREE.DirectionalLight(0xffffff,power);light.position.set(...pos);scene.add(light);}
THREE.Mesh.prototype.raycast=acceleratedRaycast;
const ray=new THREE.Raycaster();ray.firstHitOnly=true;
const marker=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x008f92,transparent:true,opacity:.9,depthTest:false}));marker.renderOrder=20;marker.visible=false;scene.add(marker);
let model,meshes=[],anchors=new Map(),hotspots=new Map(),moving=[],cameraMotion,loadSequence=0,raf,last=performance.now();
const state={loaded:false,variant:device.variants[0].id,topic:'overview',explode:0,explodeGoal:0,paused:false,labels:true,view:'overview',triangles:0};
const variant=()=>device.variants.find(v=>v.id===state.variant),topics=()=>variant().topics;
const asText=v=>Array.isArray(v)?v.join(' '):v??'';
function text(id,value){$(id).textContent=asText(value);}
const dirs={overview:[.8,.42,1.8],front:[0,0,1],back:[0,0,-1],left:[-1,0,.001],right:[1,0,.001],top:[0,1,.001],bottom:[0,-1,.001]};
function goView(view='overview',focus){
  if(!model)return;state.view=view;
  const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
  const center=bounds.getCenter(new THREE.Vector3());
  const target=focus?focus.clone().lerp(center,.15):center;
  const radius=Math.max(size.x,size.y,size.z),direction=new THREE.Vector3(...(dirs[view]||dirs.front)).normalize();
  const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
  const extent=axis=>Math.abs(axis.x)*size.x+Math.abs(axis.y)*size.y+Math.abs(axis.z)*size.z;
  const distance=Math.max(extent(up),extent(right)/Math.max(camera.aspect,.25))/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*(focus?1.05:1.2)+extent(direction)/2;
  const end=target.clone().addScaledVector(direction,distance);
  cameraMotion={from:camera.position.clone(),fromTarget:controls.target.clone(),to:end,target,elapsed:0};
  controls.minDistance=radius*.65;controls.maxDistance=radius*12;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
}
function updateMotionUI(){
  const motions=variant().motions||[];text('pose-label',state.explodeGoal?`部件拆离 ${Math.round(state.explodeGoal*100)}%${state.paused?' · 已暂停':''}`:'完整装配');
  $('explode-toggle').textContent=state.explodeGoal?'装回部件':'拆离'+(motions.length===1?motions[0].label:'可拆部件');
  $('explode-toggle').setAttribute('aria-pressed',String(state.explodeGoal>0));$('motion-pause').setAttribute('aria-pressed',String(state.paused));text('motion-pause',state.paused?'继续动画':'暂停动画');
  if(document.activeElement!==$('explode-range'))$('explode-range').value=String(Math.round(state.explodeGoal*100));
}
function showTopic(id,{move=true}={}){
  const topic=topics().find(t=>t.id===id)||topics()[0];state.topic=topic.id;
  for(const key of ['eyebrow','title','summary','purpose','connection','example','notes'])text('lesson-'+key,topic[key]);
  $('lesson-source').href=topic.sourceUrl;$('lesson-source').textContent=topic.sourceTitle||'查看官方资料 ↗';
  document.querySelectorAll('[data-topic]').forEach(b=>{b.classList.toggle('active',b.dataset.topic===topic.id);b.setAttribute('aria-current',String(b.dataset.topic===topic.id));});
  if(state.loaded&&move)goView(topic.view||'front',anchors.get(topic.id)?.position);updateMarker();
}
function createTopics(){
  $('topic-list').replaceChildren();$('hotspots').replaceChildren();anchors.clear();hotspots.clear();
  topics().forEach((topic,i)=>{
    const button=document.createElement('button');button.type='button';button.dataset.topic=topic.id;button.innerHTML=`<span class="topic-number">${String(i+1).padStart(2,'0')}</span><span></span>`;button.lastElementChild.textContent=topic.title;button.onclick=()=>showTopic(topic.id);$('topic-list').append(button);
    if(!topic.anchor)return;
    const def=topic.anchor,a={...def,position:new THREE.Vector3(...def.position),base:new THREE.Vector3(...def.position),normal:new THREE.Vector3(...def.normal)};
    anchors.set(topic.id,a);
    const h=document.createElement('button');h.type='button';h.className='hotspot';h.dataset.topic=topic.id;h.setAttribute('aria-label','查看'+topic.title);h.innerHTML=`<span class="hotspot-number">${String(i+1).padStart(2,'0')}</span><span class="hotspot-label"></span>`;h.lastElementChild.textContent=topic.title;h.onclick=e=>{e.stopPropagation();showTopic(topic.id);};$('hotspots').append(h);hotspots.set(topic.id,h);
  });
}
function visible(a){
  const delta=camera.position.clone().sub(a.position);if(delta.normalize().dot(a.normal)<.04)return false;
  const distance=camera.position.distanceTo(a.position);ray.set(camera.position,a.position.clone().sub(camera.position).normalize());ray.far=distance+1;
  const hit=ray.intersectObjects(meshes,false)[0];ray.far=Infinity;
  return !hit||hit.distance>=distance-(a.occlusionTolerance??3);
}
function updateMarker(){
  const a=anchors.get(state.topic);marker.visible=!!a;if(!a)return;
  marker.geometry.dispose();marker.geometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(...(a.size||[14,10,3])));marker.position.copy(a.position);
}
function updateHotspots(){
  const w=stage.clientWidth,h=stage.clientHeight;
  for(const[id,el]of hotspots){const a=anchors.get(id),p=a.position.clone().project(camera);el.hidden=!(state.labels&&p.z>-1&&p.z<1&&Math.abs(p.x)<.96&&Math.abs(p.y)<.93&&visible(a));el.style.left=`${(p.x+1)*w/2}px`;el.style.top=`${(1-p.y)*h/2}px`;el.classList.toggle('is-active',id===state.topic);}
  const a=anchors.get(state.topic);marker.visible=!!a&&visible(a);if(a)marker.position.copy(a.position);
}
function applyPose(){
  for(const m of moving)m.node.position.copy(m.base).addScaledVector(m.delta,state.explode);
  model?.updateMatrixWorld(true);
  for(const a of anchors.values()){a.position.copy(a.base);const m=moving.find(m=>m.id===a.motionId||m.name===a.node);if(m)a.position.addScaledVector(m.worldDelta,state.explode);}
}
function reset(){state.explode=state.explodeGoal=0;state.paused=false;state.labels=true;$('toggle-labels').checked=true;applyPose();showTopic('overview',{move:false});goView();updateMotionUI();}
function disposeModel(old){if(!old)return;old.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}}});}
async function changeVariant(id){
  const seq=++loadSequence;state.variant=id;state.loaded=false;$('variant-select').value=id;$('loading').hidden=false;$('viewer-error').hidden=true;$('variant-select').disabled=true;
  text('variant-identification',variant().label);text('model-status','正在载入 '+variant().label);marker.visible=false;hotspots.forEach(h=>h.hidden=true);
  try{
    const gltf=await loadModel(variant(),msg=>{if(seq===loadSequence)text('loading-text',msg);});if(seq!==loadSequence){disposeModel(gltf.scene);return;}
    const previous=model;scene.remove(previous);disposeModel(previous);model=gltf.scene;model.scale.setScalar(1000);scene.add(model);model.updateMatrixWorld(true);meshes=[];state.triangles=0;
    model.traverse(o=>{if(o.isMesh){meshes.push(o);state.triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;if(!o.geometry.boundsTree)computeBoundsTree.call(o.geometry);}});
    moving=(variant().motions||[]).map(m=>{const node=model.getObjectByName(m.node);if(!node)throw new Error('模型缺少已配置的可拆部件 '+m.node);const worldDelta=new THREE.Vector3(...m.translation);const parentInv=node.parent.matrixWorld.clone().invert();const origin=new THREE.Vector3().applyMatrix4(parentInv),end=worldDelta.clone().applyMatrix4(parentInv);return {...m,name:m.node,node,base:node.position.clone(),delta:end.sub(origin),worldDelta};});
    $('motion-controls').hidden=!moving.length;text('motion-caption',moving.length?'可拆部件：'+moving.map(m=>m.label).join('、')+'。位移用于结构认识。':'本模型展示外部结构与接口。');
    createTopics();state.loaded=true;reset();text('model-status',device.sourceKind==='factory'?'原厂模型 · 已载入':'教学模型 · 已载入');$('loading').hidden=true;
    window.dispatchEvent(new CustomEvent('hmi-ready'));
  }catch(e){console.error(e);if(seq===loadSequence){state.loaded=false;$('viewer-error').hidden=false;$('loading').hidden=true;text('error-detail',e.message+'。请使用支持 WebGL 的 Chrome 或 Edge，确认文件完整后重试。');text('model-status','模型加载未完成');}}
  finally{if(seq===loadSequence)$('variant-select').disabled=false;}
}
for(const v of device.variants){const o=document.createElement('option');o.value=v.id;o.textContent=v.label;$('variant-select').append(o);}$('variant-row').hidden=device.variants.length<2;$('variant-select').onchange=e=>changeVariant(e.target.value);
$('retry-load').onclick=()=>renderer.getContext().isContextLost()?location.reload():changeVariant(state.variant);$('reset-view').onclick=()=>goView();$('reset-all').onclick=reset;
$('toggle-labels').onchange=e=>state.labels=e.target.checked;
$('explode-toggle').onclick=()=>{state.explodeGoal=state.explodeGoal?0:1;state.paused=false;goView('back');updateMotionUI();};
$('explode-range').oninput=e=>{state.explode=state.explodeGoal=Number(e.target.value)/100;applyPose();updateMotionUI();};
$('motion-pause').onclick=()=>{state.paused=!state.paused;updateMotionUI();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>goView(b.dataset.view));
controls.addEventListener('start',()=>cameraMotion=null);
let down;
renderer.domElement.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});
renderer.domElement.addEventListener('pointerup',e=>{if(!state.loaded||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const b=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),camera);const hit=ray.intersectObjects(meshes,false)[0];if(!hit)return;let best,dist=Infinity;for(const[id,a]of anchors){const d=a.position.distanceTo(hit.point);if(d<dist){best=id;dist=d;}}if(best&&dist<Math.max(...variant().dimensions)*.35)showTopic(best);});
function resize(){const old=camera.aspect;camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();renderer.setSize(stage.clientWidth,stage.clientHeight);if(state.loaded&&Math.abs(old-camera.aspect)>.01)goView(state.view,anchors.get(state.topic)?.position);}
new ResizeObserver(resize).observe(stage);resize();camera.position.set(250,150,550);
function animate(now){const dt=Math.min((now-last)/1000,.05);last=now;if(state.loaded){if(!state.paused){state.explode=THREE.MathUtils.lerp(state.explode,state.explodeGoal,reduced?1:1-Math.exp(-dt*8));if(Math.abs(state.explode-state.explodeGoal)<.00005)state.explode=state.explodeGoal;applyPose();}if(cameraMotion){const m=cameraMotion;m.elapsed+=dt;const t=Math.min(1,m.elapsed/(reduced?.01:.7)),q=t*t*(3-2*t);camera.position.lerpVectors(m.from,m.to,q);controls.target.lerpVectors(m.fromTarget,m.target,q);if(t===1)cameraMotion=null;}controls.update();camera.updateMatrixWorld(true);updateHotspots();}renderer.render(scene,camera);raf=requestAnimationFrame(animate);}
window.__HMI__={snapshot:()=>({...state,device:device.id,sourceKind:device.sourceKind,modelBounds:model?new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray():null,camera:camera.position.toArray(),target:controls.target.toArray(),topicCount:topics().length,visibleHotspots:[...hotspots].filter(([,el])=>!el.hidden).map(([id])=>id),labels:[...anchors].map(([id,a])=>({id,position:a.position.toArray(),visible:!hotspots.get(id).hidden,x:parseFloat(hotspots.get(id).style.left),y:parseFloat(hotspots.get(id).style.top)})),partPositions:Object.fromEntries(moving.map(m=>[m.id,m.node.position.toArray()])),renderTriangles:renderer.info.render.triangles})};
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);raf=0;});
window.addEventListener('pageshow',event=>{if(event.persisted&&!raf){last=performance.now();raf=requestAnimationFrame(animate);}});
changeVariant(state.variant);raf=requestAnimationFrame(animate);
}
try{start();}catch(error){
  console.error(error);
  document.getElementById('loading').hidden=true;
  document.getElementById('viewer-error').hidden=false;
  document.getElementById('model-status').textContent='三维渲染不可用';
  document.getElementById('error-detail').textContent='无法启动三维显示。请使用支持 WebGL 的 Chrome 或 Edge，并检查浏览器硬件加速设置。'+error.message;
  document.getElementById('retry-load').onclick=()=>location.reload();
}
