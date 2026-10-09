// Claude Code 本地用量统计
// 读取 ~/.claude/projects/**/*.jsonl(Claude Code 的会话记录),每条 assistant 消息都带有 usage 字段。
// 纯本地、只读,不需要任何账号凭证。花费是按 Anthropic API 公开价格估算的,
// 不是订阅账单 —— 用订阅套餐时实际不按这个收费,只作为"用了多少"的参考。
const fs = require('fs');
const path = require('path');
const os = require('os');

// 每百万 token 的价格(美元):[输入, 输出, 5 分钟缓存写入, 1 小时缓存写入, 缓存读取]
// 来源:Anthropic 官方价格(2026-09);缓存写入 = 输入 × 1.25 / × 2,缓存读取一般 = 输入 × 0.1
const PRICES = {
  'claude-fable-5-1':  [10, 50, 12.5, 20, 0.25],
  'claude-mythos-5-1': [10, 50, 12.5, 20, 0.25],
  'claude-fable-5':    [10, 50, 12.5, 20, 1.0],
  'claude-opus-5-5':   [4, 20, 5, 8, 0.20],
  'claude-opus-5':     [5, 25, 6.25, 10, 0.5],
  'claude-opus-4-8':   [5, 25, 6.25, 10, 0.5],
  'claude-opus-4-7':   [5, 25, 6.25, 10, 0.5],
  'claude-opus-4-6':   [5, 25, 6.25, 10, 0.5],
  'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.2],
  'claude-sonnet-5':   [2, 10, 2.5, 4, 0.2],
  'claude-sonnet-4-6': [3, 15, 3.75, 6, 0.3],
  'claude-haiku-4-5':  [1, 5, 1.25, 2, 0.1],
};
// 表里没有的旧模型:按系列粗略估算
const FAMILY = { fable: PRICES['claude-fable-5'], opus: PRICES['claude-opus-5'], sonnet: PRICES['claude-sonnet-4-6'], haiku: PRICES['claude-haiku-4-5'] };

function priceFor(model) {
  if (!model) return null;
  const id = model.replace(/^anthropic\./, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '');
  if (PRICES[id]) return PRICES[id];
  for (const [k, p] of Object.entries(FAMILY)) if (id.includes(k)) return p;
  return null;
}

const DAY = 24 * 3600e3, BLOCK = 5 * 3600e3, KEEP = 8 * DAY;

// ---------------- 订阅额度(和 Claude Code 里 /usage 显示的一样) ----------------
// 调用官方命令行 `claude -p "/usage"`:它只向服务器查询额度,不调用模型、不消耗额度;
// 加 --no-session-persistence 不留会话记录。Clawd 自己不读取任何登录凭证。
const { execFile, execFileSync } = require('child_process');

let claudeBin;
function findClaude() {
  if (claudeBin !== undefined) return claudeBin;
  const home = os.homedir();
  const candidates = [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.claude/local/claude')];
  claudeBin = candidates.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
  if (!claudeBin) {
    // 从桌面启动的 App 的 PATH 很短,借登录 shell 找一下
    try { claudeBin = execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 8000 }).trim() || null; } catch { claudeBin = null; }
  }
  return claudeBin;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "Oct 7 at 12:10am (Asia/Taipei)" / "12:10am (Asia/Taipei)" / "Oct 9 at 10am" -> 毫秒时间戳(本机时区)
function parseReset(text, now) {
  if (!text) return 0;
  const m = text.match(/(?:([A-Z][a-z]{2})\w*\s+(\d{1,2})(?:,\s*(\d{4}))?\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return 0;
  let h = parseInt(m[4], 10) % 12;
  if (m[6].toLowerCase() === 'pm') h += 12;
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(h, m[5] ? parseInt(m[5], 10) : 0);
  if (m[1] && MONTHS[m[1].toLowerCase()] !== undefined) {
    d.setFullYear(m[3] ? parseInt(m[3], 10) : d.getFullYear(), MONTHS[m[1].toLowerCase()], parseInt(m[2], 10));
    if (!m[3] && d.getTime() < now - 2 * 24 * 3600e3) d.setFullYear(d.getFullYear() + 1);   // 跨年
  } else if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1);                                                              // 只给了时刻:指下一次
  }
  return d.getTime();
}

