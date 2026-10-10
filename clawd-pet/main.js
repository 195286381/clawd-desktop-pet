// Clawd 桌宠 —— 主进程
// 一个铺满主屏工作区(菜单栏以下、Dock 以上)的透明置顶窗口。
// 默认鼠标穿透;只有光标落在 Clawd 身上时才接收点击,所以不会挡住你的操作。
// 菜单栏和 Dock 里都常驻一个图标:可以把 Clawd "收起来"(最小化),再点一下放出来。
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, dialog, powerMonitor, globalShortcut } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');
const { UsageTracker, fetchLimits, setLiveLimits, limitsLiveAt, QUOTA_DIR, projectDirs, listJsonl } = require('./usage');
const cc = require('./cc');
const { HOOK_EVENTS, HOOK_MARK, HOST_ID, clip, toolName, toolDetail, runningStep } = cc;

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
const SIZES = [['迷你', 0.5], ['小', 0.75], ['中(默认)', 1], ['大', 1.3], ['特大', 1.6]];
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
let ccReport = st0.ccReport !== false;   // 下班时递一张小报(周五是周报),默认开
let powerSave = st0.powerSave === true, sound = st0.sound === true;   // 省电模式(帧率上限 30)、音效:默认都关
let sessKey = st0.sessKey !== false;   // ⌃⌥⌘C 打开会话列表,默认开
function syncPrefs() {
  send('chat:' + chatLevel); send('break:' + breakMin); send('holiday:' + (holiday ? 'on' : 'off'));
  send('power-save:' + (powerSave ? 'on' : 'off')); send('fade:' + hoverFade); send('sound:' + (sound ? 'on' : 'off'));
  send('cc-notify:' + (ccNotifyDone ? 1 : 0) + (ccNotifyAsk ? 1 : 0)); send('cc-hooks:' + (ccHooked() ? 'on' : 'off')); send('crabs:' + (ccCrabs ? 'on' : 'off'));
  send('report:' + (ccReport ? 'on' : 'off'));
}
function setPref(key, v) {
  ({ chatLevel: () => (chatLevel = v), breakMin: () => (breakMin = v), holiday: () => (holiday = v),
     ccNotifyDone: () => (ccNotifyDone = v), ccNotifyAsk: () => (ccNotifyAsk = v), ccCrabs: () => (ccCrabs = v), ccReport: () => (ccReport = v),
     powerSave: () => (powerSave = v), sound: () => (sound = v), hoverFade: () => (hoverFade = v), sessKey: () => (sessKey = v) })[key]();
  saveSetting(key, v); syncPrefs(); refreshMenus();
  if (key === 'sessKey') syncSessKey();
}

