// Clawd 桌宠 —— 主进程
// 一个铺满主屏工作区(菜单栏以下、Dock 以上)的透明置顶窗口。
// 默认鼠标穿透;只有光标落在 Clawd 身上时才接收点击,所以不会挡住你的操作。
// 菜单栏和 Dock 里都常驻一个图标:可以把 Clawd "收起来"(最小化),再点一下放出来。
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
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
      sum.limits = { fiveHour: { used: 100 - rem, remaining: rem, resetsAt: Date.now() + 90 * 60000 },
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
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  loadPet();
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', () => {
    // 页面(重新)载入后,把菜单里的开关状态同步过去
    if (!wander) send('wander-off');
    if (passthrough) send('passthrough-on');
    send('hp:' + hpMode);
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
  const items = [
    { label: hidden ? '放出 Clawd' : '收起 Clawd', click: toggle },
    { label: '查看用量', click: () => { pushUsage(); act('usage')(); } },
    { type: 'separator' },
    { label: '跳一下', click: act('jump') },
    { label: '打招呼', click: act('wave') },
    { label: '跳舞', click: act('dance') },
    { label: '探头张望', click: act('lean') },
    { label: '散散步', click: act('walk') },
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
    { label: '血条', submenu: HP_MODES.map(([name, v]) => ({ label: name, type: 'radio', checked: hpMode === v, click: () => setHpMode(v) })) },
    { label: '大小', submenu: SIZES.map(([name, v]) => ({ label: name, type: 'radio', checked: petScale === v, click: () => setScale(v) })) },
    { label: clinging ? '离开边缘' : '贴到屏幕边上', click: act('cling') },
    { label: '回到屏幕中间', click: act('home') },
  ];
  if (app.isPackaged) {
    items.push({ label: '开机自动启动', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenus(); } });
  }
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
    app.dock.show();
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
