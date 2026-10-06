// Clawd 桌宠 —— 主进程
// 一个铺满主屏工作区(菜单栏以下、Dock 以上)的透明置顶窗口。
// 默认鼠标穿透;只有光标落在 Clawd 身上时才接收点击,所以不会挡住你的操作。
// 菜单栏和 Dock 里都常驻一个图标:可以把 Clawd "收起来"(最小化),再点一下放出来。
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
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
let petScale = Number(loadSettings().scale) || 1;
// 血条:一直显示 / 鼠标悬停时显示 / 关闭
const HP_MODES = [['一直显示', 'always'], ['鼠标悬停时显示', 'hover'], ['关闭', 'off']];
let hpMode = HP_MODES.some(([, v]) => v === loadSettings().hpMode) ? loadSettings().hpMode : 'always';
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
function syncPrefs() {
  send('chat:' + chatLevel); send('break:' + breakMin); send('holiday:' + (holiday ? 'on' : 'off'));
  send('cc-notify:' + (ccNotifyDone ? 1 : 0) + (ccNotifyAsk ? 1 : 0)); send('cc-hooks:' + (ccHooked() ? 'on' : 'off'));
}
function setPref(key, v) {
  ({ chatLevel: () => (chatLevel = v), breakMin: () => (breakMin = v), holiday: () => (holiday = v),
     ccNotifyDone: () => (ccNotifyDone = v), ccNotifyAsk: () => (ccNotifyAsk = v) })[key]();
  saveSetting(key, v); syncPrefs(); refreshMenus();
}

// ---------- 和 Claude Code 联动 ----------
// Clawd 在本机 127.0.0.1 开一个小接口;Claude Code 的 hooks(回复完成 / 需要确认 / 等你输入 / 发出指令)
// 用 curl 把事件发过来。Clawd 没开着时 curl 静默失败,不影响 Claude Code。
const HOOK_PORT = (!app.isPackaged && Number(process.env.CLAWD_HOOK_PORT)) || 47615;   // 开发自测可换端口,避免和正在运行的 Clawd 冲突
const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd'];
const HOOK_MARK = 'clawd-hook';
const HOOK_CMD = `curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${HOOK_PORT}/hook >/dev/null 2>&1 || true # ${HOOK_MARK}`;
// 开发自测可以用 CLAWD_CC_SETTINGS 指向一个临时文件,避免动到真正的配置
const ccSettingsFile = () => (!app.isPackaged && process.env.CLAWD_CC_SETTINGS) || path.join(os.homedir(), '.claude', 'settings.json');
function readCC() {
  try { return JSON.parse(fs.readFileSync(ccSettingsFile(), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }   // 文件损坏时抛出,不去覆盖它
}
const isClawdHook = h => typeof h.command === 'string' && h.command.includes(HOOK_MARK);
function ccHooked() {
  try { const h = readCC().hooks || {}; return HOOK_EVENTS.every(ev => (h[ev] || []).some(g => (g.hooks || []).some(isClawdHook))); }
  catch { return false; }
}
// 只增删 Clawd 自己的那几条,别的 hooks 原样保留;改之前先备份
function setCCHooks(on) {
  const file = ccSettingsFile();
  const cfg = readCC();
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.clawd-backup');
  const hooks = cfg.hooks || {};
  for (const ev of HOOK_EVENTS) {
    const groups = (hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isClawdHook(h)) })).filter(g => g.hooks.length);
    if (on) groups.push({ hooks: [{ type: 'command', command: HOOK_CMD, timeout: 5 }] });
    if (groups.length) hooks[ev] = groups; else delete hooks[ev];
  }
  if (Object.keys(hooks).length) cfg.hooks = hooks; else delete cfg.hooks;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}
function toggleCCHooks(on) {
  try { setCCHooks(on); }
  catch (e) {
    dialog.showErrorBox('没能修改 Claude Code 配置', `${ccSettingsFile()}\n\n${e.message}\n\n文件没有被改动。`);
  }
  syncPrefs(); refreshMenus();
  if (on && ccHooked()) dialog.showMessageBox({ message: '已连接 Claude Code', detail: '新开的 Claude Code 会话会把「回复完成 / 需要确认 / 等你输入」通知给 Clawd。已经开着的会话需要重新打开才生效。\n\n原配置已备份为 settings.json.clawd-backup。' });
}
http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/hook') { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    res.end('ok');
    let d; try { d = JSON.parse(body); } catch { return; }
    if (win && !win.isDestroyed()) win.webContents.send('cc', {
      event: String(d.hook_event_name || ''), session: String(d.session_id || ''),
      project: d.cwd ? path.basename(String(d.cwd)) : '', message: String(d.message || ''), at: Date.now(),
    });
  });
}).on('error', e => console.error('Clawd hooks 接口启动失败', e.message)).listen(HOOK_PORT, '127.0.0.1');

