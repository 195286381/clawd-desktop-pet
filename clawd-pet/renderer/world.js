// 世界状态:屏幕大小、Clawd 的位置和速度、脚、光标
import { S } from './scene.js';
import { BW, LEG_L, REST_X } from './model.js';

// ---------------- 世界状态 ----------------
// 世界坐标:x 向右,y 向上,地面 y = 0 = 屏幕工作区底边(Dock 上沿)。单位 = S 像素。
export let Wpx = innerWidth, Hpx = innerHeight;
export const minX = () => BW / 2 + 0.6, maxX = () => Wpx / S - BW / 2 - 0.6;
export const st = { x: Wpx / S * 0.78, y: 7, vx: 0, vy: 0, air: true };   // 开场从上面掉下来
export const G = 32;

// 脚:世界坐标。落地时固定不动,需要时迈一步
export const feet = REST_X.map(rx => ({ x: st.x + rx, y: st.y - LEG_L, vx: 0, vy: 0, swing: null }));
export const STEP_T = 0.17, STEP_H = 0.16;

export const cursor = { x: -9999, y: -9999, at: -10 };

export function setScreen(w, h) { Wpx = w; Hpx = h; }   // 搬到另一块屏幕时由 commands.js 调用
addEventListener('resize', () => { Wpx = innerWidth; Hpx = innerHeight; st.x = Math.min(maxX(), Math.max(minX(), st.x)); });
