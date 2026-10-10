// usage.js 的单元测试:node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UsageTracker, parseUsage, parseReset, priceFor, listJsonl, projectDirs, _eta } = require('../usage');

const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;

test('priceFor:去掉前缀 / 日期 / [1m] 后查表,查不到按系列估算', () => {
  assert.deepEqual(priceFor('claude-opus-5-5'), [4, 20, 5, 8, 0.20]);
  assert.deepEqual(priceFor('anthropic.claude-sonnet-4-6'), [3, 15, 3.75, 6, 0.3]);
  assert.deepEqual(priceFor('claude-haiku-4-5-20251001'), [1, 5, 1.25, 2, 0.1]);
  assert.deepEqual(priceFor('claude-opus-5-5[1m]'), [4, 20, 5, 8, 0.20]);
  assert.deepEqual(priceFor('claude-3-opus-20240229'), priceFor('claude-opus-5'));   // 旧模型按系列
  assert.equal(priceFor('gpt-4'), null);
  assert.equal(priceFor(''), null);
  assert.equal(priceFor(undefined), null);
});

test('parseReset:只给时刻时指下一次', () => {
  const now = new Date(2026, 9, 10, 9, 0).getTime();
  assert.equal(parseReset('12:10am (Asia/Taipei)', now), new Date(2026, 9, 11, 0, 10).getTime());   // 已过 → 明天
  assert.equal(parseReset('3pm', now), new Date(2026, 9, 10, 15, 0).getTime());                    // 还没到 → 今天
  assert.equal(parseReset('12pm', now), new Date(2026, 9, 10, 12, 0).getTime());
});

test('parseReset:带日期,跨年时算到明年', () => {
  const now = new Date(2026, 9, 10, 9, 0).getTime();
  assert.equal(parseReset('Oct 12 at 10am (Asia/Taipei)', now), new Date(2026, 9, 12, 10, 0).getTime());
  assert.equal(parseReset('October 12 at 10:30pm', now), new Date(2026, 9, 12, 22, 30).getTime());
  assert.equal(parseReset('Oct 12, 2027 at 1am', now), new Date(2027, 9, 12, 1, 0).getTime());
  const dec = new Date(2026, 11, 30, 12, 0).getTime();
  assert.equal(parseReset('Jan 2 at 9am', dec), new Date(2027, 0, 2, 9, 0).getTime());
});

test('parseReset:空的或看不懂的返回 0', () => {
  assert.equal(parseReset('', Date.now()), 0);
  assert.equal(parseReset(undefined, Date.now()), 0);
  assert.equal(parseReset('soon', Date.now()), 0);
});

test('parseUsage:认出 5 小时、本周和其他窗口', () => {
  const now = new Date(2026, 9, 6, 20, 0).getTime();
  const out = [
    'Some header',
    '  Current session: 67% used · resets Oct 7 at 12:10am (Asia/Taipei)',
    'Current week (all models): 18% used · resets Oct 9 at 10am (Asia/Taipei)',
    'Current week (Opus): 2.5% used',
    'unrelated: 50% used',
  ].join('\n');
  const u = parseUsage(out, now);
  assert.equal(u.savedAt, now);
  assert.equal(u.fiveHour.used, 67);
  assert.equal(u.fiveHour.remaining, 33);
  assert.equal(u.fiveHour.resetsAt, new Date(2026, 9, 7, 0, 10).getTime());
  assert.equal(u.fiveHour.resetText, 'Oct 7 at 12:10am (Asia/Taipei)');
  assert.equal(u.sevenDay.key, 'week (all models)');
  assert.equal(u.sevenDay.used, 18);
  assert.equal(u.others.length, 1);
  assert.equal(u.others[0].key, 'week (Opus)');
  assert.equal(u.others[0].used, 2.5);
  assert.equal(u.others[0].resetsAt, 0);
});

test('parseUsage:只有 "Current week" 也算本周;用超了剩余记 0', () => {
  const u = parseUsage('Current week: 104% used', Date.now());
  assert.equal(u.fiveHour, null);
  assert.equal(u.sevenDay.used, 104);
  assert.equal(u.sevenDay.remaining, 0);
});

