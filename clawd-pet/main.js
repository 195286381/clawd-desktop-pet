// Clawd 桌宠 —— 主进程
// 一个铺满主屏工作区(菜单栏以下、Dock 以上)的透明置顶窗口。
// 默认鼠标穿透;只有光标落在 Clawd 身上时才接收点击,所以不会挡住你的操作。
// 菜单栏和 Dock 里都常驻一个图标:可以把 Clawd "收起来"(最小化),再点一下放出来。
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, dialog, powerMonitor, globalShortcut } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');
const { UsageTracker, fetchLimits } = require('./usage');

app.setName('Clawd');

// 只允许运行一个 Clawd;重复打开时把现有的放出来 / 跳一下
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (hidden) restore(); else send('jump'); });

let win = null;
let tray = null;
let hidden = false;     // Clawd 是否被收起
let wander = true;      // 是否自由活动
let passthrough = false; // 完全穿透:Clawd 完全不接收鼠标,只能通过菜单互动
let clinging = false;    // 是否贴在屏幕边上

// ---------- 设置(大小、血条显示方式),存在 userData/settings.json ----------
const fs = require('fs');
const SIZES = [['小', 0.75], ['中(默认)', 1], ['大', 1.3], ['特大', 1.6]];
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function saveSetting(key, v) {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), [key]: v })); } catch (e) { console.error('保存设置失败', e); }
}
// ---------- 界面语言:跟随系统 / 中文 / English ----------
// 文案以中文原文为键,英文界面下查 locales/en.json(渲染进程也用同一张表)
const EN = require('./locales/en.json');
const LANGS = [['跟随系统', 'auto'], ['中文', 'zh'], ['English', 'en']];
let langPref = LANGS.some(([, v]) => v === loadSettings().lang) ? loadSettings().lang : 'auto';
if (!app.isPackaged && process.env.CLAWD_LANG) langPref = process.env.CLAWD_LANG;   // 开发自测:临时切语言,不改设置
const uiLang = () => (langPref !== 'auto' ? langPref : /^zh/i.test(app.getPreferredSystemLanguages()[0] || app.getLocale()) ? 'zh' : 'en');
const t = (s, ...a) => ((uiLang() === 'en' && EN[s]) || s).replace(/\{(\d)\}/g, (_, i) => a[i]);
let petScale = Number(loadSettings().scale) || 1;
// 血条:一直显示 / 鼠标悬停时显示 / 关闭
const HP_MODES = [['一直显示', 'always'], ['鼠标悬停时显示', 'hover'], ['关闭', 'off']];
let hpMode = HP_MODES.some(([, v]) => v === loadSettings().hpMode) ? loadSettings().hpMode : 'always';
// 鼠标经过(还没停稳、点击会穿透)时 Clawd 变多透明:变半透明 / 稍微变淡 / 不变
const FADES = [['变半透明', 'fade'], ['稍微变淡', 'light'], ['不变', 'none']];
let hoverFade = FADES.some(([, v]) => v === loadSettings().hoverFade) ? loadSettings().hoverFade : 'fade';
// Dock 图标:可以关掉,Clawd 照常在桌面上,菜单改从菜单栏图标打开
let showDock = loadSettings().showDock !== false;
function keepOnTop() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'floating');
  // 默认会临时切换进程类型来盖住全屏 App,这一步会把 Dock 图标带回来;隐藏 Dock 时跳过
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: !showDock });
}
function applyDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  if (showDock) app.dock.show().then(() => { refreshMenus(); keepOnTop(); });
  else { app.dock.hide(); keepOnTop(); }
}
// 自言自语频率、休息提醒、节日装扮、Claude Code 提醒开关
const CHAT_LEVELS = [['话多', 'chatty'], ['正常', 'normal'], ['安静', 'quiet'], ['不说话', 'off']];
const BREAKS = [['关闭', 0], ['45 分钟', 45], ['60 分钟', 60], ['90 分钟', 90]];
const st0 = loadSettings();
let chatLevel = CHAT_LEVELS.some(([, v]) => v === st0.chatLevel) ? st0.chatLevel : 'normal';
let breakMin = BREAKS.some(([, v]) => v === st0.breakMin) ? st0.breakMin : 60;
let holiday = st0.holiday !== false;
let ccNotifyDone = st0.ccNotifyDone !== false, ccNotifyAsk = st0.ccNotifyAsk !== false;
let ccCrabs = st0.ccCrabs !== false;   // 头顶的会话小螃蟹,默认开
let powerSave = st0.powerSave === true, sound = st0.sound === true;   // 省电模式(帧率上限 30)、音效:默认都关
function syncPrefs() {
  send('chat:' + chatLevel); send('break:' + breakMin); send('holiday:' + (holiday ? 'on' : 'off'));
  send('power-save:' + (powerSave ? 'on' : 'off')); send('fade:' + hoverFade); send('sound:' + (sound ? 'on' : 'off'));
  send('cc-notify:' + (ccNotifyDone ? 1 : 0) + (ccNotifyAsk ? 1 : 0)); send('cc-hooks:' + (ccHooked() ? 'on' : 'off')); send('crabs:' + (ccCrabs ? 'on' : 'off'));
}
function setPref(key, v) {
  ({ chatLevel: () => (chatLevel = v), breakMin: () => (breakMin = v), holiday: () => (holiday = v),
     ccNotifyDone: () => (ccNotifyDone = v), ccNotifyAsk: () => (ccNotifyAsk = v), ccCrabs: () => (ccCrabs = v),
     powerSave: () => (powerSave = v), sound: () => (sound = v), hoverFade: () => (hoverFade = v) })[key]();
  saveSetting(key, v); syncPrefs(); refreshMenus();
}

