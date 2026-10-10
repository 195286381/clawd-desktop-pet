// cc.js(和 Claude Code 联动的 hooks 逻辑)的单元测试:node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const cc = require('../cc');

const CMD = `curl ... -H "X-Clawd-Host: $CLAUDE_CODE_HOST_SESSION_ID" http://127.0.0.1:47615/hook # ${cc.HOOK_MARK}`;
const OLD_CMD = `curl ... http://127.0.0.1:47615/hook # ${cc.HOOK_MARK}`;
const other = { type: 'command', command: 'say done' };

test('editHooks:装上 Clawd 的 hook,别的 hooks 和配置原样保留', () => {
  const cfg = { model: 'opus', hooks: { Stop: [{ matcher: '', hooks: [other] }], Custom: [{ hooks: [other] }] } };
  cc.editHooks(cfg, set => { for (const ev of cc.HOOK_EVENTS) set(ev, { command: CMD, async: true, timeout: 5 }); });
  assert.equal(cfg.model, 'opus');
  assert.deepEqual(cfg.hooks.Custom, [{ hooks: [other] }]);
  assert.deepEqual(cfg.hooks.Stop, [{ matcher: '', hooks: [other] }, { hooks: [{ type: 'command', command: CMD, async: true, timeout: 5 }] }]);
  assert.deepEqual(cc.clawdHookEvents(cfg.hooks), cc.HOOK_EVENTS);
  assert.equal(cc.clawdHooksStale(cfg.hooks), false);
});

test('editHooks:重复装不会叠加,卸掉后只剩别人的,空了就删掉 hooks 字段', () => {
  const cfg = { hooks: { Stop: [{ hooks: [other] }] } };
  const on = set => { for (const ev of cc.HOOK_EVENTS) set(ev, { command: CMD }); };
  cc.editHooks(cfg, on);
  cc.editHooks(cfg, on);
  assert.equal(cfg.hooks.Stop.length, 2);
  assert.equal(cfg.hooks.PreToolUse.length, 1);

  cc.editHooks(cfg, set => { for (const ev of cc.HOOK_EVENTS) set(ev, null); });
  assert.deepEqual(cfg, { hooks: { Stop: [{ hooks: [other] }] } });

  const empty = {};
  cc.editHooks(empty, on);
  cc.editHooks(empty, set => { for (const ev of cc.HOOK_EVENTS) set(ev, null); });
  assert.deepEqual(empty, {});
});

test('editHooks:和别人的 hook 在同一组里时只删 Clawd 那条', () => {
  const cfg = { hooks: { Stop: [{ matcher: '*', hooks: [other, { type: 'command', command: CMD }] }] } };
  cc.editHooks(cfg, set => set('Stop', null));
  assert.deepEqual(cfg.hooks.Stop, [{ matcher: '*', hooks: [other] }]);
});

test('认出装了哪些、旧版命令、批准权限', () => {
  const hooks = { Stop: [{ hooks: [{ command: OLD_CMD }] }], PreToolUse: [{ hooks: [other] }], PermissionRequest: [{ hooks: [{ command: CMD }] }] };
  assert.deepEqual(cc.clawdHookEvents(hooks), ['Stop']);
  assert.equal(cc.clawdHooksStale(hooks), true);
  assert.equal(cc.hasClawdHook(hooks, 'PermissionRequest'), true);
  assert.equal(cc.hasClawdHook(hooks, 'PreToolUse'), false);
  assert.deepEqual(cc.clawdHookEvents(undefined), []);
  assert.equal(cc.clawdHooksStale(null), false);
  assert.equal(cc.hasClawdHook(undefined, 'Stop'), false);
  assert.equal(cc.isClawdHook({ command: 42 }), false);
});

test('clip / toolName', () => {
  assert.equal(cc.clip('第一行\n第二行', 10), '第一行');
  assert.equal(cc.clip('abcdefghij', 5), 'abcd…');
  assert.equal(cc.clip(null, 5), '');
  assert.equal(cc.toolName('mcp__github__create_pull_request'), 'create_pull_request');
  assert.equal(cc.toolName('Bash'), 'Bash');
  assert.equal(cc.toolName(undefined), '');
});

