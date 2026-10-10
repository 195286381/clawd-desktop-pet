// 日报 / 周报、你离开时的小结、等太久再催、额度预测和休息提醒
import { prefs, state } from './state.js';
import { esc, fmtCost, fmtMin, t } from './i18n.js';
import { nowSec } from './util.js';
import { sfx } from './sfx.js';
import { bubbleKind, bubbleUntil, say } from './bubble.js';
import { mood, usage } from './quota.js';
import { ccActivity, ccAlert, ccSessions } from './sessions.js';
import { action, isClinging, setAction } from './behavior.js';

// ---------------- 日报 / 周报 ----------------
// 下班后(18 点以后)第一次有空,今天用过 Claude Code 就递一张小报,周五递本周的。一天只递一次;
// 你不在、正在说别的话时等下一轮(用量每 30 秒推一次)

const REPORT_HOUR = 18;
export function reportStats(r) {   // 小报 / 用量面板里的数据:两组(会话和时长 / 测试、commit、push),每组几小块
  const acts = [r.test && t('测试通过 <b>{0}</b> 次', r.test), r.commit && `commit <b>${r.commit}</b>`, r.push && `push <b>${r.push}</b>`].filter(Boolean);
  return [[t('会话 <b>{0}</b> 个', r.sessions), t('Claude 干活 <b>{0}</b>', fmtMin(Math.round(r.workMs / 60e3)))], acts].filter(g => g.length);
}
export function showReport(week) {
  const rp = usage && usage.report, r = rp && (week ? rp.week : rp.today);
  if (!r || !r.sessions) return;
  const cost = week ? r.cost : usage.today.cost;
  const lines = [...reportStats(r).map(g => g.join(' · ')), cost > 0 && t('估算花费 <b>{0}</b>', fmtCost(cost)), r.top && t('最忙的项目 <b>{0}</b>', esc(r.top))].filter(Boolean);
  sfx('chime');
  ccAlert(`${week ? t('📰 本周小报') : t('📰 今天的小报')}<br>${lines.join('<br>')}`, 12);
}
export function checkReport(u) {
  const rp = u.report;
  if (!prefs.reportOn || !rp || rp.shown === rp.day || new Date().getHours() < REPORT_HOUR) return;
  if (state.paused || state.userAway || (bubbleKind && nowSec() < bubbleUntil) || ['drag', 'leave'].includes(action.type)) return;
  rp.shown = rp.day;
  window.pet?.reportShown(rp.day);
  showReport(new Date().getDay() === 5);
}

// ---------------- 你离开时的小结 ----------------
// 5 分钟没碰键盘鼠标:Clawd 去睡觉,记下这期间哪些会话做完 / 出错;一回来就醒,告诉你错过了什么

export const awayLog = new Map();   // session → 'done' | 'error'
export function welcomeBack() {
  if (state.paused) return;
  const now = Date.now(), asks = [], others = [];
  for (const [sid, x] of ccSessions) {
    const name = esc(x.title || x.project || t('会话'));
    if (x.state === 'ask') asks.push(t('🙋 <b>{0}</b> 等你批准，已经等了 {1}', name, fmtMin(Math.max(1, Math.round((now - x.since) / 60e3)))));
    else if (awayLog.get(sid) === 'error') others.unshift(x.state === 'error' && x.why ? t('⚠️ <b>{0}</b> 停下了：{1}', name, ccActivity(x)) : t('⚠️ <b>{0}</b> 出错停下了', name));
    else if (awayLog.get(sid) === 'done') others.push(t('✅ <b>{0}</b> 做完了', name));
  }
  awayLog.clear();
  const lines = [...asks, ...others];
  if (!lines.length) { if (action.type === 'sleep' && mood < 4) setAction({ type: 'wave', dur: 1.6 }); return; }   // 没什么事:醒来挥挥手
  const shown = lines.length > 4 ? [...lines.slice(0, 3), t('…还有 {0} 个', lines.length - 3)] : lines;
  sfx(asks.length ? 'ask' : 'chime');
  ccAlert(t('你不在的时候：') + '<br>' + shown.join('<br>'), 10);
}

// ---------------- 等太久再催一下 ----------------
// Claude 等你批准(权限确认 / 有问题问你)超过 3 分钟还没处理,Clawd 再挥手提醒;之后每 5 分钟一次,最多催 3 次。
// 你一处理,会话状态变了,计时就重新开始。「等你回复」不催(回答完了等你下一句很正常)。
const NUDGE_FIRST = 3 * 60e3, NUDGE_EVERY = 5 * 60e3, NUDGE_MAX = 3;
setInterval(() => {
  if (!prefs.ccNotify.ask || state.paused || bubbleKind === 'usage' || action.type === 'drag') return;
  const now = Date.now();
  for (const x of ccSessions.values()) {
    if (x.state !== 'ask') continue;
    if (x.nudgeFor !== x.since) { x.nudgeFor = x.since; x.nudges = 0; }   // 新的一次等待
    if (x.nudges >= NUDGE_MAX || now - x.since < NUDGE_FIRST + x.nudges * NUDGE_EVERY) continue;
    x.nudges++;
    sfx('ask');
    ccAlert(t('🙋 <b>{0}</b> 还在等你批准<br>已经等了 {1}', esc(x.title || x.project || t('会话')), fmtMin(Math.round((now - x.since) / 60e3))), 8);
    break;   // 一次只催一个
  }
}, 15e3);

// ---------------- 额度用完预测 & 休息提醒(每次用量更新时检查) ----------------
// 休息提醒按 Claude 连续在用的时长算;但 Claude 自己接着跑不算你在写:你离开电脑够久(BREAK_REST)回来就重新计时,不在时也不提醒
export const BREAK_REST = 10 * 60e3;
let etaWarnedFor = null, breakState = { start: null, n: 0 };
export function etaInfo(w) {
  if (!w || w.etaMin == null) return null;
  const toReset = w.resetsAt ? (w.resetsAt - Date.now()) / 60e3 : Infinity;
  return { min: w.etaMin, beforeReset: w.etaMin < toReset - 5 };
}
export function checkEtaAndBreak(u) {
  const five = u.limits && u.limits.fiveHour, e = etaInfo(five);
  if (e && e.beforeReset && e.min <= 45 && mood < 4 && etaWarnedFor !== five.resetsAt && !state.paused) {
    etaWarnedFor = five.resetsAt;
    sfx('chime');
    say(t('⏳ 照现在的速度<br>5 小时额度大约 <b>{0}</b>后用完', fmtMin(e.min)), 7);
  }
  if (prefs.breakMin > 0 && u.streakStart && !state.paused && !state.userAway) {
    const start = Math.max(u.streakStart, state.restedAt);
    if (breakState.start !== start) breakState = { start, n: 0 };
    const mins = Math.floor((Date.now() - start) / 60e3), n = Math.floor(mins / prefs.breakMin);
    if (n > breakState.n) {
      breakState.n = n;
      sfx('chime');
      say(t('已经连续写了 <b>{0}</b> 啦<br>起来活动一下吧 🧘', fmtMin(mins)), 7);
      if (!isClinging() && action.type !== 'drag') setAction({ type: 'stretch', dur: 3 });
    }
  }
}
