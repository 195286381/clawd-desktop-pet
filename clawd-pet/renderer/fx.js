// 屏幕上的像素小特效:彩纸、烟、泡泡、纸箱、跳下去爬走的小螃蟹
import { state } from './state.js';
import { rand, setTransform } from './util.js';
import { petAnchor } from './anchor.js';
import { Hpx, Wpx } from './world.js';
import { ccSessions } from './sessions.js';
import { crabArt, ridersTop } from './crabs.js';
import { react } from './reactions.js';
import { action, isClinging } from './behavior.js';

// ---------------- 小特效:彩纸、烟、跳下去爬走的小螃蟹 ----------------
// 都是屏幕上的像素小方块(DOM),跟着主循环一帧帧动,动完就删掉
export const fxEl = document.getElementById('fx'), fx = [];
export const ridersPop = { y: 0, v: 0 };   // Clawd 把头顶的螃蟹颠起来:往上飞多高(px)、速度
const CONFETTI = ['#D97757', '#7FA383', '#D4A24C', '#6A9BCC', '#B8433F', '#E8DFD0'];
function fxAdd(o, cls = '', html = '') {
  const el = document.createElement('i');
  el.className = cls; el.innerHTML = html;
  if (o.color) el.style.background = o.color;
  if (o.size) el.style.width = el.style.height = o.size + 'px';
  fxEl.appendChild(el);
  fx.push({ el, age: 0, g: 0, vx: 0, vy: 0, drag: 0, life: 1, ...o });
}
export function confetti(x, y) {   // 测试全过:从头顶撒一把像素彩纸
  for (let i = 0; i < 36; i++)
    fxAdd({ x, y, vx: rand(-240, 240), vy: rand(-540, -260), g: 900, drag: 1.4, life: rand(1.4, 2.1), color: CONFETTI[i % CONFETTI.length], flip: rand(0, 1) });
}
export function smoke(x, y) {   // git push:脚底往两边喷烟
  for (let i = 0; i < 16; i++) {
    const d = i % 2 ? 1 : -1;
    fxAdd({ x: x + d * rand(0, 14), y: y - rand(0, 6), vx: d * rand(50, 170), vy: rand(-60, -10), g: -40, drag: 2.6, life: rand(0.5, 0.9), color: '#D3CCC0', size: 2 * Math.round(rand(2, 4)) });
  }
}
export function bubbles(x, y) {   // docker:从头顶冒几个蓝泡泡
  for (let i = 0; i < 10; i++)
    fxAdd({ x: x + rand(-18, 18), y, vx: rand(-20, 20), vy: rand(-170, -90), g: -30, drag: 1, life: rand(0.9, 1.4), color: '#6A9BCC', size: 2 * Math.round(rand(2, 4)) });
}
export function boxes(x, y) {   // 装依赖:几个小纸箱从头顶上方落下,砸在头上
  for (let i = 0; i < 3; i++)
    fxAdd({ x: x + (i - 1) * 12 - 6, y: y - 70 - i * 26, vx: 0, vy: 0, g: 1500, drag: 0, life: 0.5 + i * 0.05, color: i % 2 ? '#B98B5A' : '#D6B07C', size: 12 });
}
export function sparkles(x, y) {   // 构建成功:头顶闪一把金色小星星
  for (let i = 0; i < 12; i++)
    fxAdd({ x: x + rand(-24, 24), y: y - rand(0, 20), vx: rand(-40, 40), vy: rand(-120, -40), g: 120, drag: 1.2, life: rand(0.6, 1), color: i % 2 ? '#D4A24C' : '#F2E3B0', size: 4 });
}
export function crabLeave(state, fat, r, dir) {
  fxAdd({ crab: true, x: r.left, y: r.top, h: r.height, vx: dir * 70, vy: -240, g: 1100, dir, phase: 'hop', hops: state === 'error' ? 0 : 2, belly: state === 'error', life: 30 },
    `crab rider st-${state}`, crabArt(fat));
}
// 压缩上下文:Clawd 头顶出现一个敞口纸箱,纸片一张张飞进去;压缩完封上胶带,Clawd 蹦一下,纸箱淡出
const packEl = document.getElementById('packbox');
const PACK_OPEN = '<svg viewBox="0 0 12 10" width="24" height="20"><path fill="#B98B5A" d="M0 0h1v1H0zM0 1h2v1H0zM1 2h1v1H1zM11 0h1v1h-1zM10 1h2v1h-2zM10 2h1v1h-1z"/>'
  + '<path fill="#8A6A44" d="M1 3h10v1H1z"/><path fill="#D6B07C" d="M1 4h10v6H1z"/></svg>';
const PACK_SHUT = '<svg viewBox="0 0 12 10" width="24" height="20"><path fill="#B98B5A" d="M1 3h10v1H1z"/><path fill="#D6B07C" d="M1 4h10v6H1z"/>'
  + '<path fill="#EDE6DA" d="M5 3h2v3H5z"/></svg>';
