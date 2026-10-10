// 和 Claude Code 联动(hooks):会话状态
import { prefs, state } from './state.js';
import { esc, fmtElapsed, t } from './i18n.js';
import { flashFace } from './model.js';
import { sfx } from './sfx.js';
import { bubbleKind, say, setBubbleHtml } from './bubble.js';
import { usage, usageHtml } from './quota.js';
import { CTX_FAT, CTX_FULL, crabArt } from './crabs.js';
import { cmdKind, react } from './reactions.js';
import { awayLog } from './reminders.js';
import { action, isClinging, setAction } from './behavior.js';

// ---------------- 和 Claude Code 联动(hooks) ----------------
// 每个会话一个状态:思考中 → 调用工具(具体在干什么)→ 等你批准 / 等你回复 → 完成 / 出错。
// Clawd 据此抱电脑干活、跳起来报告、挥手提醒;用量面板底部列出所有会话。
export const ccSessions = new Map();   // session → { state, tool, detail, project, since(进入当前状态), started(这轮任务开始), last }
export const CC_BUSY = ['thinking', 'tool'];
const TOOL_LABEL = { Bash: '运行命令', Edit: '改文件', MultiEdit: '改文件', Write: '写文件', Read: '读文件', NotebookEdit: '改笔记本',
  Grep: '搜索', Glob: '找文件', WebFetch: '看网页', WebSearch: '搜网页', Task: '派出子助手', Agent: '派出子助手', TodoWrite: '列计划' };
