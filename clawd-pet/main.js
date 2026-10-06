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

const workArea = () => screen.getPrimaryDisplay().workArea;
// ---------- 用量:每 30 秒增量扫描一次 Claude Code 的本地会话记录 ----------
const tracker = new UsageTracker();
function pushUsage() {
  if (!win || win.isDestroyed()) return;
  try { tracker.scan(); win.webContents.send('usage', tracker.summary()); } catch (e) { console.error('用量统计失败', e); }
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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', () => { pushUsage(); refreshLimits(true); });

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
  const selftest = !app.isPackaged && process.env.CLAWD_SELFTEST;
  if (selftest === 'usage') setTimeout(() => { pushUsage(); send('usage'); }, 3000);
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