export let packTop = Infinity, packPhase = null, packT = 0, nextPaper = 0;   // packPhase:null / 'open' 装纸片 / 'shut' 封好了
export function updatePack(t) {
  const now = Date.now();
  const busy = [...ccSessions.values()].some(x => x.compacting && now - x.compacting < 5 * 60e3);   // 最多等 5 分钟
  const away = state.paused || isClinging() || ['drag', 'leave', 'sleep'].includes(action.type);
  if (busy && packPhase !== 'open') { packPhase = 'open'; packEl.innerHTML = PACK_OPEN; }
  else if (!busy && packPhase === 'open') { packPhase = 'shut'; packT = t; packEl.innerHTML = PACK_SHUT; react('packed'); }
  else if (packPhase === 'shut' && t - packT > 1.4) packPhase = null;
  packEl.classList.toggle('show', !!packPhase && !away);
  packTop = Infinity;
  if (!packPhase || away) return;
  const an = petAnchor(), w = packEl.offsetWidth, h = packEl.offsetHeight;
  const bx = an.x, by = Math.min(an.top, ridersTop - 4) - 6 - h;   // 纸箱的左上角在头顶(和小螃蟹)上面
  const hop = packPhase === 'shut' && t - packT < 0.3 ? -Math.round(Math.sin((t - packT) / 0.3 * Math.PI) * 6) : 0;   // 封口时纸箱一跳
  setTransform(packEl, `translate(${Math.round(bx - w / 2)}px, ${Math.round(by) + hop}px)`);
  packTop = by;
  if (packPhase === 'open' && t > nextPaper) {   // 从身体两边抛一张纸片,划个弧线落进箱口
    nextPaper = t + rand(0.3, 0.5);
    const d = Math.random() < 0.5 ? -1 : 1, T = 0.6, g = 700;
    const x0 = an.x + d * rand(36, 70), y0 = an.top + rand(10, 50), tx = bx + rand(-6, 2), ty = by + 6;
    fxAdd({ x: x0, y: y0, vx: (tx - x0) / T, vy: (ty - y0 - g * T * T / 2) / T, g, life: T, color: '#F4EFE4', size: 5 });
  }
}
function stepCrab(f, dt) {
  const floor = Hpx - f.h;   // 和 Clawd 站在同一条地面上
  let rot = 0, bob = 0;
  if (f.phase === 'hop' || f.phase === 'wave') {
    f.vy += f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.y >= floor) {
      f.y = floor; f.vx = 0; f.vy = 0;
      if (f.phase === 'hop') { f.phase = f.belly ? 'belly' : 'wave'; f.t0 = f.age; }
      if (f.phase === 'wave') { if (f.hops-- > 0) f.vy = -150; else { f.phase = 'crawl'; f.t0 = f.age; } }   // 挥手 = 原地蹦两下
    }
  } else if (f.phase === 'belly') {   // 翻过来肚皮朝天,蹬腿
    rot = 180; f.jit = Math.floor(f.age * 14) % 2 ? 1 : -1;
    if (f.age - f.t0 > 1) { f.phase = 'crawl'; f.t0 = f.age; f.jit = 0; }
  } else {   // 横着爬走,一步一颠,慢慢淡出
    f.x += f.dir * 55 * dt; bob = Math.floor(f.age * 9) % 2 ? -1 : 0;
    const k = f.age - f.t0;
    f.el.style.opacity = Math.max(0, Math.min(1, (2.4 - k) / 0.7));
    if (k > 2.4) f.age = f.life;
  }
  setTransform(f.el, `translate(${Math.round(f.x + (f.jit || 0))}px, ${Math.round(f.y) + bob}px)${rot ? ` rotate(${rot}deg)` : ''}`);
}
export function updateFx(dt) {
  if (ridersPop.v || ridersPop.y) {   // 被颠起来的螃蟹落回头顶
    ridersPop.v += 1500 * dt; ridersPop.y += ridersPop.v * dt;
    if (ridersPop.y >= 0) ridersPop.y = ridersPop.v = 0;
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.age += dt;
    if (f.crab) stepCrab(f, dt);
    else {
      const k = Math.exp(-f.drag * dt);
      f.vx *= k; f.vy = f.vy * k + f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.flip !== undefined) {   // 彩纸翻转:一会儿宽一会儿窄
        const w = Math.floor((f.age + f.flip) * 9) % 2;
        f.el.style.width = (w ? 6 : 3) + 'px'; f.el.style.height = (w ? 3 : 6) + 'px';
      }
      f.el.style.opacity = Math.max(0, Math.min(1, (f.life - f.age) / 0.35));
      setTransform(f.el, `translate(${Math.round(f.x)}px, ${Math.round(f.y)}px)`);
    }
    if (f.age >= f.life || f.y > Hpx + 20 || f.x < -40 || f.x > Wpx + 40) { f.el.remove(); fx.splice(i, 1); }
  }
}
