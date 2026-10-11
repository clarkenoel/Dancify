import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {poseRig,transformPoint,loadRigImages} from './rig.mjs';
const rig=JSON.parse(await readFile(new URL('./rig.json',import.meta.url)));
const near=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-8,`${a} != ${b}`));
for(const character of ['human','lenny']){
 test(`${character}: pivots remain at parent joints during combined rotations`,()=>{
  const angles={body:.3,leftUpperArm:1.2,leftForearm:-.7,leftHand:.5,rightUpperLeg:-.8,rightLowerLeg:.9,rightFoot:-.2,head:.4};
  const pose=poseRig(rig,character,{angles,origin:[123,456],scale:.125});
  for(const bone of rig.characters[character].bones){
   const p=pose.get(bone.id);
   near(transformPoint(p.matrix,p.sprite.pivot),p.joint);
   if(bone.parent)near(p.joint,transformPoint(pose.get(bone.parent).matrix,bone.attachment));
  }
  near([pose.get('leftHand').rotation],[.3+1.2-.7+.5]);
 });
 test(`${character}: independent limbs and hand alternatives`,()=>{
  const neutral=poseRig(rig,character);const moved=poseRig(rig,character,{angles:{leftUpperArm:Math.PI/2}});
  near(neutral.get('rightHand').joint,moved.get('rightHand').joint);
  assert.notDeepEqual(neutral.get('leftHand').joint,moved.get('leftHand').joint);
  for(const hand of ['open','fist','point']){
   const pose=poseRig(rig,character,{variants:{leftHand:hand,rightHand:hand}});
   near(pose.get('leftHand').joint,neutral.get('leftHand').joint);
   assert.notEqual(pose.get('leftHand').sprite.region[2],pose.get('rightHand').sprite.region[2]);
  }
 });
}
test('Lenny side-profile alternatives replace the torso and face with the same attachments',()=>{
 const p=poseRig(rig,'lenny',{variants:{body:'side',head:'side'}});
 assert.match(p.get('body').sprite.file,/lenny_sideprofile/);
 assert.match(p.get('head').sprite.file,/lenny_sideface/);
 near(p.get('head').joint,transformPoint(p.get('body').matrix,[1680,1780]));
});
test('All pivot normalization, PNG paths, and source regions are valid',async()=>{
 const files=new Set();
 for(const c of Object.values(rig.characters))for(const b of c.bones)for(const s of Object.values(b.variants)){
  near(s.pivotNormalized,s.pivot.map(v=>v/3464));
  const [x0,y0,x1,y1]=s.region;assert.ok(x0>=0&&y0>=0&&x1<=3464&&y1<=3464&&x1>x0&&y1>y0);
  await readFile(new URL(s.file,import.meta.url));files.add(s.file);
 }
 assert.equal(files.size,23);
});
test('Invalid transforms and unsupported variants fail explicitly',()=>{
 assert.throws(()=>poseRig(rig,'missing'),/Unknown character/);
 assert.throws(()=>poseRig(rig,'human',{scale:0}),/scale/);
 assert.throws(()=>poseRig(rig,'human',{angles:{body:NaN}}),/angle/);
 assert.throws(()=>poseRig(rig,'human',{variants:{head:'side'}}),/Unknown variant/);
});
test('Asset loading reports failed files instead of drawing an incomplete character',async()=>{
 const createImage=()=>({set src(value){queueMicrotask(()=>this.onerror());}});
 await assert.rejects(loadRigImages(rig,new URL('./',import.meta.url),createImage),/Could not load/);
});