// ---------- 和 Claude Code 联动 ----------
// Clawd 在本机 127.0.0.1 开一个小接口;Claude Code 的 hooks(发出指令 / 调用工具 / 工具失败 / 回复完成 /
// 出错停下 / 需要确认 / 压缩上下文 / 派出和收回子助手 / 会话结束)用 curl 把事件发过来。hooks 都是 async(后台跑),不拖慢 Claude Code;
// Clawd 没开着时 curl 静默失败,也不影响。
const HOOK_PORT = (!app.isPackaged && Number(process.env.CLAWD_HOOK_PORT)) || 47615;   // 开发自测可换端口,避免和正在运行的 Clawd 冲突
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
function ccHookEvents() {   // 已经装了 Clawd hook 的事件
  try { return cc.clawdHookEvents(readCC().hooks); }
  catch { return []; }
}
const ccHooked = () => ccHookEvents().length > 0;
// 旧版 hook 命令不带 App / tty / Claude App 会话 id(点小螃蟹没法跳转),启动时换成新的
function ccHooksStale() {
  try { return cc.clawdHooksStale(readCC().hooks); }
  catch { return false; }
}
const ccApproveOn = () => { try { return cc.hasClawdHook(readCC().hooks, 'PermissionRequest'); } catch { return false; } };
// 改 Claude Code 配置:只动 Clawd 自己的那几条,别的原样保留;改之前先备份
function editCC(fn) {
  const file = ccSettingsFile();
  const cfg = readCC();
  // 只在第一次备份:保留的是装 Clawd 之前的原样
  if (fs.existsSync(file) && !fs.existsSync(file + '.clawd-backup')) fs.copyFileSync(file, file + '.clawd-backup');
  fn(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}
const editCCHooks = mutate => editCC(cfg => cc.editHooks(cfg, mutate));
function setCCHooks(on) {
  editCC(cfg => {
    cc.editHooks(cfg, set => {
      for (const ev of HOOK_EVENTS) set(ev, on ? { command: HOOK_CMD, async: true, timeout: 5 } : null);
      if (!on) set('PermissionRequest', null);   // 断开连接时,批准权限也一起关掉
    });
    if (!on) cc.setStatusLine(cfg, false);   // 实时额度也一起关掉
  });
}
// 实时额度:把 Claude Code 的状态栏命令包一层,每次刷新顺带把额度、上下文发给 Clawd(见 cc.js)
const ccLiveOn = () => { try { return cc.isClawdStatus(readCC().statusLine); } catch { return false; } };
function toggleLive(on) {
  try { editCC(cfg => cc.setStatusLine(cfg, on, HOOK_PORT)); }
  catch (e) { dialog.showErrorBox(t('没能修改 Claude Code 配置'), `${ccSettingsFile()}\n\n${e.message}\n\n${t('文件没有被改动。')}`); }
  refreshMenus();
  if (on && ccLiveOn()) dialog.showMessageBox({ message: t('已打开：实时额度'), detail: t('Claude Code 每次刷新底部状态栏时，会顺带把额度和上下文用量告诉 Clawd：血条跟着每次回复更新，不用再每 5 分钟查一次。你原来的状态栏照常显示。\n\n如果你原来没有设置状态栏，Claude Code 底部的一些按键提示（比如 esc to interrupt）会不再显示。只有 Pro / Max 订阅才有额度数据。') });
}
function toggleApprove(on) {
  try { editCCHooks(set => set('PermissionRequest', on ? { command: APPROVE_CMD, timeout: 75 } : null)); }
  catch (e) { dialog.showErrorBox(t('没能修改 Claude Code 配置'), `${ccSettingsFile()}\n\n${e.message}\n\n${t('文件没有被改动。')}`); }
  refreshMenus();
  if (on && ccApproveOn()) dialog.showMessageBox({ message: t('已打开：在 Clawd 上批准权限'), detail: t('Claude 要你批准时，如果它所在的终端 / App 不在最前面，Clawd 会弹出「允许 / 拒绝 / 去终端处理」，也可以「总是允许」，或者写一句原因再拒绝；60 秒没点就交回终端照常弹框。终端在最前面时不拦，直接在终端里批准。\n\nClaude 问你选择题时也一样，可以直接点选项，或者自己写回答。\n\n新开的 Claude Code 会话才生效。') });
}
function toggleCCHooks(on) {
  try { setCCHooks(on); }
  catch (e) {
    dialog.showErrorBox(t('没能修改 Claude Code 配置'), `${ccSettingsFile()}\n\n${e.message}\n\n${t('文件没有被改动。')}`);
  }
  syncPrefs(); refreshMenus();
  if (on && ccHooked()) dialog.showMessageBox({ message: t('已连接 Claude Code'), detail: t('新开的 Claude Code 会话会把「在干什么 / 回复完成 / 需要确认 / 等你输入 / 出错」通知给 Clawd。已经开着的会话需要重新打开才生效。\n\n原配置已备份为 settings.json.clawd-backup。') });
}
// 上下文窗口优先看 CLAUDE_CODE_AUTO_COMPACT_WINDOW(环境变量或 Claude Code 配置里的 env);状态栏送来的窗口大小其次
function contextFill(used, size) {
  let w = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (!(w > 0)) try { w = Number(readCC().env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW); } catch { w = 0; }
  return cc.contextFill(used, w > 0 ? w : size);
}
// 会话标题(Claude App 侧边栏 / /rename 起的名字,没有就用自动生成的):列表里优先显示它,比项目目录名好认。
// 顺带读出上下文用了多少(小螃蟹快满时变胖)。Claude Code 会把标题反复追加到会话记录里,所以只读文件末尾一段
const titles = new Map();   // session → { name, ctx, at }
let ccQueue = Promise.resolve();
function sessionInfo(sid, file, fresh) {
  file = String(file || '');
  const c = titles.get(sid);
  if (!sid || !path.isAbsolute(file) || !file.endsWith('.jsonl')) return Promise.resolve(c || { name: '', ctx: null });
  if (c && !fresh && Date.now() - c.at < 10e3) return Promise.resolve(c);   // 事件很密,10 秒内不重复读(回复完 / 压缩完要马上读)
  return fs.promises.open(file, 'r').then(async fh => {
    try {
      const { size } = await fh.stat(), len = Math.min(size, 1 << 20);
      const { buffer } = await fh.read(Buffer.alloc(len), 0, len, size - len);
      const text = buffer.toString('utf8'), last = re => [...text.matchAll(re)].pop()?.[1];
      const raw = last(/"type":"custom-title","customTitle":("(?:[^"\\]|\\.)*")/g) || last(/"type":"ai-title","aiTitle":("(?:[^"\\]|\\.)*")/g);
      const name = raw ? clip(JSON.parse(raw), 40) : c?.name || '';
      const used = cc.contextUsed(text);
      const info = { name, ctx: used === null ? c?.ctx ?? null : contextFill(used), at: Date.now() };
      titles.set(sid, info);
      return info;
    } finally { fh.close(); }
  }).catch(() => c || { name: '', ctx: null });
}
// 状态栏送来的数据:额度换上最新的(变了才刷新页面),上下文用量交给那个会话的小螃蟹
function onStatus(d) {
  const s = cc.statusInfo(d);
  if (s.limits && setLiveLimits(s.limits)) pushUsage();
  if (!s.session || !s.ctx) return;
  const ctx = contextFill(s.ctx.used, s.ctx.size), c = titles.get(s.session);
  if (c) c.ctx = ctx;
  if (win && !win.isDestroyed()) win.webContents.send('cc', { event: 'Status', session: s.session, ctx, at: Date.now() });
}
const isQuotaCheck = d => path.basename(String(d.cwd || '')) === path.basename(QUOTA_DIR);   // Clawd 自己跑 claude 查额度时的事件
http.createServer((req, res) => {
  if (req.method !== 'POST' || !['/hook', '/permission', '/status'].includes(req.url)) { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });   // PostToolUse 带着工具输出,可能比较大
  req.on('end', () => {
    const perm = req.url === '/permission';
    if (!perm) res.end('ok');
    let d; try { d = JSON.parse(body); } catch { return res.end(''); }
    if (!d || typeof d !== 'object') return res.end('');
    if (req.url === '/status') return onStatus(d);
    if (!perm && isQuotaCheck(d)) return;
    const where = cc.hookWhere(req.headers);
    if (perm) return askPermission(res, d, where);
    const ev = cc.hookEvent(d);
    countHook(ev);
    ccQueue = ccQueue.then(() => sessionInfo(ev.session, d.transcript_path, ev.event === 'Stop' || ev.event === 'PostCompact'))   // 排队发,读标题再慢也不打乱事件顺序
      .then(({ name, ctx }) => { if (win && !win.isDestroyed()) win.webContents.send('cc', { ...where, ...ev, title: name || ev.stitle, ctx }); });
  });
}).on('error', e => console.error('Clawd hooks 接口启动失败', e.message)).listen(HOOK_PORT, '127.0.0.1');