// ---------- 和 Claude Code 联动 ----------
// Clawd 在本机 127.0.0.1 开一个小接口;Claude Code 的 hooks(发出指令 / 调用工具 / 工具失败 / 回复完成 /
// 出错停下 / 需要确认 / 会话结束)用 curl 把事件发过来。hooks 都是 async(后台跑),不拖慢 Claude Code;
// Clawd 没开着时 curl 静默失败,也不影响。
const HOOK_PORT = (!app.isPackaged && Number(process.env.CLAWD_HOOK_PORT)) || 47615;   // 开发自测可换端口,避免和正在运行的 Clawd 冲突
const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification', 'SessionEnd'];
const HOOK_MARK = 'clawd-hook';
// 顺带告诉 Clawd 这个会话开在哪个 App 里(启动它的 App 的 bundle id)、哪个终端(tty),
// 以及在 Claude App 里的会话 id,点小螃蟹时好跳过去
const HOOK_HEADERS = `-H 'Content-Type: application/json' -H "X-Clawd-App: $__CFBundleIdentifier" -H "X-Clawd-Tty: $(ps -o tty= -p $PPID)" -H "X-Clawd-Host: $CLAUDE_CODE_HOST_SESSION_ID"`;
const HOOK_CMD = `curl -s -m 2 -X POST ${HOOK_HEADERS} --data-binary @- http://127.0.0.1:${HOOK_PORT}/hook >/dev/null 2>&1 || true # ${HOOK_MARK}`;
// 在 Clawd 上批准权限:这条 hook 不是后台跑的,Claude Code 会等它的输出(批准 / 拒绝的 JSON)再决定弹不弹批准框。
// Clawd 没开、没表态或超时都输出空,Claude Code 照常在终端里弹框
const PERM_WAIT = 60e3;
const APPROVE_CMD = `curl -s -m 70 -X POST ${HOOK_HEADERS} --data-binary @- http://127.0.0.1:${HOOK_PORT}/permission 2>/dev/null || true # ${HOOK_MARK}`;
// 开发自测可以用 CLAWD_CC_SETTINGS 指向一个临时文件,避免动到真正的配置
const ccSettingsFile = () => (!app.isPackaged && process.env.CLAWD_CC_SETTINGS) || path.join(os.homedir(), '.claude', 'settings.json');
function readCC() {
  try { return JSON.parse(fs.readFileSync(ccSettingsFile(), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }   // 文件损坏时抛出,不去覆盖它
}
const isClawdHook = h => typeof h.command === 'string' && h.command.includes(HOOK_MARK);
function ccHookEvents() {   // 已经装了 Clawd hook 的事件
  try { const h = readCC().hooks || {}; return HOOK_EVENTS.filter(ev => (h[ev] || []).some(g => (g.hooks || []).some(isClawdHook))); }
  catch { return []; }
}
const ccHooked = () => ccHookEvents().length > 0;
// 旧版 hook 命令不带 App / tty / Claude App 会话 id(点小螃蟹没法跳转),启动时换成新的
function ccHooksStale() {
  try { const h = readCC().hooks || {}; return HOOK_EVENTS.some(ev => (h[ev] || []).some(g => (g.hooks || []).some(x => isClawdHook(x) && !x.command.includes('X-Clawd-Host')))); }
  catch { return false; }
}
const ccApproveOn = () => { try { return ((readCC().hooks || {}).PermissionRequest || []).some(g => (g.hooks || []).some(isClawdHook)); } catch { return false; } };
// 只增删 Clawd 自己的那几条,别的 hooks 原样保留;改之前先备份
function editCCHooks(mutate) {
  const file = ccSettingsFile();
  const cfg = readCC();
  // 只在第一次备份:保留的是装 Clawd 之前的原样
  if (fs.existsSync(file) && !fs.existsSync(file + '.clawd-backup')) fs.copyFileSync(file, file + '.clawd-backup');
  const hooks = cfg.hooks || {};
  const set = (ev, hook) => {   // hook 为 null 时只删掉 Clawd 的
    const groups = (hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isClawdHook(h)) })).filter(g => g.hooks.length);
    if (hook) groups.push({ hooks: [{ type: 'command', ...hook }] });
    if (groups.length) hooks[ev] = groups; else delete hooks[ev];
  };
  mutate(set);
  if (Object.keys(hooks).length) cfg.hooks = hooks; else delete cfg.hooks;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}
