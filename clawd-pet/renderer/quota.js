// 用量和额度:心情档位、用量面板,用量更新时说话
import { state } from './state.js';
import { fmtAgo, fmtCost, fmtMin, fmtReset, fmtTokens, t } from './i18n.js';
import { nowSec } from './util.js';
import { flashFace } from './model.js';
import { sfx } from './sfx.js';
import { bubbleKind, say, setBubbleHtml } from './bubble.js';
import { ccSessions, ccSessionsHtml } from './sessions.js';
import { checkEtaAndBreak, checkReport, etaInfo, reportStats } from './reminders.js';
import { action, isClinging, setAction } from './behavior.js';

// ---------------- 用量 & 状态 ----------------
// 按剩余额度分 5 档(取 5 小时额度和本周额度里剩得更少的那个):
//   0 精神饱满 ≥50% · 1 有点忙 20~50% · 2 累了 10~20% · 3 快没电了 <10% · 4 额度用完了
// 没有额度数据时(例如用 API Key)退回按当前 5 小时窗口的估算花费,只分前三档。
const LEVEL_BUSY = 50, LEVEL_TIRED = 20, LEVEL_LOW = 10;
const MOOD_BUSY = 8, MOOD_TIRED = 25;
const MOOD_NAME = ['精神饱满', '有点忙', '累了', '快没电了', '额度用完了'];
const LIMIT_ERR = { 'no-cli': '没找到 claude 命令行', failed: '查询失败', 'no-sub': '没有订阅额度信息(可能在用 API Key)' };   // usage.js 给的错误代码
export let usage = null, mood = 0;
export const levelOf = r => (r <= 0 ? 4 : r < LEVEL_LOW ? 3 : r < LEVEL_TIRED ? 2 : r < LEVEL_BUSY ? 1 : 0);
let quota = null;   // 当前最紧张的那个额度窗口:{ label, rem, resetsAt }
function moodFrom(u) {
  const L = u.limits;
  const wins = L ? [[t('5 小时额度'), L.fiveHour], [t('本周额度'), L.sevenDay]].filter(([, w]) => w) : [];
  if (wins.length) {
    const [label, w] = wins.reduce((a, b) => (b[1].remaining < a[1].remaining ? b : a));
    quota = { label, rem: w.remaining, resetsAt: w.resetsAt };
    return levelOf(w.remaining);
  }
  quota = null;
  const c = u.block ? u.block.cost : 0;
  return c >= MOOD_TIRED ? 2 : c >= MOOD_BUSY ? 1 : 0;
}
export function usageHtml(u) {
  if (!u) return `<div class="title">${t('正在统计用量…')}</div>`;
  if (!u.week.messages) return `<div class="title">${t('最近 7 天还没用过 Claude Code')}</div>`;
  const row = (k, v, note) => `<div class="row"><span>${k}</span><b>${v}</b><i>${note}</i></div>`;
  let html = `<div class="title">${t('Claude Code 用量')}</div>`;
  const L = u.limits;
  if (L) {
    const bar = (label, w) => {
      if (!w) return '';
      const left = Math.round(w.remaining);
      return `<div class="quota lv${levelOf(w.remaining)}"><div class="qhead"><span>${label}</span><b>${t('剩 {0}%', left)}</b><i>${fmtReset(w.resetsAt)}</i></div>`
        + `<div class="qbar"><div style="width:${Math.max(0, Math.min(100, w.remaining))}%"></div></div>`
        + (w === L.fiveHour && etaInfo(w) ? (etaInfo(w).beforeReset
          ? `<div class="eta warn">${t('⏳ 照现在速度，约 {0}后用完', fmtMin(etaInfo(w).min))}</div>`
          : `<div class="eta ok">${t('照现在速度，撑得到重置')}</div>`) : '')
        + '</div>';
    };
    html += bar(t('5 小时额度'), L.fiveHour) + bar(t('本周额度'), L.sevenDay);
    const ago = Math.round((Date.now() - L.savedAt) / 60000);
    if (ago >= 10) html += `<div class="foot">${t('额度数据 {0}前更新', fmtAgo(ago))}</div>`;
    html += '<div class="sep"></div>';
  }
  const stats = r => (r && r.sessions ? `<div class="stats">${reportStats(r).flat().map(x => `<span>${x}</span>`).join(' · ')}</div>` : '');   // 会话数、干活时长、测试 / commit / push
  html += row(t('今天'), fmtCost(u.today.cost), fmtTokens(u.today.tokens) + ' tokens') + stats(u.report && u.report.today);
  if (u.block) {
    html += row(t('5 小时窗口'), fmtCost(u.block.cost), t('还剩 {0}', fmtMin(u.block.remainingMin)));
  } else {
    html += row(t('5 小时窗口'), '—', t('当前没有进行中的窗口'));
  }
  html += row(t('近 7 天'), fmtCost(u.week.cost), fmtTokens(u.week.tokens) + ' tokens') + stats(u.report && u.report.last7);
  const models = Object.entries(u.byModel).sort((a, b) => b[1].cost - a[1].cost);
  if (models.length && u.today.cost > 0) {
    html += '<div class="models">' + models.slice(0, 3)
      .map(([k, v]) => `${k} ${Math.round(v.cost / u.today.cost * 100)}%`).join(' · ') + '</div>';
  }
  const limitNote = L ? null : u.limitsError ? t('额度:{0}', t(LIMIT_ERR[u.limitsError] || u.limitsError)) : t('额度查询中…');
  html += ccSessionsHtml();
  // 每一节是一个不拆开的小块,太长时在「·」处换行,不会撑出气泡边框
  const foot = [t('花费按 API 价格估算'), limitNote, t('Clawd 现在{0}', t(MOOD_NAME[mood]))].filter(Boolean);
  html += `<div class="foot">${foot.map(x => `<span>${x}</span>`).join(' · ')}</div>`;
  return html;
}
export function showUsage() {
  window.pet?.requestUsage();
  say(usageHtml(usage), 8, 'usage');
}