function setHpMode(v) { hpMode = v; saveSetting('hpMode', v); send('hp:' + v); refreshMenus(); }
function loadPet() { win.loadFile('index.html', { query: { scale: String(petScale) } }); }
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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  keepOnTop();
  win.setIgnoreMouseEvents(true);
  loadPet();
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', () => {
    // 页面(重新)载入后,把菜单里的开关状态同步过去
    if (!wander) send('wander-off');
    if (passthrough) send('passthrough-on');
    send('hp:' + hpMode);
    syncPrefs();
    pushUsage(); refreshLimits(true);
  });

  // 持续把光标位置(窗口坐标)发给渲染进程:用于眼睛跟随,以及判断光标是否在 Clawd 身上
  const timer = setInterval(() => {
    if (!win || win.isDestroyed() || hidden) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 16);
  win.on('closed', () => { clearInterval(timer); win = null; });
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
    { label: '自言自语', submenu: CHAT_LEVELS.map(([name, v]) => ({ label: name, type: 'radio', checked: chatLevel === v, click: () => setPref('chatLevel', v) })) },
    { label: '休息提醒', submenu: BREAKS.map(([name, v]) => ({ label: name, type: 'radio', checked: breakMin === v, click: () => setPref('breakMin', v) })) },
    { type: 'separator' },
    { label: '自由活动', type: 'checkbox', checked: wander,
      click: (item) => { wander = item.checked; send(wander ? 'wander-on' : 'wander-off'); refreshMenus(); } },
    { label: '完全穿透(只看不点)', type: 'checkbox', checked: passthrough,
      click: (item) => {
        passthrough = item.checked;
        if (passthrough && win) { ignoring = true; win.setIgnoreMouseEvents(true); }
        send(passthrough ? 'passthrough-on' : 'passthrough-off');
        refreshMenus();
      } },
  ];
  if (process.platform === 'darwin' && app.dock) {
    settings.push({ label: '在 Dock 中显示图标', type: 'checkbox', checked: showDock,
      click: (item) => { showDock = item.checked; saveSetting('showDock', showDock); applyDock(); refreshMenus(); } });
  }
  if (app.isPackaged) {   // 开机自启只对装进「应用程序」的打包版有意义
    settings.push({ type: 'separator' }, { label: '开机自动启动', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenus(); } });
  }
  const items = [
    { label: hidden ? '放出 Clawd' : '收起 Clawd', click: toggle },
    { label: '查看用量', click: () => { pushUsage(); act('usage')(); } },
    { type: 'separator' },
    { label: '动作', submenu: [
      { label: '跳一下', click: act('jump') },
      { label: '打招呼', click: act('wave') },
      { label: '跳舞', click: act('dance') },
      { label: '探头张望', click: act('lean') },
      { label: '散散步', click: act('walk') },
      { label: '伸懒腰', click: act('stretch') },
    ] },
    { label: '位置', submenu: [
      { label: clinging ? '离开边缘' : '贴到屏幕边上', click: act('cling') },
      { label: '回到屏幕中间', click: act('home') },
    ] },
    { type: 'separator' },
    { label: 'Claude Code', submenu: [
      { label: '连接 Claude Code(任务提醒)', type: 'checkbox', checked: ccHooked(), click: (item) => toggleCCHooks(item.checked) },
      { type: 'separator' },
      { label: '回复完成时提醒', type: 'checkbox', checked: ccNotifyDone, enabled: ccHooked(), click: (item) => setPref('ccNotifyDone', item.checked) },
      { label: '需要确认 / 等你输入时提醒', type: 'checkbox', checked: ccNotifyAsk, enabled: ccHooked(), click: (item) => setPref('ccNotifyAsk', item.checked) },
    ] },
    { label: '外观', submenu: [
      { label: '大小', submenu: SIZES.map(([name, v]) => ({ label: name, type: 'radio', checked: petScale === v, click: () => setScale(v) })) },
      { label: '血条', submenu: HP_MODES.map(([name, v]) => ({ label: name, type: 'radio', checked: hpMode === v, click: () => setHpMode(v) })) },
      { label: '节日装扮', type: 'checkbox', checked: holiday, click: (item) => setPref('holiday', item.checked) },
    ] },
    { label: '设置', submenu: settings },
  ];
  if (!forDock) items.push({ type: 'separator' }, { label: '退出 Clawd', role: 'quit' });
  return items;
}

function refreshMenus() {
  if (tray) tray.setToolTip(hidden ? 'Clawd(已收起,点击放出)' : 'Clawd(点击收起)');
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
});

// 点 Dock 图标:收起时放出来;已经在外面就跳一下打个招呼
app.on('activate', () => { if (hidden) restore(); else send('jump'); });

app.on('window-all-closed', () => app.quit());