function setCCHooks(on) {
  editCCHooks(set => {
    for (const ev of HOOK_EVENTS) set(ev, on ? { command: HOOK_CMD, async: true, timeout: 5 } : null);
    if (!on) set('PermissionRequest', null);   // 断开连接时,批准权限也一起关掉
  });
}
function toggleApprove(on) {
  try { editCCHooks(set => set('PermissionRequest', on ? { command: APPROVE_CMD, timeout: 75 } : null)); }
  catch (e) { dialog.showErrorBox(t('没能修改 Claude Code 配置'), `${ccSettingsFile()}\n\n${e.message}\n\n${t('文件没有被改动。')}`); }
  refreshMenus();
  if (on && ccApproveOn()) dialog.showMessageBox({ message: t('已打开：在 Clawd 上批准权限'), detail: t('Claude 要你批准时，如果它所在的终端 / App 不在最前面，Clawd 会弹出「允许 / 拒绝 / 去终端处理」；60 秒没点就交回终端照常弹框。终端在最前面时不拦，直接在终端里批准。\n\n新开的 Claude Code 会话才生效。') });
}
function toggleCCHooks(on) {
  try { setCCHooks(on); }
  catch (e) {
    dialog.showErrorBox(t('没能修改 Claude Code 配置'), `${ccSettingsFile()}\n\n${e.message}\n\n${t('文件没有被改动。')}`);
  }
  syncPrefs(); refreshMenus();
  if (on && ccHooked()) dialog.showMessageBox({ message: t('已连接 Claude Code'), detail: t('新开的 Claude Code 会话会把「在干什么 / 回复完成 / 需要确认 / 等你输入 / 出错」通知给 Clawd。已经开着的会话需要重新打开才生效。\n\n原配置已备份为 settings.json.clawd-backup。') });
}
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
http.createServer((req, res) => {
  if (req.method !== 'POST' || (req.url !== '/hook' && req.url !== '/permission')) { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    const perm = req.url === '/permission';
    if (!perm) res.end('ok');
    let d; try { d = JSON.parse(body); } catch { return res.end(''); }
    const appId = String(req.headers['x-clawd-app'] || '').trim(), tty = String(req.headers['x-clawd-tty'] || '').trim();
    const host = String(req.headers['x-clawd-host'] || '').trim();
    if (perm) return askPermission(res, d, {
      app: /^[\w.-]+$/.test(appId) ? appId : '', tty: /^ttys\d+$/.test(tty) ? tty : '', host: HOST_ID.test(host) ? host : '' });
    if (win && !win.isDestroyed()) win.webContents.send('cc', {
      app: /^[\w.-]+$/.test(appId) ? appId : '', tty: /^ttys\d+$/.test(tty) ? tty : '', host: HOST_ID.test(host) ? host : '',
      event: String(d.hook_event_name || ''), session: String(d.session_id || ''),
      project: d.cwd ? path.basename(String(d.cwd)) : '', message: String(d.message || ''), at: Date.now(),
      ntype: String(d.notification_type || ''),
      tool: toolName(d.tool_name), detail: toolDetail(d.tool_name, d.tool_input), error: clip(d.error, 60),
    });
  });
}).on('error', e => console.error('Clawd hooks 接口启动失败', e.message)).listen(HOOK_PORT, '127.0.0.1');