test('toolDetail:各工具显示的那一小段', () => {
  assert.equal(cc.toolDetail('Bash', { command: 'npm test\nmore', description: '跑测试' }), 'npm test');
  assert.equal(cc.toolDetail('Bash', { command: 'x'.repeat(40), description: '跑一个很长的命令' }), '跑一个很长的命令');
  assert.equal(cc.toolDetail('Bash', { command: 'y'.repeat(50) }), 'y'.repeat(39) + '…');
  assert.equal(cc.toolDetail('Edit', { file_path: '/a/b/main.js' }), 'main.js');
  assert.equal(cc.toolDetail('NotebookEdit', { notebook_path: '/a/n.ipynb' }), 'n.ipynb');
  assert.equal(cc.toolDetail('Grep', { pattern: 'TODO' }), 'TODO');
  assert.equal(cc.toolDetail('WebFetch', { url: 'https://example.com/x?y' }), 'example.com');
  assert.equal(cc.toolDetail('WebFetch', { url: 'not a url' }), '');
  assert.equal(cc.toolDetail('WebSearch', { query: 'three.js' }), 'three.js');
  assert.equal(cc.toolDetail('Agent', { description: '查代码' }), '查代码');
  assert.equal(cc.toolDetail('Unknown', { a: 1 }), '');
  assert.equal(cc.toolDetail('Read', null), '');
});

test('hookWhere:只收格式对的 App / tty / 会话 id', () => {
  assert.deepEqual(cc.hookWhere({ 'x-clawd-app': ' com.googlecode.iterm2 ', 'x-clawd-tty': 'ttys003', 'x-clawd-host': 'local_abc-123' }),
    { app: 'com.googlecode.iterm2', tty: 'ttys003', host: 'local_abc-123' });
  assert.deepEqual(cc.hookWhere({ 'x-clawd-app': 'a"; rm -rf /', 'x-clawd-tty': '??', 'x-clawd-host': 'evil' }), { app: '', tty: '', host: '' });
  assert.deepEqual(cc.hookWhere({}), { app: '', tty: '', host: '' });
  assert.equal(cc.hookWhere({ 'x-clawd-host': 'local_' + 'a'.repeat(65) }).host, '');
});