export function ccPurge() {
  const now = Date.now();
  for (const [id, x] of ccSessions) {
    const idle = now - x.last;
    if (idle > 30 * 60e3 || (!CC_BUSY.includes(x.state) && idle > 15 * 60e3)) ccSessions.delete(id);
  }
}
export function ccWorking() { ccPurge(); for (const x of ccSessions.values()) if (CC_BUSY.includes(x.state)) return true; return false; }
export function ccActivity(x, short = false) {   // 一句话描述会话在干什么
  if (x.compacting) return t('压缩上下文');
  if (x.state === 'tool') {
    const d = x.detail ? (short && x.detail.length > 16 ? x.detail.slice(0, 15) + '…' : x.detail) : '';
    return `${TOOL_LABEL[x.tool] ? t(TOOL_LABEL[x.tool]) : x.tool || t('干活')}${d ? t('：') + d : ''}`;
  }
  return t({ thinking: '思考中', ask: '等你批准', waiting: '等你回复', done: '完成', error: '出错了' }[x.state] || '');
}
export const ccIcon = state => `<em class="ico st-${state}">${crabArt(0)}</em>`;   // 会话列表里的状态图标:和头顶一样的像素小螃蟹,颜色表示状态
export function ccSessionsHtml() {   // 用量面板底部的会话列表,点一行跳到那个会话
  ccPurge();
  if (!ccSessions.size) return '';
  const now = Date.now();
  const rows = [...ccSessions.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, 5).map(([sid, x]) => {
    const busy = CC_BUSY.includes(x.state);
    const time = busy ? fmtElapsed(now - x.started) : x.state === 'done' || x.state === 'error' ? t('{0}前', fmtElapsed(now - x.since)) : fmtElapsed(now - x.since);
    return `<div class="sess st-${x.state}" data-sid="${esc(sid)}"><span>${esc(x.title || x.project || t('会话'))}</span><b>${ccIcon(x.state)}${esc(ccActivity(x, true))}</b><i>${time}</i></div>`;
  }).join('');
  return `<div class="sep"></div><div class="sub">${t('Claude Code 会话')}</div>${rows}`;
}
function ccProject(ev) { const n = ev.title || ev.project; return n ? `<br><b>${esc(n)}</b>` : ''; }
// 上下文快满(≥ 90%,快要自动压缩):提醒一次;压缩完、用量掉下去之后才会再提醒
function ctxCheck(x, ev) {
  if (x.ctx < CTX_FAT) x.ctxWarned = false;
  if (!(x.ctx >= CTX_FULL) || x.ctxWarned || x.compacting) return;
  x.ctxWarned = true;
  if (prefs.ccNotify.done && !state.paused) say(t('🦀 上下文快满了（{0}%），快要自动压缩', Math.min(99, Math.round(x.ctx * 100))) + ccProject(ev), 6);
}
export function ccAlert(html, secs, jump) {
  if (state.paused) return;
  say(html, secs);
  if (bubbleKind === 'perm') return;   // 批准气泡开着:这句先攒着(见 say),Clawd 已经在挥手了
  if (isClinging() || action.type === 'drag') { action.waveT = 0; return; }
  setAction(jump ? { type: 'jump', dir: 0, big: true } : { type: 'wave', dur: 2.4 });
}
window.pet?.onClaude?.(ev => {
  const sid = ev.session || '?', now = Date.now();
  if (ev.event === 'Restore' && ccSessions.has(sid)) return;   // 启动时补回的,已经收到它的新事件就不用了
  prefs.ccHooks = true;   // 收到过事件就说明 hooks 已经连上了
  const wasWorking = ccWorking();
  const x = ccSessions.get(sid) || { state: 'thinking', tool: '', detail: '', project: '', since: now, started: now, last: now };
  const to = (state) => { if (x.state !== state) x.since = now; x.state = state; };
  x.last = now;
  if (ev.project) x.project = ev.project;
  if (ev.title) x.title = ev.title;   // 会话标题,没有就退回项目名
  if (ev.app) { x.app = ev.app; x.tty = ev.tty; x.host = ev.host; }   // 会话开在哪个 App / 终端,点小螃蟹时跳过去
  if (ev.ctx != null) x.ctx = ev.ctx;   // 上下文用了多少(1 = 到了自动压缩的位置)
  if (x.compacting && ev.event !== 'PreCompact') x.compacting = 0;   // 压缩完了(万一没收到 PostCompact,有别的事件也算完)
  ccSessions.set(sid, x);
  ctxCheck(x, ev);
  switch (ev.event) {
    case 'UserPromptSubmit': to('thinking'); x.started = now; x.since = now; x.tool = x.detail = ''; break;
    case 'PreToolUse':
      if (!CC_BUSY.includes(x.state)) x.started = now;   // 批准后继续干活,或者中途才连上
      to('tool'); x.since = now; x.tool = ev.tool; x.detail = ev.detail;
      { const k = cmdKind(ev.cmd); if (k === 'rm' || k === 'force' || k === 'sudo') react(k); }
      break;
    case 'PostToolUse': {
      const k = cmdKind(ev.cmd);
      if (['test', 'commit', 'push'].includes(k)) window.pet?.stat?.(k);   // 记进日报
      if (k === 'test') react('test-pass'); else if (k === 'build') react('build-pass');
      else if (['push', 'commit', 'install', 'docker'].includes(k)) react(k);
      break;
    }
    case 'PostToolUseFailure':
      // 工具失败很常见(比如搜索没结果),只晕一下,不弹对话框;测试没过就垂头丧气
      { const k = cmdKind(ev.cmd); if (k === 'test') react('test-fail'); else if (k === 'build') react('build-fail'); else flashFace('dizzy', 1.6); }
      break;
    case 'SubagentStart': (x.agents ||= new Set()).add(ev.agent || String(now)); break;
    case 'SubagentStop': x.agents?.delete(ev.agent); break;
    case 'Stop': {
      const took = now - x.started;
      to('done'); x.agents?.clear();   // 这一轮结束,前台的子助手都收回来了(万一漏了 SubagentStop 也不会一直趴着)
      if (state.userAway) awayLog.set(sid, 'done');
      // 很快就答完的不打扰,干了一会儿(≥ 15 秒)的才报告
      if (prefs.ccNotify.done && took >= 15e3) { sfx('done'); flashFace('happy', 2.5); ccAlert(t('Claude 做完啦 ✅') + ccProject(ev), 6, true); }
      break;
    }
    case 'StopFailure':
      to('error'); x.agents?.clear();
      if (state.userAway) awayLog.set(sid, 'error');
      if (prefs.ccNotify.done) { sfx('error'); flashFace('cry', 2.5); ccAlert(t('⚠️ Claude 出错停下了') + ccProject(ev), 7); }
      break;
    case 'Notification': {
      // 优先看官方的 notification_type;老版本没有这个字段时再看提示文字
      const perm = ev.ntype === 'permission_prompt' || /permission/i.test(ev.message);
      const idle = ev.ntype === 'idle_prompt' || ev.ntype === 'agent_needs_input' || /waiting for your input/i.test(ev.message);
      const dialog = ev.ntype === 'elicitation_dialog' || ev.ntype === 'elicitation_url_dialog';
      if (!perm && !idle && !dialog) break;   // 其他通知(登录成功等)不打扰
      to(perm || dialog ? 'ask' : 'waiting');
      if (!prefs.ccNotify.ask) break;
      sfx('ask');
      const tool = (ev.message.match(/permission to use (.+)$/i) || [])[1] || (x.state === 'ask' && x.tool) || '';
      if (perm) ccAlert((tool ? t('🙋 要用 <b>{0}</b>，需要你批准', esc(tool)) : t('🙋 需要你批准')) + ccProject(ev), 8);
      else if (dialog) ccAlert(t('🙋 Claude 有问题要问你') + ccProject(ev), 8);
      else ccAlert(t('💬 Claude 在等你回复') + ccProject(ev), 6);
      break;
    }
    case 'PreCompact': x.compacting = now; break;
    case 'Restore': to(ev.state); x.tool = ev.tool; x.detail = ev.detail; break;   // Clawd 重启前就在跑的会话
    case 'SessionEnd': ccSessions.delete(sid); break;
  }
  if (wasWorking !== ccWorking() && action.type === 'rest') delete action.prop;   // 状态一变,马上拿起 / 放下电脑
  if (bubbleKind === 'usage') setBubbleHtml(usageHtml(usage), false);   // 面板开着就马上更新会话列表
});