// ---------- 在 Clawd 上批准权限 ----------
// 会话所在的终端 / App 正在最前面(你正看着它):不拦,输出空,终端立刻照常弹框。
// 否则让 Clawd 弹出「允许 / 拒绝 / 去终端处理」,最多等 PERM_WAIT;没表态就输出空,交回终端
const perms = new Map();   // id → { res, timer }
let permSeq = 0;
function frontApp(cb) {   // 最前面那个 App 的 bundle id(lsappinfo 不需要额外权限)
  execFile('lsappinfo', ['front'], (e, asn) => {
    if (e) return cb('');
    execFile('lsappinfo', ['info', '-only', 'bundleid', asn.trim()], (e2, out) => cb(((out || '').match(/bundleID="([^"]+)"/) || [])[1] || ''));
  });
}
// 气泡开着时才占用快捷键:⌥⌘Y 允许、⌥⌘N 拒绝当前这个;没有待批准的就注销,平时不抢别的 App 的按键
const PERM_KEYS = { 'Alt+Command+Y': 'allow', 'Alt+Command+N': 'deny' };
function syncPermKeys() {
  const want = perms.size > 0, has = globalShortcut.isRegistered('Alt+Command+Y');
  if (want && !has) for (const [k, d] of Object.entries(PERM_KEYS)) globalShortcut.register(k, () => send('perm-key:' + d));
  else if (!want && has) for (const k of Object.keys(PERM_KEYS)) globalShortcut.unregister(k);
}
function permReply(id, behavior) {
  const p = perms.get(id);
  if (!p) return;
  perms.delete(id); clearTimeout(p.timer); syncPermKeys();
  p.res.end(behavior === 'allow' || behavior === 'deny'
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior } } }) : '');
}
function askPermission(res, d, where) {
  if (!win || win.isDestroyed() || hidden || passthrough) return res.end('');
  frontApp(front => {
    if (front && front === where.app) return res.end('');
    const id = ++permSeq;
    perms.set(id, { res, timer: setTimeout(() => { permReply(id, ''); send('perm-cancel:' + id); }, PERM_WAIT) });
    syncPermKeys();
    res.on('close', () => { if (perms.has(id)) { perms.delete(id); syncPermKeys(); send('perm-cancel:' + id); } });   // Claude Code 那边不等了(比如你按了 Esc)
    const name = String(d.tool_name || '');
    const preview = name === 'Bash' ? String(d.tool_input?.command || '').trim() : toolDetail(name, d.tool_input);
    win.webContents.send('perm', {
      id, ...where, session: String(d.session_id || ''), project: d.cwd ? path.basename(String(d.cwd)) : '',
      tool: toolName(name), preview: preview.length > 300 ? preview.slice(0, 299) + '…' : preview,
    });
  });
}
ipcMain.on('perm-decision', (_e, id, behavior) => permReply(Number(id), String(behavior)));

function setHpMode(v) { hpMode = v; saveSetting('hpMode', v); send('hp:' + v); refreshMenus(); }
function loadPet() { win.loadFile('index.html', { query: { scale: String(petScale), lang: uiLang() } }); }
function setLang(v) {
  if (v === langPref) return;
  const before = uiLang();
  langPref = v; saveSetting('lang', v);
  if (uiLang() !== before && win && !win.isDestroyed()) { clinging = false; loadPet(); }   // 重新载入页面,气泡和面板换成新语言
  refreshMenus();
}
function setScale(v) {
  if (v === petScale) return;
  petScale = v;
  saveSetting('scale', v);
  clinging = false;
  if (win && !win.isDestroyed()) loadPet();   // 重新载入页面,按新大小重建画布
  refreshMenus();
}