// ---------- 重启后补回正在跑的会话 ----------
// 会话只记在内存里:Clawd 重启(更新、开机自启、页面重载)后,正在跑长命令的会话要等它下一个事件才会出现。
// 页面载入后扫一遍最近 30 分钟写过的会话记录,停在「调用工具还没出结果」或「Claude 还没答完」的当作正在干活补上。
// 会话记录里只看得出是不是 Claude App 里开的,点这只小螃蟹跳不到具体标签页 / 会话,等它下一个事件来了就准了
async function restoreSessions() {
  const cutoff = Date.now() - 30 * 60e3;
  for (const file of projectDirs().flatMap(d => listJsonl(d))) {
    if (!/^[0-9a-f-]{36}\.jsonl$/.test(path.basename(file))) continue;   // 子助手的记录不算
    try {
      const { size, mtimeMs } = fs.statSync(file);
      if (mtimeMs < cutoff) continue;
      const fh = await fs.promises.open(file, 'r'), len = Math.min(size, 1 << 20);
      let text;
      try { text = (await fh.read(Buffer.alloc(len), 0, len, size - len)).buffer.toString('utf8'); } finally { await fh.close(); }
      const step = runningStep(text);
      if (!step || !step.sid) continue;
      const { name, ctx } = await sessionInfo(step.sid, file);
      if (win && !win.isDestroyed()) win.webContents.send('cc', {
        event: 'Restore', state: step.state, session: step.sid, project: step.cwd ? path.basename(step.cwd) : '', title: name, ctx, at: Date.now(),
        tool: toolName(step.name), detail: toolDetail(step.name, step.input),
        app: text.includes('"entrypoint":"claude-desktop"') ? 'com.anthropic.claudefordesktop' : '', tty: '', host: '' });
    } catch (e) { console.error('补回会话失败', file, e.message); }
  }
}