test('hookEvent:把 Claude Code 的 hook JSON 整理成页面要的事件', () => {
  const ev = cc.hookEvent({
    hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/Users/me/clawd-pet', tool_name: 'Bash',
    tool_input: { command: 'npm   test\n  --watch' }, transcript_path: '/x.jsonl',
  }, 123);
  assert.deepEqual(ev, { event: 'PreToolUse', session: 's1', project: 'clawd-pet', message: '', at: 123, ntype: '', agent: '',
    tool: 'Bash', detail: 'npm   test', error: '', source: '', stitle: '', cmd: 'npm test --watch' });

  const n = cc.hookEvent({ hook_event_name: 'Notification', message: 'Claude needs your permission', notification_type: 'permission_prompt' }, 1);
  assert.equal(n.ntype, 'permission_prompt');
  assert.equal(n.project, '');
  assert.equal(n.cmd, '');

  const sub = cc.hookEvent({ hook_event_name: 'SubagentStart', session_id: 's1', agent_id: 'agent-7', agent_type: 'Explore' }, 1);
  assert.equal(sub.agent, 'agent-7');                                   // 子助手驮在螃蟹背上:靠 agent id 配对开始 / 结束
  assert.ok(cc.HOOK_EVENTS.includes('SubagentStart') && cc.HOOK_EVENTS.includes('SubagentStop'));

  const f = cc.hookEvent({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__x__y', error: 'e'.repeat(100) }, 1);
  assert.equal(f.tool, 'y');
  assert.equal(f.error.length, 60);
  assert.equal(cc.hookEvent({ tool_name: 'Bash', tool_input: { command: 'z'.repeat(600) } }).cmd.length, 500);
});

test('hookEvent:SessionStart 带上怎么开的和会话标题;StopFailure 带上出错原因', () => {
  assert.ok(cc.HOOK_EVENTS.includes('SessionStart'));
  const st = cc.hookEvent({ hook_event_name: 'SessionStart', session_id: 's1', source: 'resume', session_title: '修登录 bug' }, 1);
  assert.equal(st.source, 'resume');
  assert.equal(st.stitle, '修登录 bug');
  const sf = cc.hookEvent({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests' }, 1);
  assert.equal(sf.error, 'rate_limit');
});

test('statusCmd / statusOrig:包上原来的状态栏命令,能原样取回(含单引号、#、~)', () => {
  for (const orig of [`jq -r '"\\(.model.display_name) \\(.context_window.used_percentage // 0)%"'`, `echo "it's # fine"; echo two`, '~/.claude/statusline.sh', '']) {
    const cmd = cc.statusCmd(orig, 47615);
    assert.ok(cmd.includes(cc.STATUS_MARK) && cmd.includes('127.0.0.1:47615/status'));
    assert.equal(cc.statusOrig(cmd), orig);
  }
  assert.ok(!cc.statusCmd('', 1).includes('eval'));   // 原来没有状态栏:只转发,不显示东西
});

test('setStatusLine:打开时保留原来的设置,关掉时换回原样;原来没有就删掉', () => {
  const cfg = { model: 'opus', statusLine: { type: 'command', command: '~/.claude/sl.sh', padding: 2 } };
  cc.setStatusLine(cfg, true, 47615);
  assert.ok(cc.isClawdStatus(cfg.statusLine));
  assert.equal(cfg.statusLine.padding, 2);
  cc.setStatusLine(cfg, true, 47616);   // 再打开一次:不会包两层,只换端口
  assert.equal(cc.statusOrig(cfg.statusLine.command), '~/.claude/sl.sh');
  assert.ok(cfg.statusLine.command.includes(':47616/'));
  cc.setStatusLine(cfg, false);
  assert.deepEqual(cfg, { model: 'opus', statusLine: { type: 'command', command: '~/.claude/sl.sh', padding: 2 } });

  const bare = {};
  cc.setStatusLine(bare, true, 47615);
  assert.equal(bare.statusLine.type, 'command');
  cc.setStatusLine(bare, false);
  assert.deepEqual(bare, {});

  const mine = { statusLine: { type: 'command', command: 'echo hi' } };   // 不是 Clawd 包的:关掉时不碰
  cc.setStatusLine(mine, false);
  assert.deepEqual(mine, { statusLine: { type: 'command', command: 'echo hi' } });
});

test('statusInfo:状态栏数据里取出额度和上下文用量', () => {
  const s = cc.statusInfo({ session_id: 's1', context_window: { used_percentage: 25, context_window_size: 200000 },
    rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } } });
  assert.equal(s.session, 's1');
  assert.deepEqual(s.ctx, { used: 50000, size: 200000 });
  assert.deepEqual(s.limits.fiveHour, { key: 'session', used: 23.5, remaining: 76.5, resetsAt: 1738425600000, resetText: '' });
  assert.equal(s.limits.sevenDay.remaining, 100 - 41.2);

  const api = cc.statusInfo({ session_id: 's2', context_window: { used_percentage: null, context_window_size: 200000 } });   // API Key:没有额度;第一次回复前上下文还是 null
  assert.equal(api.limits, null);
  assert.equal(api.ctx, null);
  assert.equal(cc.statusInfo({ rate_limits: { seven_day: { used_percentage: 10 } } }).limits.fiveHour, null);
});

const asst = (o) => JSON.stringify({ type: 'assistant', sessionId: 'sid', cwd: '/p', ...o });
const user = (content, o) => JSON.stringify({ type: 'user', sessionId: 'sid', cwd: '/p', message: { content }, ...o });

test('contextUsed:取最后一条主对话的用量,压缩过就用压缩后的大小', () => {
  const usage = (n) => asst({ message: { model: 'claude-opus-5', usage: { input_tokens: n, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 1 } } });
  assert.equal(cc.contextUsed([usage(100), usage(200)].join('\n')), 216);
  assert.equal(cc.contextUsed([usage(100), asst({ isSidechain: true, message: { usage: { input_tokens: 9e5 } } })].join('\n')), 116);
  assert.equal(cc.contextUsed([usage(100), asst({ message: { model: '<synthetic>', usage: { input_tokens: 9 } } })].join('\n')), 116);
  assert.equal(cc.contextUsed([usage(100), '{"type":"system","subtype":"compact_boundary","compactMetadata":{"postTokens":4321}}'].join('\n')), 4321);
  assert.equal(cc.contextUsed('ial line "usage" "type":"assistant"\n'), null);   // 截断的半行
  assert.equal(cc.contextUsed(''), null);
});

test('contextFill:按自动压缩的位置算有多满', () => {
  assert.equal(cc.contextFill(83500, 0), 0.5);                          // 默认 200k 窗口
  assert.equal(cc.contextFill(483500, undefined), 0.5);                 // 超过 200k 说明是 1M 窗口
  assert.equal(cc.contextFill(233500, 500e3), 0.5);
  assert.equal(cc.contextFill(83500, 'abc'), 0.5);
});

test('runningStep:会话停在调用工具 / 还在想 / 这一轮已经结束', () => {
  const toolUse = asst({ message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } });
  assert.deepEqual(cc.runningStep(toolUse), { state: 'tool', name: 'Bash', input: { command: 'ls' }, sid: 'sid', cwd: '/p' });
  assert.deepEqual(cc.runningStep(asst({ message: { content: [{ type: 'text', text: '...' }] } })), { state: 'thinking', sid: 'sid', cwd: '/p' });
  assert.equal(cc.runningStep(asst({ message: { stop_reason: 'end_turn', content: [] } })), null);

  assert.deepEqual(cc.runningStep([toolUse, user([{ type: 'tool_result', content: 'files' }])].join('\n')), { state: 'thinking', sid: 'sid', cwd: '/p' });
  assert.deepEqual(cc.runningStep(user('帮我改个 bug')), { state: 'thinking', sid: 'sid', cwd: '/p' });
  assert.equal(cc.runningStep(user('<command-name>/clear</command-name>')), null);
  assert.equal(cc.runningStep(user([{ type: 'text', text: '[Request interrupted by user]' }])), null);

  // 子助手、meta 消息和截断的半行跳过,往前找
  assert.equal(cc.runningStep([asst({ message: { stop_reason: 'end_turn' } }), user('x', { isSidechain: true }), user('y', { isMeta: true }), 'broken "type":"user"'].join('\n')), null);
  assert.equal(cc.runningStep([user('hi'), '{"type":"system","subtype":"turn_duration"}'].join('\n')), null);
  assert.deepEqual(cc.runningStep([user('hi'), '{"type":"system","subtype":"informational"}'].join('\n')).state, 'thinking');
  assert.equal(cc.runningStep('{"type":"summary"}'), null);
});

const t = (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);   // 测试里不翻译,只填参数

test('alwaysAllow:只认放行规则、自动接受编辑和加目录', () => {
  const r = cc.alwaysAllow([
    { type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }, { toolName: 'mcp__gh__list' }] },
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
    { type: 'addRules', behavior: 'deny', destination: 'session', rules: [{ toolName: 'Bash' }] },
    { type: 'addDirectories', destination: 'userSettings', directories: ['/Users/me/work'] },
    { type: 'addRules', behavior: 'allow', destination: 'cliArg', rules: [{ toolName: 'Bash' }] },
    null,
  ], t);
  assert.equal(r.list.length, 3);
  assert.equal(r.label, 'Bash(npm test:*), list · 自动接受编辑 · 访问 work · 这个项目');
});