const workArea = () => screen.getPrimaryDisplay().workArea;
// ---------- 用量:每 30 秒增量扫描一次 Claude Code 的本地会话记录 ----------
const tracker = new UsageTracker();
function pushUsage() {
  if (!win || win.isDestroyed()) return;
  try {
    tracker.scan();
    const sum = tracker.summary();
    // 开发自测:CLAWD_FAKE_QUOTA=7 npm start —— 假装 5 小时额度只剩 7%(只在未打包时生效)
    const fakeRaw = app.isPackaged ? '' : (process.env.CLAWD_FAKE_QUOTA || '');
    const rem = fakeRaw.trim() === '' ? NaN : Number(fakeRaw);
    if (Number.isFinite(rem)) {
      const eta = Number(process.env.CLAWD_FAKE_ETA);   // 开发自测:CLAWD_FAKE_ETA=25 —— 假装照现在速度 25 分钟后用完
      sum.limits = { fiveHour: { used: 100 - rem, remaining: rem, resetsAt: Date.now() + 90 * 60000, etaMin: Number.isFinite(eta) ? eta : null },
        sevenDay: (sum.limits && sum.limits.sevenDay) || null, others: [], savedAt: Date.now() };
    }
    // 开发自测:CLAWD_DEMO=1 —— 用一组固定的示例数据(给 README 截图用,不暴露真实用量)
    if (!app.isPackaged && process.env.CLAWD_DEMO) {
      const now = Date.now();
      Object.assign(sum, {
        today: { cost: 12.4, tokens: 2.36e7, output: 1.8e5, messages: 320 },
        week: { cost: 58.9, tokens: 1.12e8, output: 9.4e5, messages: 1630 },
        block: { cost: 9.75, tokens: 1.7e7, start: now - 2 * 3600e3, end: now + 3 * 3600e3, remainingMin: 168, burnPerHour: 4.9 },
        byModel: { 'opus-5-5': { cost: 10.9, tokens: 2e7 }, 'sonnet-5-5': { cost: 1.5, tokens: 3.6e6 } },
        lastActive: now - 3 * 3600e3, streakStart: null,   // 示例里不算"正在用",免得到处抱电脑
        limits: { fiveHour: { used: 58, remaining: 42, resetsAt: now + 168 * 60e3, etaMin: 95 },
          sevenDay: { used: 27, remaining: 73, resetsAt: now + 2.6 * 864e5 }, others: [], savedAt: now },
      });
    }
    // 开发自测:CLAWD_FAKE_WEEK=30 —— 假装本周额度只剩 30%
    const fakeWeek = app.isPackaged ? NaN : Number((process.env.CLAWD_FAKE_WEEK || '').trim() || NaN);
    if (Number.isFinite(fakeWeek)) {
      sum.limits = { fiveHour: null, others: [], ...(sum.limits || {}), savedAt: Date.now(),
        sevenDay: { used: 100 - fakeWeek, remaining: fakeWeek, resetsAt: Date.now() + 2 * 864e5 } };
    }
    win.webContents.send('usage', sum);
  } catch (e) { console.error('用量统计失败', e); }
}
// 订阅额度:调用 `claude -p "/usage"` 查询(约 5 秒,不消耗额度)。每 5 分钟一次;点开气泡时若超过 1 分钟也刷新
let limitsAt = 0;
function refreshLimits(force = false) {
  if (!force && Date.now() - limitsAt < 60000) return;
  limitsAt = Date.now();
  fetchLimits().then(pushUsage);
}
ipcMain.on('request-usage', () => { pushUsage(); refreshLimits(); });
setInterval(pushUsage, 30000);
setInterval(() => refreshLimits(true), 5 * 60000);

const send = (cmd) => { if (win && !win.isDestroyed()) win.webContents.send('cmd', cmd); };

