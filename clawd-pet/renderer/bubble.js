// 头顶的对话气泡:说话、逐字打出来、跟着 Clawd 走
import { state } from './state.js';
import { nowSec, setTransform } from './util.js';
import { petAnchor } from './anchor.js';
import { Wpx } from './world.js';
import { petTop } from './crabs.js';
import { wake } from './loop.js';

export const bubble = document.getElementById('bubble');
export let bubbleUntil = 0, bubbleKind = null, bubbleLeft = null;   // bubbleLeft:给会话详情让开时,气泡还剩几秒
// kind:'say' 对你说的话 / 'chat' 自言自语(心里话气泡)/ 'usage' 用量面板
export const PX_FRAME = '<div class="pxf"><div class="pxs"></div><i class="d1"></i><i class="d2"></i></div>';   // 像素外框
export function setBubbleHtml(html, type) {
  bubble.innerHTML = html;
  if (type) typeIn(bubble);
  bubble.insertAdjacentHTML('afterbegin', PX_FRAME);
}
// 对你说的话(say)几句挨着来:合成一个框,新的一句接在后面逐字打出来,最多留最近 SAY_KEEP 句。
// 批准气泡开着时先攒着,等你表态完再一起说;被批准气泡挤掉、还没说完的也放回去
const SAY_KEEP = 4, SAY_SEP = '<div class="sep"></div>';
let sayParts = [];   // 当前框里的几句
export const sayLater = [];   // 攒着的:{ html, secs }
export function say(html, secs, kind = 'say') {
  if (bubbleKind === 'perm' && kind !== 'perm') { if (kind === 'say') sayLater.push({ html, secs }); return; }   // 自言自语就不攒了
  wake();
  const now = nowSec(), talking = bubbleKind === 'say' && now < bubbleUntil;
  if (kind === 'perm' && talking && bubbleUntil - now > 1) sayLater.push(...sayParts.map(h => ({ html: h, secs: Math.max(3, bubbleUntil - now) })));
  bubbleLeft = null;   // 给会话详情让开时,按新的时长重新算还剩几秒
  if (kind === 'say' && talking) {   // 上一句还没说完:接在同一个框里
    sayParts = [...sayParts, html].slice(-SAY_KEEP);
    bubble.innerHTML = sayParts.slice(0, -1).join(SAY_SEP) + SAY_SEP + `<span class="new">${html}</span>`;
    typeIn(bubble.querySelector('.new'));
    bubble.insertAdjacentHTML('afterbegin', PX_FRAME);
    bubbleUntil = Math.max(bubbleUntil, now + secs);
    return;
  }
  sayParts = kind === 'say' ? [html] : [];
  setBubbleHtml(html, kind !== 'usage');   // 用量面板是数据,不逐字打
  bubble.className = 'show ' + kind;
  void bubble.offsetWidth;          // 重新触发弹出动画
  bubble.classList.add('pop');
  if (state.dotsHover && (kind === 'say' || kind === 'chat')) bubble.classList.add('yield');   // 会话详情开着:先让开,不闪一下
  bubbleUntil = nowSec() + secs;
  bubbleKind = kind;
}
export function hideBubble(force) {
  if (bubbleKind === 'perm' && !force) return;   // 批准按钮只在你表态 / 超时 / 收起时才收
  bubble.classList.remove('show', 'pop'); bubbleKind = null;
}
// 把文字拆成一个个字,配合 CSS 逐字出现(保留 <b>、<br> 等标签)
function typeIn(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let i = 0;
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    for (const c of Array.from(n.textContent)) {
      const sp = document.createElement('span');
      sp.className = 'ch'; sp.textContent = c; sp.style.setProperty('--i', i++);
      frag.appendChild(sp);
    }
    n.replaceWith(frag);
  }
}
// 每帧:头顶气泡跟着 Clawd 走,不超出屏幕;bubbleYield:会话详情开着,对你说的话 / 自言自语先让开
export function placeBubble(bubbleYield) {
  if (bubbleKind === 'usage' && state.bubbleHover) bubbleUntil = Math.max(bubbleUntil, nowSec() + 1.5);   // 正在看用量面板时不收,移开后再停 1.5 秒
  if (bubbleYield) { bubbleLeft ??= bubbleUntil - nowSec(); bubbleUntil = nowSec() + bubbleLeft; } else bubbleLeft = null;
  if (bubble.classList.contains('yield') !== !!bubbleYield) bubble.classList.toggle('yield', !!bubbleYield);
  if (bubbleKind && nowSec() > bubbleUntil) hideBubble();
  if (bubbleKind) {
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight, an = petAnchor(), px = an.x;
    const left = Math.round(Math.min(Wpx - bw - 8, Math.max(8, px - bw / 2)));
    const top = Math.round(Math.max(8, petTop(an) - bh - (bubbleKind === 'chat' ? 30 : bubbleKind === 'say' ? 18 : 14)));   // 心里话下面挂着两颗小方块,要多让一点
    setTransform(bubble, `translate(${left}px, ${top}px)`);
    const tail = `${Math.min(bw - 18, Math.max(18, px - left))}px`;
    if (bubble.dataset.tail !== tail) { bubble.dataset.tail = tail; bubble.style.setProperty('--tail', tail); }
  }
}