test('alwaysAllow:没有能用的建议时返回 null,长的说明会截短', () => {
  assert.equal(cc.alwaysAllow(undefined, t), null);
  assert.equal(cc.alwaysAllow([{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }], t), null);
  assert.equal(cc.alwaysAllow([{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [] }], t), null);
  assert.equal(cc.alwaysAllow([{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 1 }] }], t), null);
  const long = cc.alwaysAllow([{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Bash', ruleContent: 'x'.repeat(80) }] }], t);
  assert.equal(long.label, `Bash(${'x'.repeat(38)}… · 本次会话`);
});

test('permDecision / permReplyBody:批准、拒绝、总是允许、选择题、没表态', () => {
  const body = (d) => JSON.parse(cc.permReplyBody(d));
  assert.deepEqual(body(cc.permDecision({}, 'allow')), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.deepEqual(cc.permDecision({}, 'deny'), { behavior: 'deny' });
  assert.deepEqual(cc.permDecision({}, 'deny', null, '换个办法'), { behavior: 'deny', message: '换个办法' });
  const rules = [{ type: 'addRules' }];
  assert.deepEqual(cc.permDecision({ always: rules }, 'always'), { behavior: 'allow', updatedPermissions: rules });
  assert.equal(cc.permDecision({}, 'always'), null);                    // 没有可用的放行规则
  const input = { questions: [{ question: '选哪个?' }] };
  assert.deepEqual(cc.permDecision({ input }, 'allow', { '选哪个?': 'A' }), { behavior: 'allow', updatedInput: { ...input, answers: { '选哪个?': 'A' } } });
  assert.equal(cc.permDecision({}, ''), null);                          // 超时 / 去终端处理
  assert.equal(cc.permReplyBody(null), '');
});