function createWindow() {
  const wa = workArea();
  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // macOS 上用 NSPanel:点它不会抢走当前应用的焦点
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    // 不可聚焦:点 Clawd 也不会把键盘焦点抢过来,打字始终进入你当前的 App
    focusable: false,
    // 窗口不可聚焦,在 macOS 上一直算"非活动窗口";默认点非活动窗口的第一下只用来激活、不传给页面,
    // 表现为有时要点两下才能拖动。打开它,第一下就直接给 Clawd
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',   // 音效:窗口不可聚焦,等不到"用户手势"
    },
  });
  keepOnTop();
  win.setIgnoreMouseEvents(true);
  loadPet();
  win.once('ready-to-show', () => win.showInactive());
  // 渲染进程的报错记到 userData/clawd.log(只留最近 200KB),方便排查"卡住"之类的问题
  win.webContents.on('console-message', (e, level, message) => {
    const lv = e.level ?? level, msg = e.message ?? message;
    if (lv !== 'error' && lv !== 3) return;
    try {
      const f = path.join(app.getPath('userData'), 'clawd.log');
      if (fs.existsSync(f) && fs.statSync(f).size > 200e3) fs.renameSync(f, f + '.old');
      fs.appendFileSync(f, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  });
  win.webContents.on('render-process-gone', (_e, d) => { console.error('渲染进程退出', d.reason); if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) loadPet(); });
  win.webContents.on('did-finish-load', () => {
    // 页面(重新)载入后,把菜单里的开关状态同步过去
    if (!wander) send('wander-off');
    if (passthrough) send('passthrough-on');
    send('hp:' + hpMode);
    send('power:' + (powerMonitor.isOnBatteryPower() ? 'battery' : 'ac'));
    syncPrefs();
    pushUsage(); refreshLimits(true);
  });

  // 持续把光标位置(窗口坐标)发给渲染进程:用于眼睛跟随,以及判断光标是否在 Clawd 身上。
  // 光标在动时每 16ms 查一次、动了就发;停下 1 秒后放慢到每 100ms 查一次(渲染进程靠这个判断"在身上停够了")
  let lastCur = '', lastMove = 0, timer = 0;
  const poll = () => {
    if (win && !win.isDestroyed() && !hidden) {
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const x = p.x - b.x, y = p.y - b.y, key = x + ',' + y, now = Date.now();
      if (key !== lastCur) { lastCur = key; lastMove = now; }
      win.webContents.send('cursor', { x, y });
    }
    timer = setTimeout(poll, Date.now() - lastMove < 1000 ? 16 : 100);
  };
  poll();
  win.on('closed', () => { clearTimeout(timer); win = null; });
}

// 渲染进程告诉我们光标是否落在 Clawd 上
let ignoring = true;
ipcMain.on('set-ignore', (_e, ignore) => {
  if (passthrough) ignore = true;
  if (!win || ignore === ignoring) return;
  ignoring = ignore;
  win.setIgnoreMouseEvents(ignore);
});

// ---------- 收起 / 放出 ----------
// 收起:先让 Clawd 播完"蹦走"的动画,渲染进程回报 'hidden-done' 后再隐藏窗口
function minimize() {
  if (hidden || !win) return;
  hidden = true;
  send('minimize');
  refreshMenus();
}
// 点会话小螃蟹:跳到这个会话所在的窗口。iTerm / Terminal 按 tty 选中具体的标签页,Claude App 用它自己的链接打开那个会话,
// 其他 App(VS Code、Ghostty 等)切到最前面
const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/;   // Claude App 里的会话 id
const TAB_SCRIPTS = {
  'com.googlecode.iterm2': tty => `tell application id "com.googlecode.iterm2"
  repeat with w in windows
    repeat with tb in tabs of w
      repeat with s in sessions of tb
        if tty of s is "${tty}" then
          select w
          select tb
          select s
          activate
          return
        end if
      end repeat
    end repeat
  end repeat
end tell
error "not found"`,
  'com.apple.Terminal': tty => `tell application id "com.apple.Terminal"
  repeat with w in windows
    repeat with tb in tabs of w
      if tty of tb is "${tty}" then
        set selected of tb to true
        set index of w to 1
        activate
        return
      end if
    end repeat
  end repeat
end tell
error "not found"`,
};
ipcMain.on('focus-session', (_e, s) => {
  const appId = String(s?.app || ''), tty = String(s?.tty || ''), host = String(s?.host || '');
  if (!/^[\w.-]+$/.test(appId)) return;
  const open = () => execFile('open', ['-b', appId], err => err && console.error('切换到会话窗口失败', appId, err.message));
  if (appId === 'com.anthropic.claudefordesktop' && HOST_ID.test(host)) return execFile('open', ['claude://claude.ai/epitaxy/' + host], err => { if (err) open(); });
  const script = /^ttys\d+$/.test(tty) && TAB_SCRIPTS[appId];
  if (!script) return open();
  execFile('osascript', ['-e', script('/dev/' + tty)], err => { if (err) open(); });   // 没找到标签页 / 没给自动化权限:至少把 App 切过来
});
ipcMain.on('clinging', (_e, v) => { clinging = !!v; refreshMenus(); });
ipcMain.on('hidden-done', () => { if (hidden && win) win.hide(); });