// ---------- 日报 / 周报 ----------
// 按天记下:哪些会话发过指令、Claude 干活的时长(发出指令 → 回复完成)和花在哪个项目、测试通过 / commit / push 几次。
// 存在 userData/stats.json,只留最近 14 天
const statsFile = () => path.join(app.getPath('userData'), 'stats.json');
const stats = (() => { try { return JSON.parse(fs.readFileSync(statsFile(), 'utf8')); } catch { return {}; } })();
let statsTimer = null;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function statDay() {   // 今天的记录(要改它,所以顺手安排 2 秒后写盘)
  const k = dayKey();
  if (!stats[k]) {
    stats[k] = { sessions: {}, workMs: 0, projects: {}, test: 0, commit: 0, push: 0 };
    for (const old of Object.keys(stats).sort().slice(0, -14)) delete stats[old];
  }
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => { try { fs.writeFileSync(statsFile(), JSON.stringify(stats)); } catch (e) { console.error('保存统计失败', e); } }, 2000);
  return stats[k];
}
const turnStart = new Map();   // session → 这一轮发出指令的时间
function countHook(ev) {
  if (!ev.session) return;
  if (ev.event === 'UserPromptSubmit') { statDay().sessions[ev.session] = 1; turnStart.set(ev.session, ev.at); }
  else if ((ev.event === 'Stop' || ev.event === 'StopFailure') && turnStart.has(ev.session)) {
    const ms = Math.min(ev.at - turnStart.get(ev.session), 6 * 3600e3), d = statDay();   // 跨天的一轮算在结束那天
    turnStart.delete(ev.session);
    d.workMs += ms;
    if (ev.project) d.projects[ev.project] = (d.projects[ev.project] || 0) + ms;
  }
}
ipcMain.on('stat', (_e, kind) => { if (['test', 'commit', 'push'].includes(kind)) statDay()[kind]++; });   // 页面认出的命令:测试通过 / commit / push
function report(from) {   // 从 from 那天(含)到今天的汇总
  const r = { sessions: 0, workMs: 0, test: 0, commit: 0, push: 0, top: '' }, ids = new Set(), proj = {}, since = dayKey(from);
  for (const [k, d] of Object.entries(stats)) {
    if (k < since) continue;
    Object.keys(d.sessions).forEach(id => ids.add(id));
    r.workMs += d.workMs; r.test += d.test; r.commit += d.commit; r.push += d.push;
    for (const [p, ms] of Object.entries(d.projects)) proj[p] = (proj[p] || 0) + ms;
  }
  r.sessions = ids.size;
  r.top = Object.entries(proj).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return r;
}
function reports() {   // 今天、近 7 天(用量面板)、本周一起(周五的周报),加上花费
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last7 = new Date(today); last7.setDate(today.getDate() - 6);
  const monday = new Date(today); monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
  return { today: report(today), last7: report(last7), week: { ...report(monday), cost: tracker.costSince(monday.getTime()) },
    day: dayKey(), shown: loadSettings().reportShown || '' };
}
ipcMain.on('report-shown', (_e, day) => saveSetting('reportShown', String(day)));

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
// ⌃⌥⌘C:在 Clawd 头顶打开会话框,用键盘挑一个跳过去。↑ ↓ ⏎ Esc 只在框开着时占用,关了就放掉
const SESS_KEY = 'Control+Alt+Command+C', NAV_KEYS = { Up: 'up', Down: 'down', Return: 'go', Escape: 'close' };
function syncSessKey() {
  if (globalShortcut.isRegistered(SESS_KEY)) globalShortcut.unregister(SESS_KEY);
  if (sessKey && !globalShortcut.register(SESS_KEY, () => { if (hidden) restore(); send('kb-open'); })) console.error('⌃⌥⌘C 被别的 App 占用了');
}
function kbNav(on) {
  for (const [k, d] of Object.entries(NAV_KEYS)) {
    if (on && !globalShortcut.isRegistered(k)) globalShortcut.register(k, () => send('kb:' + d));
    else if (!on && globalShortcut.isRegistered(k)) globalShortcut.unregister(k);
  }
}
ipcMain.on('kb-nav', (_e, on) => kbNav(!!on));
const alwaysAllow = sugs => cc.alwaysAllow(sugs, t);
function permReply(id, behavior, answers, message) {
  const p = perms.get(id);
  if (!p) return;
  perms.delete(id); clearTimeout(p.timer); syncPermKeys();
  p.res.end(cc.permReplyBody(cc.permDecision(p, behavior, answers, message)));
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
    const ask = name === 'AskUserQuestion' && Array.isArray(d.tool_input?.questions) ? d.tool_input : null;   // Claude 出的选择题
    if (ask) perms.get(id).input = ask;
    const always = !ask && alwaysAllow(d.permission_suggestions);
    if (always) perms.get(id).always = always.list;
    const preview = name === 'Bash' ? String(d.tool_input?.command || '').trim() : toolDetail(name, d.tool_input);
    win.webContents.send('perm', {
      id, ...where, session: String(d.session_id || ''), project: d.cwd ? path.basename(String(d.cwd)) : '', title: titles.get(String(d.session_id || ''))?.name || '',
      tool: toolName(name), preview: preview.length > 300 ? preview.slice(0, 299) + '…' : preview, always: always ? always.label : '',
      questions: ask && ask.questions.map(q => ({ question: String(q.question || ''), multi: !!q.multiSelect,
        options: (q.options || []).map(o => ({ label: String(o.label || ''), description: String(o.description || '') })) })),
    });
  });
}
ipcMain.on('perm-decision', (_e, id, behavior, answers, message) => permReply(Number(id), String(behavior),
  answers && typeof answers === 'object' ? Object.fromEntries(Object.entries(answers).map(([k, v]) => [String(k), String(v)])) : null,
  typeof message === 'string' ? message.trim().slice(0, 2000) : ''));