test('parseUsage:没有额度信息(比如不是订阅)返回 null', () => {
  assert.equal(parseUsage('', Date.now()), null);
  assert.equal(parseUsage('/usage is only available for subscription plans', Date.now()), null);
});

test('用完时间预测:至少 10 分钟、在涨才预测', () => {
  const { recordSample, etaMinutes } = _eta;
  const t0 = new Date(2026, 9, 10, 9, 0).getTime(), resetsAt = t0 + 3 * HOUR;
  recordSample({ used: 10, resetsAt: resetsAt + HOUR }, t0 - HOUR);   // 上一个窗口的样本:换窗口时清掉
  recordSample({ used: 20, resetsAt }, t0);
  assert.equal(etaMinutes({ used: 20 }, t0), null);                     // 只有一个样本
  recordSample({ used: 22, resetsAt }, t0 + 5 * MIN);
  assert.equal(etaMinutes({ used: 22 }, t0 + 5 * MIN), null);           // 不到 10 分钟
  recordSample({ used: 30, resetsAt }, t0 + 20 * MIN);
  // 20 分钟涨了 10% → 每分钟 0.5%,剩 70% → 140 分钟
  assert.equal(etaMinutes({ used: 30 }, t0 + 20 * MIN), 140);
  assert.equal(etaMinutes(null, t0), null);
});

test('用完时间预测:没在涨不预测', () => {
  const { recordSample, etaMinutes } = _eta;
  const t0 = new Date(2027, 0, 1, 9, 0).getTime(), resetsAt = t0 + 4 * HOUR;
  recordSample({ used: 40, resetsAt }, t0);
  recordSample({ used: 40, resetsAt }, t0 + 30 * MIN);
  assert.equal(etaMinutes({ used: 40 }, t0 + 30 * MIN), null);
});

// 一条 Claude Code 会话记录里的 assistant 消息
const line = (o) => JSON.stringify({
  type: 'assistant', timestamp: new Date(o.t).toISOString(), requestId: o.req ?? 'req_' + o.id,
  message: { id: o.id, model: o.model || 'claude-sonnet-4-6', usage: o.usage || { input_tokens: 1000, output_tokens: 1000 } },
});

test('UsageTracker.ingest:按价格表算花费,含缓存和快速模式', () => {
  const u = new UsageTracker(), now = Date.now();
  u.ingest(line({ id: 'a', t: now, model: 'claude-sonnet-4-6', usage: {
    input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6,
    cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } } }), 0);
  assert.equal(u.entries.length, 1);
  assert.equal(u.entries[0].cost, 3 + 15 + 3.75 + 6 + 0.3);
  assert.equal(u.entries[0].known, true);

  u.ingest(line({ id: 'b', t: now, usage: { input_tokens: 1e6, cache_creation_input_tokens: 1e6, speed: 'fast' } }), 0);
  assert.equal(u.entries[1].cw5, 1e6);                                  // 旧格式只有总数,当 5 分钟缓存
  assert.equal(u.entries[1].cost, (3 + 3.75) * 2);

  u.ingest(line({ id: 'c', t: now, model: 'some-other-model' }), 0);
  assert.equal(u.entries[2].cost, 0);
  assert.equal(u.entries[2].known, false);
});

test('UsageTracker.ingest:跳过重复、太旧、合成消息和不是 assistant 的行', () => {
  const u = new UsageTracker(), now = Date.now();
  u.ingest(line({ id: 'a', t: now }), 0);
  u.ingest(line({ id: 'a', t: now }), 0);                                // 同一 message.id + requestId 只算一次
  u.ingest(line({ id: 'a', req: 'other', t: now }), 0);                  // requestId 不同就是另一条
  u.ingest(line({ id: 'old', t: now - 10 * DAY }), now - 8 * DAY);
  u.ingest(line({ id: 's', t: now, model: '<synthetic>' }), 0);
  u.ingest(JSON.stringify({ type: 'user', timestamp: new Date(now).toISOString(), message: { usage: {} } }), 0);
  u.ingest('{"usage": broken json', 0);
  u.ingest('{"type":"assistant"}', 0);                                   // 没有 usage,直接跳过
  assert.equal(u.entries.length, 2);
});