function restore() {
  if (!hidden || !win) return;
  hidden = false;
  ignoring = true;
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  send('restore');             // 从屏幕上方掉下来
  refreshMenus();
}
const toggle = () => (hidden ? restore() : minimize());
const act = (cmd) => () => { if (hidden) restore(); send(cmd); };

// ---------- 菜单(菜单栏右键 & Dock 右键共用) ----------
function menuTemplate({ forDock = false } = {}) {
  // 按分类整理:常用操作 → 动作 / 位置 → 外观 / 设置 → 退出
  const settings = [
    { label: t('自言自语'), submenu: CHAT_LEVELS.map(([name, v]) => ({ label: t(name), type: 'radio', checked: chatLevel === v, click: () => setPref('chatLevel', v) })) },
    { label: t('休息提醒'), submenu: BREAKS.map(([name, v]) => ({ label: t(name), type: 'radio', checked: breakMin === v, click: () => setPref('breakMin', v) })) },
    { type: 'separator' },
    { label: t('音效'), type: 'checkbox', checked: sound, click: (item) => setPref('sound', item.checked) },
    { label: t('省电模式(动作帧率减半)'), type: 'checkbox', checked: powerSave, click: (item) => setPref('powerSave', item.checked) },
    { type: 'separator' },
    { label: t('自由活动'), type: 'checkbox', checked: wander,
      click: (item) => { wander = item.checked; send(wander ? 'wander-on' : 'wander-off'); refreshMenus(); } },
    { label: t('完全穿透(只看不点)'), type: 'checkbox', checked: passthrough,
      click: (item) => {
        passthrough = item.checked;
        if (passthrough && win) { ignoring = true; win.setIgnoreMouseEvents(true); }
        send(passthrough ? 'passthrough-on' : 'passthrough-off');
        refreshMenus();
      } },
  ];
  if (process.platform === 'darwin' && app.dock) {
    settings.push({ label: t('在 Dock 中显示图标'), type: 'checkbox', checked: showDock,
      click: (item) => { showDock = item.checked; saveSetting('showDock', showDock); applyDock(); refreshMenus(); } });
  }
  if (app.isPackaged) {   // 开机自启只对装进「应用程序」的打包版有意义
    settings.push({ type: 'separator' }, { label: t('开机自动启动'), type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenus(); } });
  }
  const items = [
    { label: t(hidden ? '放出 Clawd' : '收起 Clawd'), click: toggle },
    { label: t('查看用量'), click: () => { pushUsage(); act('usage')(); } },
    { type: 'separator' },
    { label: t('动作'), submenu: [
      { label: t('跳一下'), click: act('jump') },
      { label: t('打招呼'), click: act('wave') },
      { label: t('跳舞'), click: act('dance') },
      { label: t('探头张望'), click: act('lean') },
      { label: t('散散步'), click: act('walk') },
      { label: t('伸懒腰'), click: act('stretch') },
    ] },
    { label: t('位置'), submenu: [
      { label: t(clinging ? '离开边缘' : '贴到屏幕边上'), click: act('cling') },
      { label: t('回到屏幕中间'), click: act('home') },
    ] },
    { type: 'separator' },
    { label: 'Claude Code', submenu: [
      { label: t('连接 Claude Code(任务提醒)'), type: 'checkbox', checked: ccHooked(), click: (item) => toggleCCHooks(item.checked) },
      { type: 'separator' },
      { label: t('回复完成时提醒'), type: 'checkbox', checked: ccNotifyDone, enabled: ccHooked(), click: (item) => setPref('ccNotifyDone', item.checked) },
      { label: t('需要确认 / 等你输入时提醒'), type: 'checkbox', checked: ccNotifyAsk, enabled: ccHooked(), click: (item) => setPref('ccNotifyAsk', item.checked) },
      { label: t('在 Clawd 上批准权限'), type: 'checkbox', checked: ccApproveOn(), enabled: ccHooked(), click: (item) => toggleApprove(item.checked) },
      { label: t('头顶显示会话小螃蟹'), type: 'checkbox', checked: ccCrabs, enabled: ccHooked(), click: (item) => setPref('ccCrabs', item.checked) },
    ] },
    { label: t('外观'), submenu: [
      { label: t('大小'), submenu: SIZES.map(([name, v]) => ({ label: t(name), type: 'radio', checked: petScale === v, click: () => setScale(v) })) },
      { label: t('血条'), submenu: HP_MODES.map(([name, v]) => ({ label: t(name), type: 'radio', checked: hpMode === v, click: () => setHpMode(v) })) },
      { label: t('鼠标经过时'), submenu: FADES.map(([name, v]) => ({ label: t(name), type: 'radio', checked: hoverFade === v, click: () => setPref('hoverFade', v) })) },
      { label: t('节日装扮'), type: 'checkbox', checked: holiday, click: (item) => setPref('holiday', item.checked) },
    ] },
    { label: t('设置'), submenu: settings },
    { label: uiLang() === 'en' ? 'Language / 语言' : '语言 / Language', submenu: LANGS.map(([name, v]) => ({ label: v === 'auto' ? t(name) : name, type: 'radio', checked: langPref === v, click: () => setLang(v) })) },
  ];
  if (!forDock) items.push({ type: 'separator' }, { label: t('退出 Clawd'), role: 'quit' });
  return items;
}

