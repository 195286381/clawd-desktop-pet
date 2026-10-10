// 头顶血条:格子 = 5 小时额度,小圆环 = 本周额度
import { prefs, state } from './state.js';
import { fmtReset } from './i18n.js';
import { nowSec, setTransform } from './util.js';
import { petAnchor } from './anchor.js';
import { Hpx, Wpx } from './world.js';
import { PX_FRAME, bubbleKind } from './bubble.js';
import { levelOf, usage } from './quota.js';
import { petTop, ridersSide, tipList } from './crabs.js';
import { action, isClinging } from './behavior.js';
import { HOVER_INTENT, hoverSince } from './input.js';

let hpHoverUntil = 0;   // 悬停模式:血条显示到什么时候
// 血条里的内容:格子 = 5 小时额度,小圆环 = 本周额度;nums 时两个百分比都写出来
export function usageHTML(L, vert, nums) {
  const r = Math.max(0, Math.round(L.fiveHour ? L.fiveHour.remaining : 100));   // 5 小时窗口过期 = 已重置,满格
  const hl = levelOf(r), cells = Math.min(10, Math.ceil(r / 10));
  const text = hl === 4 && !vert && L.fiveHour ? `0% · ${fmtReset(L.fiveHour.resetsAt, true)}` : hl >= 2 || nums ? `${r}%` : '';
  const wk = L.sevenDay ? Math.max(0, Math.min(100, Math.round(L.sevenDay.remaining))) : null;
  const pct = (v, cls = '') => vert ? `<b class="${cls}"><span>${v}</span><span>%</span></b>` : `<b class="${cls}">${v}%</b>`;
  const html = '<div class="hp">' + Array.from({ length: 10 }, (_, i) => `<i${i < cells ? ' class="on"' : ''}></i>`).join('') + '</div>'
    + (!text ? '' : vert ? pct(r) : `<b>${text}</b>`)
    + (wk === null ? '' : `<svg class="ring lv${levelOf(wk)}" viewBox="0 0 16 16"><circle class="track" cx="8" cy="8" r="6"/>`
      + `<circle class="arc" cx="8" cy="8" r="6" pathLength="100" stroke-dasharray="${wk} 100" transform="rotate(-90 8 8)"/></svg>`
      + (nums ? pct(wk, `wk lv${levelOf(wk)}`) : ''));
  return { html, hl };
}
export let hpUsage = null, hpFromDots = false;   // 这一帧血条该显示的用量(没有就是 null);最近一次悬停是不是在看会话详情
// 每帧:摆好头顶的血条;返回这一帧对你说的话 / 自言自语要不要给会话详情让开
export function updateHud(t) {
  const L = usage && usage.limits;
  // 悬停模式:移开后再停 1.5 秒(在看会话详情时也别收起)。有会话时悬停 Clawd 会弹会话详情,额度在详情里看,
  // 血条不跟着悬停变化;光标在身上停够了、详情马上要出来(例如刚松手)时也算在看详情,免得单独的额度框先闪一下;拎着时也不变
  const tipSoon = tipList.length && state.hovering && nowSec() - hoverSince >= HOVER_INTENT;
  if (state.dotsHover || tipSoon || (state.hovering && !tipList.length && action.type !== 'drag')) { hpHoverUntil = t + 1.5; hpFromDots = state.dotsHover || tipSoon; }
  const hpOn = prefs.hpMode === 'always' || (prefs.hpMode === 'hover' && t < hpHoverUntil);
  // 会话详情开着时,对你说的话 / 自言自语先让开(计时也停住),移开后接着显示完,头顶只留一个框
  const bubbleYield = state.dotsHover && tipList.length && (bubbleKind === 'say' || bubbleKind === 'chat');
  hpUsage = hpOn && L && (L.fiveHour || L.sevenDay) && (!bubbleKind || bubbleYield) && !state.paused ? L : null;
  if (hpUsage && action.type !== 'drag' && !(tipList.length && (state.dotsHover || tipSoon || (hpFromDots && t < hpHoverUntil)))) {   // 拎着时不显示;在看会话详情时,用量并进详情框里,不单独显示(移开后也别再单独冒出来)
    const vert = isClinging();
    const { html, hl } = usageHTML(L, vert, t < hpHoverUntil);   // 鼠标悬停时(移开后 1.5 秒内)把两个百分比都显示出来
    if (badge.dataset.key !== html) { badge.dataset.key = html; badge.innerHTML = PX_FRAME + html; }
    const cls = 'show lv' + hl + (vert ? ' vert' : '');
    if (badge.className !== cls) badge.className = cls;
    const bw = badge.offsetWidth, bh = badge.offsetHeight, an = petAnchor();
    // 站着:挂在头顶;贴边:露出来的身体太窄,挂到身体朝屏幕里的那一侧
    const bx = isClinging() ? (action.side > 0 ? an.left - bw - 13 - ridersSide : an.right + 13 + ridersSide) : an.x - bw / 2;
    const by = isClinging() ? an.midY - bh / 2 : petTop(an) - bh - 11;   // 头上趴着螃蟹时挂到它们上面;像素外框往外多 3px
    setTransform(badge, `translate(${Math.round(Math.min(Wpx - bw - 8, Math.max(8, bx)))}px, ${Math.round(Math.min(Hpx - bh - 8, Math.max(8, by)))}px)`);
  } else if (badge.classList.contains('show')) {
    badge.classList.remove('show');   // 只去掉 show,保留竖排等样式,淡出时不会从竖条跳成横条
  }
  return bubbleYield;
}
const badge = document.getElementById('badge');
