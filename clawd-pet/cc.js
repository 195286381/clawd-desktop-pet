// 和 Claude Code 联动里不依赖 Electron 的部分:hooks 配置的增删、hook 事件的整理、会话记录的解析、权限批准的回复。
// 从 main.js 拆出来,这样 test/ 里的单元测试不用启动 Electron 就能跑
const path = require('path');

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification', 'PreCompact', 'PostCompact', 'SessionEnd'];
const HOOK_MARK = 'clawd-hook';
const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/;   // Claude App 里的会话 id

// ---------- ~/.claude/settings.json 里的 hooks ----------
const isClawdHook = h => typeof h.command === 'string' && h.command.includes(HOOK_MARK);
const hasClawdHook = (hooks, ev) => ((hooks || {})[ev] || []).some(g => (g.hooks || []).some(isClawdHook));
// 已经装了 Clawd hook 的事件
const clawdHookEvents = hooks => HOOK_EVENTS.filter(ev => hasClawdHook(hooks, ev));
// 旧版 hook 命令不带 App / tty / Claude App 会话 id(点小螃蟹没法跳转)
const clawdHooksStale = hooks => HOOK_EVENTS.some(ev => ((hooks || {})[ev] || []).some(g => (g.hooks || []).some(x => isClawdHook(x) && !x.command.includes('X-Clawd-Host'))));
// 只增删 Clawd 自己的那几条,别的 hooks 原样保留。mutate 拿到 set(ev, hook),hook 为 null 时只删掉 Clawd 的。改的是传进来的 cfg
function editHooks(cfg, mutate) {
  const hooks = cfg.hooks || {};
  const set = (ev, hook) => {
    const groups = (hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isClawdHook(h)) })).filter(g => g.hooks.length);
    if (hook) groups.push({ hooks: [{ type: 'command', ...hook }] });
    if (groups.length) hooks[ev] = groups; else delete hooks[ev];
  };
  mutate(set);
  if (Object.keys(hooks).length) cfg.hooks = hooks; else delete cfg.hooks;
  return cfg;
}

// ---------- hook 事件 ----------
// 工具名和一句话的"在干什么",只取很短的一段发给页面
const clip = (x, n) => { const t = String(x || '').split('\n')[0].trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function toolName(n) {
  n = String(n || '');
  const m = n.match(/^mcp__(.+?)__(.+)$/);   // MCP 工具:mcp__服务__工具 → 工具
  return m ? m[2] : n;
}
function toolDetail(n, input) {
  if (!input || typeof input !== 'object') return '';
  const base = p => (p ? path.basename(String(p)) : '');
  switch (n) {
    case 'Bash': {   // 命令短就直接显示命令(更直观),太长才用 Claude 写的说明
      const cmd = String(input.command || '').split('\n')[0].trim();
      return clip(cmd.length <= 32 || !input.description ? cmd : input.description, 40);
    }
    case 'Edit': case 'MultiEdit': case 'Write': case 'Read': return base(input.file_path);
    case 'NotebookEdit': return base(input.notebook_path);
    case 'Grep': case 'Glob': return clip(input.pattern, 30);
    case 'WebFetch': try { return new URL(input.url).hostname; } catch { return ''; }
    case 'WebSearch': return clip(input.query, 30);
    case 'Task': case 'Agent': return clip(input.subagent_type || input.description, 30);
    default: return '';
  }
}
// hook 请求头里带的 App bundle id / tty / Claude App 会话 id,格式不对的丢掉
function hookWhere(headers) {
  const appId = String(headers['x-clawd-app'] || '').trim(), tty = String(headers['x-clawd-tty'] || '').trim();
  const host = String(headers['x-clawd-host'] || '').trim();
  return { app: /^[\w.-]+$/.test(appId) ? appId : '', tty: /^ttys\d+$/.test(tty) ? tty : '', host: HOST_ID.test(host) ? host : '' };
}
// Claude Code 发来的 hook JSON → 发给页面的事件
function hookEvent(d, now = Date.now()) {
  return {
    event: String(d.hook_event_name || ''), session: String(d.session_id || ''),
    project: d.cwd ? path.basename(String(d.cwd)) : '', message: String(d.message || ''), at: now,
    ntype: String(d.notification_type || ''),
    tool: toolName(d.tool_name), detail: toolDetail(d.tool_name, d.tool_input), error: clip(d.error, 60),
    cmd: d.tool_name === 'Bash' ? String(d.tool_input?.command || '').replace(/\s+/g, ' ').slice(0, 500) : '',   // 认出跑测试 / git push / rm -rf,Clawd 做出反应
  };
}

// ---------- 会话记录(jsonl) ----------
// 上下文用了多少:最后一条主对话 assistant 消息的输入 + 输出 token(含缓存);在那之后压缩过,就用压缩后的大小
function contextUsed(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes('"subtype":"compact_boundary"')) { const m = l.match(/"postTokens":(\d+)/); return m ? Number(m[1]) : 0; }
    if (!l.includes('"usage"') || !l.includes('"type":"assistant"')) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }   // 第一行可能是被截断的半行
    const m = d.message, u = m?.usage;
    if (d.type !== 'assistant' || d.isSidechain || !u || m.model === '<synthetic>') continue;
    return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
  }
  return null;
}
// 上下文的「满」= 自动压缩的位置。window 是 CLAUDE_CODE_AUTO_COMPACT_WINDOW(由调用方读环境变量 / 配置);
// 没设就按 200k,已经超过 200k 的会话说明是 1M 窗口。Claude Code 会在窗口前留一段余量就开始压缩(实测 500k 窗口在 ~470k 时压缩)
const COMPACT_MARGIN = 33e3;
function contextFill(used, window) {
  let w = Number(window);
  if (!(w > 0)) w = used > 200e3 ? 1e6 : 200e3;
  return Math.round(used / (w - COMPACT_MARGIN) * 100) / 100;
}
// 会话停在哪一步:{ state, name, input, sid, cwd } 或 null(这一轮已经结束)
function runningStep(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/"type":"(user|assistant|system)"/.test(l)) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }   // 第一行可能是被截断的半行
    if (d.isSidechain || d.isMeta) continue;
    if (d.type === 'system') { if (['stop_hook_summary', 'turn_duration', 'api_error', 'local_command'].includes(d.subtype)) return null; continue; }
    const m = d.message, c = m?.content, at = { sid: d.sessionId, cwd: d.cwd };
    if (d.type === 'assistant') {
      if (m?.stop_reason && m.stop_reason !== 'tool_use') return null;   // end_turn 等:这一轮答完了
      const b = Array.isArray(c) && c[c.length - 1];
      return b && b.type === 'tool_use' ? { state: 'tool', name: b.name, input: b.input, ...at } : { state: 'thinking', ...at };
    }
    if (d.type !== 'user') continue;
    const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (typeof b.content === 'string' ? b.content : b.text || '')).join('') : '';
    if (/^\s*(<command-|<local-command|<bash-|\[Request interrupted)/.test(txt)) return null;   // 本地命令 / 你按了 Esc
    return { state: 'thinking', ...at };   // 刚发出指令,或工具结果回来了 Claude 还在想
  }
  return null;
}