function refreshMenus() {
  if (tray) tray.setToolTip(t(hidden ? 'Clawd(已收起,点击放出)' : 'Clawd(点击收起)'));
  if (process.platform === 'darwin' && app.dock) app.dock.setMenu(Menu.buildFromTemplate(menuTemplate({ forDock: true })));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png')));
  tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', toggle);                                                     // 左键:收起 / 放出
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate())));
  refreshMenus();
}

app.whenReady().then(() => {
  // 之前连过 Claude Code、但 hooks 是旧版(少几个事件):按用户原来的选择补齐
  try { const evs = ccHookEvents(); if (evs.length && (evs.length < HOOK_EVENTS.length || ccHooksStale())) setCCHooks(true); } catch (e) { console.error('升级 Claude Code hooks 失败', e.message); }

  if (process.platform === 'darwin' && app.dock) {
    if (showDock) app.dock.show(); else app.dock.hide();
    if (!app.isPackaged) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));   // 打包后用 .icns
  }
  createWindow();
  createTray();

  // 开发自测(只在 npm start 时生效):
  //   CLAWD_SELFTEST=1     —— 4 秒后收起,8 秒后放出
  //   CLAWD_SELFTEST=usage —— 3 秒后弹出用量气泡
  //   CLAWD_SELFTEST=cling —— 3 秒后贴到屏幕边上
  const selftest = !app.isPackaged && process.env.CLAWD_SELFTEST;
  if (selftest === 'usage') setTimeout(() => { pushUsage(); send('usage'); }, 3000);
  else if (selftest === 'cling') setTimeout(() => send('cling'), 3000);
  else if (selftest) {
    setTimeout(minimize, 4000);
    setTimeout(restore, 8000);
  }

  // 分辨率 / 显示器变化时重新铺满工作区
  const refit = () => { if (win) win.setBounds(workArea()); };
  screen.on('display-metrics-changed', refit);
  screen.on('display-added', refit);
  screen.on('display-removed', refit);

  // 插拔电源:用电池时渲染进程把帧率上限降到 30
  powerMonitor.on('on-battery', () => send('power:battery'));
  powerMonitor.on('on-ac', () => send('power:ac'));

  // 你离开电脑(5 分钟没碰键盘鼠标):Clawd 去睡觉;一回来就醒,告诉你这期间 Claude 那边发生了什么
  const AWAY_AFTER = (!app.isPackaged && Number(process.env.CLAWD_AWAY_AFTER)) || 300;   // 秒;开发自测可以调短
  let away = false;
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    if (!away && idle >= AWAY_AFTER) { away = true; send('away'); }
    else if (away && idle < 3) { away = false; send('back'); }
  }, 2000);
});

// 点 Dock 图标:收起时放出来;已经在外面就跳一下打个招呼
app.on('activate', () => { if (hidden) restore(); else send('jump'); });

app.on('window-all-closed', () => app.quit());