// 解析 /usage 输出,例如:
//   Current session: 67% used · resets Oct 7 at 12:10am (Asia/Taipei)
//   Current week (all models): 18% used · resets Oct 9 at 10am (Asia/Taipei)
function parseUsage(text, now) {
  const windows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*Current\s+(.+?):\s*([\d.]+)%\s*used(?:\s*·\s*resets\s+(.+))?\s*$/i);
    if (!m) continue;
    const used = parseFloat(m[2]);
    windows.push({ key: m[1].trim(), used, remaining: Math.max(0, 100 - used), resetsAt: parseReset(m[3], now), resetText: (m[3] || '').trim() });
  }
  if (!windows.length) return null;
  const find = (re) => windows.find(w => re.test(w.key)) || null;
  return {
    fiveHour: find(/^session$/i),
    sevenDay: find(/^week\s*\(all/i) || find(/^week$/i),
    others: windows.filter(w => !/^session$/i.test(w.key) && !/^week\s*\(all/i.test(w.key) && !/^week$/i.test(w.key)),
    savedAt: now,
  };
}

let limitsCache = null, limitsError = null, fetching = null;

// 用完时间预测:记录每次查到的 5 小时额度,按最近 10~90 分钟内的增长速度推算还能撑多久
const samples = [];   // { t, used, resetsAt }
function recordSample(w, now) {
  if (!w) return;
  // 换了一个 5 小时窗口(重置时间变了)就重新记
  if (samples.length && Math.abs(samples[samples.length - 1].resetsAt - w.resetsAt) > 5 * 60e3) samples.length = 0;
  samples.push({ t: now, used: w.used, resetsAt: w.resetsAt });
  while (samples.length && now - samples[0].t > 90 * 60e3) samples.shift();
}
function etaMinutes(w, now) {
  if (!w || samples.length < 2) return null;
  const last = samples[samples.length - 1];
  const first = samples.find(x => last.t - x.t >= 10 * 60e3) ? samples[0] : null;
  if (!first || last.used <= first.used) return null;            // 时间太短或没在涨:不预测
  const perMin = (last.used - first.used) / ((last.t - first.t) / 60e3);
  return Math.max(0, Math.round((100 - w.used) / perMin));
}
function fetchLimits() {
  if (fetching) return fetching;
  const bin = findClaude();
  if (!bin) { limitsError = 'no-cli'; return Promise.resolve(null); }
  fetching = new Promise(resolve => {
    execFile(bin, ['-p', '/usage', '--no-session-persistence'],
      { cwd: os.tmpdir(), timeout: 45000, maxBuffer: 1 << 20, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout) => {
        fetching = null;
        const parsed = !err && stdout ? parseUsage(stdout, Date.now()) : null;
        if (parsed) { limitsCache = parsed; limitsError = null; recordSample(parsed.fiveHour, parsed.savedAt); }
        else limitsError = err ? 'failed' : 'no-sub';   // 错误代码,渲染进程按界面语言翻成文字
        resolve(limitsCache);
      });
  });
  return fetching;
}
function currentLimits(now) {
  if (!limitsCache) return null;
  // 已经过了重置时间的窗口作废(等下次查询刷新)
  const alive = (w) => (w && (!w.resetsAt || w.resetsAt > now) ? w : null);
  const five = alive(limitsCache.fiveHour);
  return { ...limitsCache, fiveHour: five && { ...five, etaMin: etaMinutes(five, now) }, sevenDay: alive(limitsCache.sevenDay) };
}

function projectDirs() {
  const dirs = [];
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) env.split(',').forEach(d => dirs.push(path.join(d.trim(), 'projects')));
  dirs.push(path.join(os.homedir(), '.claude', 'projects'));
  dirs.push(path.join(os.homedir(), '.config', 'claude', 'projects'));
  return [...new Set(dirs)].filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

function listJsonl(dir, out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJsonl(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

class UsageTracker {
  constructor() {
    this.files = new Map();     // 路径 -> { offset, rest }
    this.entries = [];          // { t, model, inp, out, cw5, cw1, cr, cost }
    this.seen = new Set();      // 去重:message.id + requestId
  }

  // 增量扫描:每个文件只读上次读到之后的新内容
  scan() {
    const cutoff = Date.now() - KEEP;
    for (const dir of projectDirs()) {
      for (const file of listJsonl(dir)) {
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        if (st.mtimeMs < cutoff) continue;                 // 一周多没动过的会话直接跳过
        let f = this.files.get(file);
        if (!f || st.size < f.offset) { f = { offset: 0, rest: '' }; this.files.set(file, f); }
        if (st.size === f.offset) continue;
        let buf;
        try {
          const fd = fs.openSync(file, 'r');
          buf = Buffer.alloc(st.size - f.offset);
          fs.readSync(fd, buf, 0, buf.length, f.offset);
          fs.closeSync(fd);
        } catch { continue; }
        f.offset = st.size;
        const lines = (f.rest + buf.toString('utf8')).split('\n');
        f.rest = lines.pop();                               // 最后一行可能还没写完
        for (const line of lines) this.ingest(line, cutoff);
      }
    }
    this.entries = this.entries.filter(e => e.t >= cutoff);
    this.entries.sort((a, b) => a.t - b.t);
  }

  ingest(line, cutoff) {
    if (!line.includes('"usage"')) return;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const m = d.message;
    if (d.type !== 'assistant' || !m || !m.usage) return;
    if (!m.model || m.model === '<synthetic>') return;
    const t = Date.parse(d.timestamp);
    if (!(t >= cutoff)) return;
    const key = `${m.id || ''}:${d.requestId || ''}`;
    if (key !== ':') { if (this.seen.has(key)) return; this.seen.add(key); }

    const u = m.usage;
    const inp = u.input_tokens || 0, out = u.output_tokens || 0, cr = u.cache_read_input_tokens || 0;
    let cw5 = 0, cw1 = 0;
    if (u.cache_creation) { cw5 = u.cache_creation.ephemeral_5m_input_tokens || 0; cw1 = u.cache_creation.ephemeral_1h_input_tokens || 0; }
    else cw5 = u.cache_creation_input_tokens || 0;

    const p = priceFor(m.model);
    let cost = p ? (inp * p[0] + out * p[1] + cw5 * p[2] + cw1 * p[3] + cr * p[4]) / 1e6 : 0;
    if (u.speed === 'fast') cost *= 2;                      // 快速模式按 2 倍计
    this.entries.push({ t, model: m.model, inp, out, cw5, cw1, cr, cost, known: !!p });
  }

  costSince(t) { return this.entries.reduce((a, e) => a + (e.t >= t ? e.cost : 0), 0); }   // 某个时间之后的花费(周报用)

  // 汇总:今天、近 7 天、当前 5 小时窗口(与 Claude Code 订阅额度的 5 小时窗口同一思路)
  summary() {
    const now = Date.now();
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const sum = (list) => list.reduce((a, e) => {
      a.cost += e.cost;
      a.tokens += e.inp + e.out + e.cw5 + e.cw1 + e.cr;
      a.output += e.out;
      a.messages += 1;
      return a;
    }, { cost: 0, tokens: 0, output: 0, messages: 0 });

    const today = this.entries.filter(e => e.t >= midnight.getTime());
    const week = this.entries.filter(e => e.t >= now - 7 * DAY);

    // 5 小时窗口:从第一条消息所在的整点开始;超过 5 小时或中间断档 5 小时就开新窗口
    let block = null;
    for (const e of this.entries) {
      if (!block || e.t >= block.start + BLOCK || e.t - block.last >= BLOCK) {
        const s = new Date(e.t); s.setMinutes(0, 0, 0);
        block = { start: s.getTime(), last: e.t, items: [] };
      }
      block.last = e.t;
      block.items.push(e);
    }
    let current = null;
    if (block && now < block.start + BLOCK && now - block.last < BLOCK) {
      const s = sum(block.items);
      const elapsedMin = Math.max(1, (now - block.start) / 60000);
      current = { ...s, start: block.start, end: block.start + BLOCK,
        remainingMin: Math.round((block.start + BLOCK - now) / 60000),
        burnPerHour: s.cost / elapsedMin * 60 };
    }

    // 今天按模型拆分
    const byModel = {};
    for (const e of today) {
      const k = e.model.replace(/^claude-/, '');
      byModel[k] = byModel[k] || { cost: 0, tokens: 0 };
      byModel[k].cost += e.cost;
      byModel[k].tokens += e.inp + e.out + e.cw5 + e.cw1 + e.cr;
    }

    const lastActive = this.entries.length ? this.entries[this.entries.length - 1].t : null;
    // 连续使用:从最近一条往前找,中间没有超过 10 分钟的空档就算同一段(给休息提醒用)
    let streakStart = null;
    if (lastActive && now - lastActive < 10 * 60e3) {
      streakStart = lastActive;
      for (let i = this.entries.length - 2; i >= 0 && streakStart - this.entries[i].t < 10 * 60e3; i--) streakStart = this.entries[i].t;
    }
    return { today: sum(today), week: sum(week), block: current, byModel, lastActive, streakStart, limits: currentLimits(now), limitsError, updatedAt: now };
  }
}

module.exports = { UsageTracker, fetchLimits, parseUsage, projectDirs, listJsonl, _eta: { recordSample, etaMinutes } };   // _eta 只给自测用

// 命令行自测:node usage.js
if (require.main === module) {
  const u = new UsageTracker();
  const t0 = Date.now();
  u.scan();
  const t1 = Date.now();
  u.scan();
  console.log(JSON.stringify(u.summary(), null, 2));
  console.log(`首次扫描 ${t1 - t0}ms,增量扫描 ${Date.now() - t1}ms,记录 ${u.entries.length} 条`);
}
