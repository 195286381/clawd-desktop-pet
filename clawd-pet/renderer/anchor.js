// 量 Clawd 在屏幕上的位置:血条、气泡、头顶螃蟹都按它摆
import * as THREE from 'three';
import { state } from './state.js';
import { CH, CW, camera } from './scene.js';
import { BH, HOLIDAY, PROPS, bodyG, bodyMesh, root } from './model.js';
import { Wpx } from './world.js';
import { steadyPose } from './animation.js';

const headPt = new THREE.Vector3(), headUp = new THREE.Vector3();
// 身体顶面中心在屏幕上的位置,以及「头顶朝上」在屏幕上的方向(取最接近的 90° 倍数,像素保持清晰;
// 贴边时 Clawd 侧过来,头顶朝着屏幕里面)。按不带呼吸的姿态量,螃蟹不会一像素一像素地抖
export function headTopScreen() {
  const pos = bodyG.position.clone(), scl = bodyG.scale.clone();
  if (steadyPose) setBodyPose(...steadyPose);
  root.updateMatrixWorld(true); camera.updateMatrixWorld();
  headPt.set(0, BH / 2, 0).applyMatrix4(bodyMesh.matrixWorld).project(camera);
  headUp.set(0, BH / 2 + 1, 0).applyMatrix4(bodyMesh.matrixWorld).project(camera);
  bodyG.position.copy(pos); bodyG.scale.copy(scl); root.updateMatrixWorld(true);
  const deg = Math.atan2(headUp.x - headPt.x, (headUp.y - headPt.y) * CH / CW) * 180 / Math.PI;
  return { x: state.canvasLeft + (headPt.x + 1) / 2 * CW, y: state.canvasTop + (1 - headPt.y) / 2 * CH, rot: Math.round(deg / 90) * 90 };
}
// Clawd 身体(连同身上的道具)在屏幕上的可见范围(把包围盒投影到屏幕上;贴边时只算露出来的那部分)。
// 血条和气泡都挂在它的顶边中点上,不管是站着还是转过来趴在墙上都对得上。
const bodyBox = new THREE.Box3(), corner = new THREE.Vector3();
export function setBodyPose(x, y, q) {
  bodyG.position.set(x, y, 0);
  bodyG.scale.set(1 / Math.sqrt(q), q, 1 / Math.sqrt(q));
}
export function petAnchor() {
  const pos = bodyG.position.clone(), scl = bodyG.scale.clone();
  if (steadyPose) setBodyPose(...steadyPose);   // 按不带呼吸的姿态量,量完再放回去
  const an = measureAnchor();
  bodyG.position.copy(pos); bodyG.scale.copy(scl);
  root.updateMatrixWorld(true);
  return an;
}
function measureAnchor() {
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  bodyBox.setFromObject(bodyMesh);
  for (const g of [...Object.values(PROPS), ...Object.values(HOLIDAY)]) if (g.visible) bodyBox.expandByObject(g);   // 戴着帽子等道具时,血条和气泡要让到道具上面
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? bodyBox.max.x : bodyBox.min.x, i & 2 ? bodyBox.max.y : bodyBox.min.y, i & 4 ? bodyBox.max.z : bodyBox.min.z).project(camera);
    const sx = state.canvasLeft + (corner.x + 1) / 2 * CW, sy = state.canvasTop + (1 - corner.y) / 2 * CH;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  x0 = Math.max(0, x0); x1 = Math.min(Wpx, x1);
  return { x: (x0 + x1) / 2, top: y0, left: x0, right: x1, midY: (y0 + y1) / 2 };
}