test('UsageTracker.summary:今天、近 7 天、5 小时窗口、按模型拆分', () => {
  const u = new UsageTracker(), now = Date.now();
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const add = (id, t, model) => u.ingest(line({ id, t, model, usage: { input_tokens: 1e6, output_tokens: 0 } }), 0);
  add('w', now - 3 * DAY, 'claude-haiku-4-5');
  add('x', now - 2 * MIN, 'claude-sonnet-4-6');
  add('y', now - 1 * MIN, 'claude-haiku-4-5');
  u.entries.sort((a, b) => a.t - b.t);
  const s = u.summary();

  assert.equal(s.week.messages, 3);
  assert.equal(s.week.tokens, 3e6);
  assert.equal(s.week.cost, 1 + 3 + 1);
  const todayCount = [now - 2 * MIN, now - MIN].filter(t => t >= midnight.getTime()).length;
  assert.equal(s.today.messages, todayCount);

  assert.ok(s.block, '最近几分钟有消息,应该在一个 5 小时窗口里');
  assert.equal(s.block.messages, 2);
  assert.equal(s.block.cost, 4);
  assert.equal(s.block.end - s.block.start, 5 * HOUR);
  assert.equal(new Date(s.block.start).getMinutes(), 0);                // 从整点开始

  assert.equal(s.lastActive, now - MIN);
  assert.equal(s.streakStart, now - 2 * MIN);                           // 两条间隔不到 10 分钟,算同一段
  assert.equal(s.limits, null);
  if (todayCount === 2) assert.deepEqual(Object.keys(s.byModel).sort(), ['haiku-4-5', 'sonnet-4-6']);
});

test('UsageTracker.summary:没有记录时', () => {
  const s = new UsageTracker().summary();
  assert.deepEqual(s.today, { cost: 0, tokens: 0, output: 0, messages: 0 });
  assert.equal(s.block, null);
  assert.equal(s.lastActive, null);
  assert.equal(s.streakStart, null);
});

test('UsageTracker.costSince', () => {
  const u = new UsageTracker(), now = Date.now();
  u.ingest(line({ id: 'a', t: now - HOUR, usage: { input_tokens: 1e6 } }), 0);
  u.ingest(line({ id: 'b', t: now - 3 * HOUR, usage: { input_tokens: 1e6 } }), 0);
  assert.equal(u.costSince(now - 2 * HOUR), 3);
  assert.equal(u.costSince(0), 6);
});

test('scan:从 CLAUDE_CONFIG_DIR 读会话记录,增量读、半行等写完再算', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-usage-'));
  const home = os.homedir, oldEnv = process.env.CLAUDE_CONFIG_DIR;
  t.after(() => {
    os.homedir = home;
    if (oldEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = oldEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  os.homedir = () => path.join(tmp, 'home');                            // 别读到本机真正的 ~/.claude
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'cfg');
  const dir = path.join(tmp, 'cfg', 'projects', 'my-project');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  const file = path.join(dir, 'session.jsonl'), now = Date.now();
  fs.writeFileSync(path.join(dir, 'notes.txt'), line({ id: 'ignored', t: now }) + '\n');

  assert.deepEqual(projectDirs(), [path.join(tmp, 'cfg', 'projects')]);
  const half = line({ id: 'b', t: now });
  fs.writeFileSync(file, line({ id: 'a', t: now - MIN }) + '\n' + half.slice(0, 20));
  fs.writeFileSync(path.join(dir, 'sub', 'agent.jsonl'), '');
  assert.deepEqual(listJsonl(path.join(tmp, 'cfg')).map(p => path.relative(dir, p)).sort(), ['session.jsonl', path.join('sub', 'agent.jsonl')]);

  const u = new UsageTracker();
  u.scan();
  assert.equal(u.entries.length, 1);
  fs.appendFileSync(file, half.slice(20) + '\n');
  u.scan();
  assert.deepEqual(u.entries.map(e => e.t), [now - MIN, now]);
  u.scan();                                                             // 文件没变:不重复计
  assert.equal(u.entries.length, 2);
});
