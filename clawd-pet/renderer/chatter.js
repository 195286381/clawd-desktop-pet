// 自言自语
import { prefs, state } from './state.js';
import { fmtCost, t } from './i18n.js';
import { nowSec, rand } from './util.js';
import { flashFace } from './model.js';
import { bubbleKind, say } from './bubble.js';
import { mood, usage } from './quota.js';
import { ccActivity, ccSessions, ccWorking } from './sessions.js';
import { action, isClinging, setAction } from './behavior.js';

// ---------------- 自言自语 ----------------
// 闲着的时候每隔 40~100 秒随机冒一句,内容看时间、额度、是不是贴在墙上、你最近用得猛不猛。
// 额度用完(睡着)、被拖着、气泡开着时不说话。
const CHAT = {
  any: ['哼哼哼～ ♪', '（伸了个懒腰）', '在想下一个 bug 藏在哪…', '要不要喝口水？💧', '我是螃蟹吗？🦀 不是哦', 'commit 了吗？',
    '(・ω・)', '今天也要好好写代码 ✨', '戳戳我试试？', '偷偷告诉你，我会跳舞', '测试都跑过了吗？', '休息一下眼睛吧 👀'],
  night: ['这么晚还不睡？🌙', '夜深了，早点休息哦', '熬夜会掉头发的…'],
  morning: ['早上好 ☀️', '今天也元气满满！', '来杯咖啡吗？☕'],
  lunch: ['该吃午饭啦 🍱', '饿了…'],
  evening: ['快下班了吧？', '今天辛苦啦 🌇'],
  busy: ['有点忙，但还撑得住 💪', '你的手速好快…', '冲冲冲！'],
  tired: ['好累…', '能歇会儿吗…', '我…还能…再跑一会…'],
  low: ['电量告急 🪫', '要省着点用哦', '快…快没电了…'],
  cling: ['偷偷看着你 👀', '墙边好凉快', '我藏好了吗？', '嘘——'],
  active: ['你又在用 Claude Code 啦', '写得好快！', '这段代码看起来不错哦'],
  idle: ['好久没理我了…', '在忙别的吗？', '无聊…'],
  working: ['Claude 在努力干活…', '我帮你盯着呢 👀', '敲敲敲…', '这个任务有点大哦'],
};
let nextChat = nowSec() + 15 + Math.random() * 15, lastChat = '';   // 开场 15~30 秒后第一次说话
export function chatter(force = false) {
  const now = nowSec();
  if (!force && now < nextChat) return;
  if (prefs.chatLevel === 'off') { nextChat = now + 30; return; }
  nextChat = now + ({ chatty: rand(18, 45), quiet: rand(180, 360) }[prefs.chatLevel] || rand(40, 100));
  if (state.paused || bubbleKind || mood === 4 || ['drag', 'leave', 'sleep', 'fall'].includes(action.type)) return;
  const h = new Date().getHours();
  const pools = [CHAT.any];
  if (h < 5 || h >= 23) pools.push(CHAT.night, CHAT.night);
  else if (h < 10) pools.push(CHAT.morning);
  else if (h >= 11 && h < 13) pools.push(CHAT.lunch);
  else if (h >= 17 && h < 20) pools.push(CHAT.evening);
  if (mood === 1) pools.push(CHAT.busy);
  if (mood === 2) pools.push(CHAT.tired, CHAT.tired);
  if (mood === 3) pools.push(CHAT.low, CHAT.low);
  if (isClinging()) pools.push(CHAT.cling, CHAT.cling);
  const since = usage && usage.lastActive ? Date.now() - usage.lastActive : Infinity;
  if (since < 3 * 60e3) pools.push(CHAT.active);
  else if (since > 60 * 60e3 && since < Infinity && !ccWorking()) pools.push(CHAT.idle);   // Claude 正在干活时不说"好久没理我"
  if (ccWorking()) {
    pools.push(CHAT.working);
    // 说说 Claude 正在干什么
    const busy = [...ccSessions.values()].filter(x => x.state === 'tool').sort((a, b) => b.last - a.last)[0];
    if (busy) { const l = t('Claude 在{0}…', ccActivity(busy)); pools.push([l], [l]); }
  }
  const burn = usage && usage.today.cost >= 20 ? t('今天已经烧了 {0} 的 token 啦 🔥', fmtCost(usage.today.cost)) : null;
  if (burn) pools.push([burn]);
  let line;
  for (let i = 0; i < 5 && (!line || line === lastChat); i++) { const pool = pools[Math.floor(Math.random() * pools.length)]; line = t(pool[Math.floor(Math.random() * pool.length)]); }
  lastChat = line;
  say(line, 3.5, 'chat');
  if (line === burn) flashFace('money', 3.5);
  if (!isClinging() && action.type !== 'walk' && Math.random() < 0.3) setAction({ type: 'wave', dur: 1.2 });
}