// 在选择题气泡里自己写回答、在批准气泡里写拒绝的原因:这时才让窗口能拿到键盘,写完 / 点走就还回去,平时打字照旧进你当前的 App
ipcMain.on('perm-typing', (_e, on) => {
  if (!win || win.isDestroyed()) return;
  win.setFocusable(!!on);
  if (on) { app.focus({ steal: true }); win.focus(); }
});

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

// ---------- 多显示器:Clawd 待在哪块屏幕上(记在设置里;那块屏幕拔掉时先回主屏,插回来再回去) ----------
let displayId = Number(loadSettings().display) || 0;
const curDisplay = () => screen.getAllDisplays().find(d => d.id === displayId) || screen.getPrimaryDisplay();
const workArea = () => curDisplay().workArea;
// 搬到另一块屏幕:窗口铺满那块屏幕的工作区,Clawd 从 at(光标的屏幕坐标)落下;不给 at 就从屏幕中间上方掉下来
function moveToDisplay(d, at) {
  if (!win || win.isDestroyed()) return;
  displayId = d.id; saveSetting('display', d.id);
  const wa = d.workArea;
  win.setBounds(wa);
  const x = at ? at.x - wa.x : wa.width / 2, y = at ? at.y - wa.y : -40;
  send(`display:${Math.round(x)},${Math.round(y)},${wa.width},${wa.height}`);
  refreshMenus();
}
function nextDisplay() {
  const all = screen.getAllDisplays(), i = all.findIndex(d => d.id === curDisplay().id);
  moveToDisplay(all[(i + 1) % all.length]);
}
// 拖着 Clawd 松手时光标在别的屏幕上:搬过去
ipcMain.on('drop-display', () => {
  const p = screen.getCursorScreenPoint(), d = screen.getDisplayNearestPoint(p);
  if (d.id !== curDisplay().id) moveToDisplay(d, p);
});
// ---------- 用量:每 30 秒增量扫描一次 Claude Code 的本地会话记录 ----------
const tracker = new UsageTracker();
function pushUsage() {
  if (!win || win.isDestroyed()) return;
  try {
    tracker.scan();
    const sum = tracker.summary();
    sum.report = reports();
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
        report: { day: 'demo', shown: 'demo',
          today: { sessions: 7, workMs: 312 * 60e3, test: 12, commit: 4, push: 2, top: 'clawd-pet' },
          last7: { sessions: 31, workMs: 1490 * 60e3, test: 58, commit: 23, push: 11, top: 'clawd-pet' },
          week: { sessions: 24, workMs: 1150 * 60e3, test: 41, commit: 17, push: 8, top: 'clawd-pet', cost: 46.2 } },
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
// 订阅额度:调用 `claude -p "/usage"` 查询(约 5 秒,不消耗额度)。每 5 分钟一次;点开气泡时若超过 1 分钟也刷新。
// 打开了实时额度、状态栏 5 分钟内送来过额度时不用查
let limitsAt = 0;
function refreshLimits(force = false) {
  if (Date.now() - limitsLiveAt() < 5 * 60e3) return;
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
    restoreSessions();
    kbNav(false);   // 页面重载前会话框开着:放掉 ↑ ↓ ⏎ Esc
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
      const other = screen.getDisplayNearestPoint(p).id !== curDisplay().id;   // 光标在别的屏幕上:拖着 Clawd 在那儿松手就搬过去
      win.webContents.send('cursor', { x, y, other });
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
      ...(screen.getAllDisplays().length > 1 ? [{ label: t('移到下一块屏幕'), click: nextDisplay }] : []),
    ] },
    { type: 'separator' },
    { label: 'Claude Code', submenu: [
      { label: t('连接 Claude Code(任务提醒)'), type: 'checkbox', checked: ccHooked(), click: (item) => toggleCCHooks(item.checked) },
      { type: 'separator' },
      { label: t('回复完成时提醒'), type: 'checkbox', checked: ccNotifyDone, enabled: ccHooked(), click: (item) => setPref('ccNotifyDone', item.checked) },
      { label: t('需要确认 / 等你输入时提醒'), type: 'checkbox', checked: ccNotifyAsk, enabled: ccHooked(), click: (item) => setPref('ccNotifyAsk', item.checked) },
      { label: t('实时额度(经由状态栏)'), type: 'checkbox', checked: ccLiveOn(), enabled: ccHooked(), click: (item) => toggleLive(item.checked) },
      { label: t('在 Clawd 上批准权限'), type: 'checkbox', checked: ccApproveOn(), enabled: ccHooked(), click: (item) => toggleApprove(item.checked) },
      { label: t('头顶显示会话小螃蟹'), type: 'checkbox', checked: ccCrabs, enabled: ccHooked(), click: (item) => setPref('ccCrabs', item.checked) },
      { label: t('下班时递日报(周五是周报)'), type: 'checkbox', checked: ccReport, enabled: ccHooked(), click: (item) => setPref('ccReport', item.checked) },
      { label: t('⌃⌥⌘C 打开会话列表'), type: 'checkbox', checked: sessKey, enabled: ccHooked(), click: (item) => setPref('sessKey', item.checked) },
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
  syncSessKey();

  // 开发自测(只在 npm start 时生效):
  //   CLAWD_SELFTEST=1     —— 4 秒后收起,8 秒后放出
  //   CLAWD_SELFTEST=usage —— 3 秒后弹出用量气泡
  //   CLAWD_SELFTEST=cling —— 3 秒后贴到屏幕边上
  //   CLAWD_SELFTEST=report / report-week —— 3 秒后递日报 / 周报
  const selftest = !app.isPackaged && process.env.CLAWD_SELFTEST;
  if (selftest === 'usage') setTimeout(() => { pushUsage(); send('usage'); }, 3000);
  else if (selftest === 'report' || selftest === 'report-week') setTimeout(() => { pushUsage(); send(selftest === 'report' ? 'show-report:day' : 'show-report:week'); }, 3000);
  else if (selftest === 'cling') setTimeout(() => send('cling'), 3000);
  else if (selftest) {
    setTimeout(minimize, 4000);
    setTimeout(restore, 8000);
  }

  // 分辨率 / 显示器变化时重新铺满工作区(Clawd 那块屏幕拔掉了就铺到主屏);菜单里「移到下一块屏幕」跟着出现 / 消失
  const refit = () => { if (win) win.setBounds(workArea()); refreshMenus(); };
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
    if (!away && idle >= AWAY_AFTER) { away = true; send('away:' + (Date.now() - idle * 1000)); }   // 带上你最后一次动键盘鼠标的时间
    else if (away && idle < 3) { away = false; send('back'); }
  }, 2000);
});

// 点 Dock 图标:收起时放出来;已经在外面就跳一下打个招呼
app.on('activate', () => { if (hidden) restore(); else send('jump'); });

app.on('window-all-closed', () => app.quit());
