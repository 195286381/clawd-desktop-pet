// 几个到处用到的小工具

export const nowSec = () => performance.now() / 1000;
export const nearRect = (r, x, y, m = 0) => x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m;
export const rand = (a, b) => a + Math.random() * (b - a);
export function setTransform(el, v) { if (el.dataset.tf !== v) { el.dataset.tf = v; el.style.transform = v; } }   // 没变就不写,省得每帧重排