let usageInit = false, lastNag = 0, moodByQuota = false;   // moodByQuota:心情是按额度算的(否则是按花费估算的)
export const quotaReset = () => quota?.resetsAt || 0;   // 最紧张的那个额度窗口什么时候恢复(没有额度数据时是 0)
function quotaLine() {
  if (!quota) return '';
  return t('{0}只剩 <b>{1}%</b>', quota.label, Math.round(quota.rem));
}
window.pet?.onUsage(u => {
  usage = u;
  const prev = mood;
  const m = moodFrom(u);
  mood = m;
  // 刚启动时额度还没查到,心情先按花费估算;额度到了换成按额度算,这时的变化不是额度真的变了,不说话
  const switched = moodByQuota !== !!quota;
  moodByQuota = !!quota;
  const free = !state.paused && bubbleKind !== 'usage' && action.type !== 'drag' && action.type !== 'leave';
  if (usageInit && free && !switched) {
    if (m > prev) {
      // 状态变差:主动冒一句
      if (m === 1) say(`${t('忙起来啦 💦')}<br>${quotaLine()}`, 4);
      if (m === 2) say(`${t('有点累了… 💦')}<br>${quotaLine()}`, 5);
      if (m === 3) { sfx('low'); say(`${t('⚠️ 快没电了！')}${quotaLine()}<br>${t('省着点用～')} ${quota ? fmtReset(quota.resetsAt) : ''}`, 7); lastNag = nowSec(); }
      if (m === 4) { sfx('low'); flashFace('cry', 3); say(`${t('额度用完啦…')} ${quota ? fmtReset(quota.resetsAt, true) : ''}<br>${t('我先睡会 💤')}`, 7); if (!isClinging()) setAction({ type: 'sleep' }); }
    } else if (prev >= 2 && m <= 1) {
      // 额度重置了:醒来庆祝
      sfx('recover'); say(t('额度恢复啦！🎉'), 4);
      if (!isClinging()) setAction({ type: 'dance', dur: 3, face: 'star' }); else flashFace('star', 3);
    } else if (m === 3 && nowSec() - lastNag > 15 * 60) {
      say(`⚠️ ${quotaLine()}${t('，省着点用～')}`, 5);
      lastNag = nowSec();
    }
  }
  if (!usageInit && m === 4 && !isClinging()) setAction({ type: 'sleep' });
  if (usageInit) { checkEtaAndBreak(u); checkReport(u); }
  usageInit = true;
  if (bubbleKind === 'usage') setBubbleHtml(usageHtml(usage), false);   // 气泡开着时实时刷新
});

// 面板开着时,会话列表里的计时每秒走一下
setInterval(() => { if (bubbleKind === 'usage' && ccSessions.size) setBubbleHtml(usageHtml(usage), false); }, 1000);
