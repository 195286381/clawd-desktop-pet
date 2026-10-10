// three.js 画布、相机、灯光、地面影子,以及动画用的时钟
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------------- 画布与相机 ----------------
// 大小:菜单里选,主进程通过 ?scale= 传进来;只缩放 3D 的 Clawd,气泡和血条的文字保持原大小
export const SCALE = Math.min(2, Math.max(0.5, Number(new URLSearchParams(location.search).get('scale')) || 1));
export const S = 40 * SCALE;              // 1 个世界单位 = 40 屏幕像素(乘以大小)
export const CW = Math.round(340 * SCALE), CH = CW;   // 跟着 Clawd 走的小画布
export const GROUND_PX = 70 * SCALE;      // Clawd 脚底在画布里离底边的距离
const YAW = 0.34, PITCH = 0.2;     // 略微侧着、俯视一点,露出侧面和顶面

export const canvas = document.getElementById('c');
export const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(CW, CH);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;

export const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

export const camera = new THREE.OrthographicCamera(-CW / 2 / S, CW / 2 / S, CH / 2 / S, -CH / 2 / S, 0.1, 100);
export const CAM_DIR = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
export const AIM_Y = ((CH - GROUND_PX) - CH / 2) / (S * Math.cos(PITCH)); // 让脚底落在画布的 GROUND_PX 处

export const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 30 });
sun.shadow.radius = 4;
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xfff8f0, 0xd9c8b4, 0.7));
export const rim = new THREE.DirectionalLight(0xffffff, 0.9);
scene.add(rim, rim.target);

export const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.ShadowMaterial({ opacity: 0.18 }));
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);
export const clock = new THREE.Clock();