// ---------- 在 Clawd 上批准权限 ----------
// 「总是允许」:把 Claude Code 给的建议原样交回去,和终端里选「不再询问」一样。只认放行规则、自动接受编辑、加工作目录这几种,
// 别的(比如切到跳过所有确认)不碰;按钮上写明放行了什么、记在哪。t 是界面翻译函数
const ALWAYS_SCOPE = { session: '本次会话', localSettings: '这个项目', projectSettings: '这个项目', userSettings: '所有项目' };
function alwaysAllow(sugs, t) {
  const list = (Array.isArray(sugs) ? sugs : []).filter(s => s && ALWAYS_SCOPE[s.destination] && (
    (s.type === 'addRules' && s.behavior === 'allow' && Array.isArray(s.rules) && s.rules.length && s.rules.every(r => typeof r?.toolName === 'string'))
    || (s.type === 'setMode' && s.mode === 'acceptEdits')
    || (s.type === 'addDirectories' && Array.isArray(s.directories) && s.directories.length)));
  if (!list.length) return null;
  const what = list.map(s => (s.type === 'addRules' ? s.rules.map(r => (r.ruleContent ? `${toolName(r.toolName)}(${r.ruleContent})` : toolName(r.toolName))).join(', ')
    : s.type === 'setMode' ? t('自动接受编辑') : t('访问 {0}', s.directories.map(d => path.basename(String(d))).join(', '))));
  return { list, label: `${clip(what.join(' · '), 44)} · ${t(ALWAYS_SCOPE[list[0].destination])}` };
}
// 给 Claude Code 的批准结果,null 表示没表态(交回终端照常弹框)。p 是待批准的那一条:{ input?, always? }
// 选择题(AskUserQuestion):答案放进 updatedInput.answers 交回去,Claude Code 就不再弹题;自己写的回答原样当答案。
// 总是允许:带上放行规则;拒绝时写了原因,就一起告诉 Claude
function permDecision(p, behavior, answers, message) {
  return p.input && answers ? { behavior: 'allow', updatedInput: { ...p.input, answers } }
    : behavior === 'always' && p.always ? { behavior: 'allow', updatedPermissions: p.always }
    : behavior === 'deny' && message ? { behavior: 'deny', message }
    : behavior === 'allow' || behavior === 'deny' ? { behavior } : null;
}
const permReplyBody = decision => (decision ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }) : '');

module.exports = {
  HOOK_EVENTS, HOOK_MARK, HOST_ID,
  isClawdHook, hasClawdHook, clawdHookEvents, clawdHooksStale, editHooks,
  clip, toolName, toolDetail, hookWhere, hookEvent,
  contextUsed, contextFill, COMPACT_MARGIN, runningStep,
  ALWAYS_SCOPE, alwaysAllow, permDecision, permReplyBody,
};
