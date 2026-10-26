'use strict';

/**
 * 洛谷桌面客户端 —— 主进程
 *
 * 外壳特性：
 *   · 无系统标题栏（frameless）+ 整窗透明，能看到桌面；文字不受影响
 *   · 借用洛谷自己的顶栏当拖动区域，右上角是自绘的 透明度滑块 / 全屏 / 最小化 / 最大化 / 关闭
 *   · 全屏时这些按钮整条隐藏，按 Esc 退出全屏，F11 进出
 *   · 站内链接本窗口打开，站外链接交给系统浏览器
 *   · 拦截常见广告/统计域名；页面内推广位由 preload 隐藏
 *   · 所有数据（登录态、缓存）都留在  D:\LuoguClient\数据
 */

const { app, BrowserWindow, Menu, shell, session, clipboard, ipcMain, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_DIR = __dirname;
const ROOT_DIR = path.dirname(APP_DIR);
const DATA_DIR = path.join(ROOT_DIR, '数据');
const HOME = 'https://www.luogu.com.cn/';
const INTERNAL_HOSTS = ['luogu.com.cn', 'luogu.org'];

// 可选的开关文件：app\config.json
//   { "hidePromos": true, "blockAds": true }
// 想关掉去广告，把对应项改成 false 即可（不动代码）
let appConfig = { hidePromos: true, blockAds: true };
try {
  const raw = fs.readFileSync(path.join(APP_DIR, 'config.json'), 'utf8');
  appConfig = Object.assign(appConfig, JSON.parse(raw));
} catch (e) {
  /* 没有配置文件就用默认值 */
}

const CONFIG_DIR = path.join(DATA_DIR, '配置');
const CACHE_DIR = path.join(DATA_DIR, '缓存');

fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

app.setPath('userData', CONFIG_DIR);
app.setPath('sessionData', CACHE_DIR);
app.commandLine.appendSwitch('lang', 'zh-CN');
app.setAppUserModelId('luogu.desktop.client');

/* ---------------------------------------------------------------- 广告拦截 */

const BLOCKED_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'hm.baidu.com',
  'cpro.baidu.com',
  'pos.baidu.com',
  'cbjs.baidu.com',
  'cnzz.com',
  '51.la',
  'umeng.com',
  'errtrack.luogu.com.cn',
];

// 只把真正要拦的域名交给 webRequest：
// 用 '*://*/*' 会让每一个请求都过一趟主进程，页面/路由切换会明显变慢
const BLOCK_PATTERNS = BLOCKED_HOSTS.flatMap(h => ['*://' + h + '/*', '*://*.' + h + '/*']);

function installAdBlock() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest({ urls: BLOCK_PATTERNS }, (details, callback) => {
    let host = '';
    try {
      host = new URL(details.url).hostname;
    } catch (e) {
      return callback({});
    }
    const blocked = BLOCKED_HOSTS.some(h => host === h || host.endsWith('.' + h));
    callback({ cancel: blocked });
  });
}

/* ------------------------------------------------------------ 主题状态回传 */

const STATE_FILE = path.join(DATA_DIR, '窗口.json');


function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeState(patch) {
  const next = Object.assign(readState(), patch);
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    /* 忽略 */
  }
}

function installThemeBridge() {
  ipcMain.on('lgd-theme', (_event, nextMode) => {
    const dark = nextMode !== 'light';
    writeState({ theme: dark ? 'dark' : 'light' });
  });
}

function isInternal(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return INTERNAL_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------------- 右键菜单 */

function installContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      );
    } else if (params.selectionText) {
      template.push({ label: '复制', role: 'copy' }, { label: '复制为纯文本', click: () => clipboard.writeText(params.selectionText) });
    }
    if (params.linkURL) {
      if (template.length) template.push({ type: 'separator' });
      template.push({ label: '在浏览器中打开链接', click: () => shell.openExternal(params.linkURL) });
      template.push({ label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) });
    }
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

/* ---------------------------------------------------------------- 快捷键 */

function installShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // Esc：退出全屏（全屏时才有意义）
    if (input.key === 'Escape' && fullScreenState) {
      event.preventDefault();
      setImmediate(() => setFullScreen(false));
      return;
    }
    // Alt+← / Alt+→：后退 / 前进
    if (input.alt && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) {
      const wc = win.webContents;
      const nav = wc.navigationHistory || wc;
      try {
        if (input.key === 'ArrowLeft' && nav.canGoBack()) nav.goBack();
        if (input.key === 'ArrowRight' && nav.canGoForward()) nav.goForward();
      } catch (e) {
        /* 忽略 */
      }
      event.preventDefault();
      return;
    }
    // F5：刷新
    if (input.key === 'F5') {
      win.webContents.reload();
      event.preventDefault();
      return;
    }
    // F11：进出全屏
    if (input.key === 'F11') {
      event.preventDefault();
      const next = !fullScreenState;
      setImmediate(() => setFullScreen(next));
      return;
    }
    if (!input.control || input.alt || input.meta) return;

    const key = input.key;
    const wc = win.webContents;
    if (key === '=' || key === '+') {
      wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4));
      event.preventDefault();
    } else if (key === '-') {
      wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
      event.preventDefault();
    } else if (key === '0') {
      wc.setZoomLevel(0);
      event.preventDefault();
    } else if (key === 'r' || key === 'R') {
      wc.reload();
      event.preventDefault();
    } else if (key === 'w' || key === 'W') {
      win.close();
      event.preventDefault();
    } else if (key === 'm' || key === 'M') {
      win.minimize();
      event.preventDefault();
    }
  });
}

/* ------------------------------------------------------------ 窗口按钮 IPC */

let ipcInstalled = false;

function installWindowIpc() {
  if (ipcInstalled) return;
  ipcInstalled = true;

  ipcMain.on('win:theme', (_event, mode) => {
    // 只在真的变了的时候才动系统材质：每次页面加载都设一遍会让 DWM 重建背景，切换会顿一下
    const src = mode === 'light' ? 'light' : 'dark';
    if (nativeTheme.themeSource === src) return;
    try {
      nativeTheme.themeSource = src;
    } catch (e) {
      /* 忽略 */
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setBackgroundMaterial(mainWindow.__mat || 'acrylic');
        if (mainWindow.__bg) mainWindow.setBackgroundColor(mainWindow.__bg);
      } catch (e) {
        /* 忽略 */
      }
    }
  });

  ipcMain.on('win:frost', (_event, mode) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const mat = mode === 'clear' ? 'none' : 'acrylic';
    if (mainWindow.__mat !== mat) {
      mainWindow.__mat = mat;
      try {
        mainWindow.setBackgroundMaterial(mat);
        // setBackgroundMaterial 会把窗口底色重置掉，这里补回当前那档透明度
        if (mainWindow.__bg) mainWindow.setBackgroundColor(mainWindow.__bg);
      } catch (e) {
        /* 老系统上不支持就算了 */
      }
    }
    writeState({ frost: mode });
  });

  ipcMain.on('win:bg', (_event, rgba) => {
    if (!mainWindow || mainWindow.isDestroyed() || typeof rgba !== 'string') return;
    if (mainWindow.__bg === rgba) return; // 同一个值反复设也会触发重绘
    mainWindow.__bg = rgba;
    try {
      mainWindow.setBackgroundColor(rgba);
    } catch (e) {
      /* 忽略 */
    }
  });

  ipcMain.on('win:nav', (_event, action) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wc = mainWindow.webContents;
    const nav = wc.navigationHistory || wc;
    try {
      if (action === 'back') {
        if (nav.canGoBack()) nav.goBack();
      } else if (action === 'forward') {
        if (nav.canGoForward()) nav.goForward();
      } else if (action === 'reload') {
        wc.reload();
      }
    } catch (e) {
      /* 忽略 */
    }
  });

  ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('win:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('win:close', () => mainWindow && mainWindow.close());
  ipcMain.on('win:fullscreen', (_event, on) => {
    if (!mainWindow) return;
    const next = typeof on === 'boolean' ? on : !fullScreenState;
    setImmediate(() => setFullScreen(next));
  });
  ipcMain.on('win:set-bounds', (_event, b) => {
    if (!mainWindow || mainWindow.isDestroyed() || !b) return;
    const cur = mainWindow.getBounds();
    const width = Math.max(960, Math.round(b.width || cur.width));
    const height = Math.max(620, Math.round(b.height || cur.height));
    mainWindow.setBounds({
      x: Math.round(b.x === undefined ? cur.x : b.x),
      y: Math.round(b.y === undefined ? cur.y : b.y),
      width,
      height,
    });
  });

  ipcMain.handle('win:bounds', () =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null
  );

  ipcMain.handle('win:query', () => ({
    maximized: !!(mainWindow && mainWindow.isMaximized()),
    fullScreen: fullScreenState,
  }));
}

/* ---------------------------------------------------------------- 主窗口 */

let mainWindow = null;
// transparent 窗口上 isFullScreen() 会返回 false，所以自己记一份
let fullScreenState = false;

let fsBusy = false;

function setFullScreen(on) {
  if (!mainWindow || mainWindow.isDestroyed() || fsBusy) return;
  const next = !!on;
  if (next === fullScreenState) return;
  fsBusy = true;
  mainWindow.setFullScreen(next);
  fullScreenState = next;
  setTimeout(() => {
    fsBusy = false;
  }, 700);
  if (mainWindow.webContents) {
    mainWindow.webContents.send('win:state', {
      maximized: mainWindow.isMaximized(),
      fullScreen: fullScreenState,
    });
  }
}

function createWindow() {
  const st = readState();

  mainWindow = new BrowserWindow({
    width: st.width || 1440,
    height: st.height || 920,
    x: typeof st.x === 'number' ? st.x : undefined,
    y: typeof st.y === 'number' ? st.y : undefined,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: '洛谷',
    icon: path.join(APP_DIR, 'icon.ico'),
    // 无边框 + 整窗透明：桌面透进来，页面自己的底色交给 CSS 做半透明
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    backgroundMaterial: st.frost === 'clear' ? 'none' : 'acrylic',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);

  if (st.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const pushState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('win:state', {
      maximized: mainWindow.isMaximized(),
      fullScreen: fullScreenState,
    });
  };

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    if (!maximized && !fullScreenState) {
      const b = mainWindow.getBounds();
      writeState({ width: b.width, height: b.height, x: b.x, y: b.y });
    }
    writeState({ maximized });
  };

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('close', saveBounds);
  mainWindow.on('maximize', pushState);
  mainWindow.on('unmaximize', pushState);
  mainWindow.on('enter-full-screen', () => {
    fullScreenState = true;
    pushState();
  });
  mainWindow.on('leave-full-screen', () => {
    fullScreenState = false;
    pushState();
  });

  const wc = mainWindow.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) mainWindow.loadURL(url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const pushNav = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const nav = wc.navigationHistory || wc;
    let canBack = false;
    let canForward = false;
    try {
      canBack = nav.canGoBack();
      canForward = nav.canGoForward();
    } catch (e) {
      /* 忽略 */
    }
    wc.send('win:nav-state', { canBack, canForward });
  };
  wc.on('did-navigate', pushNav);
  wc.on('did-navigate-in-page', pushNav);
  wc.on('did-finish-load', pushNav);

  wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    wc.loadFile(path.join(APP_DIR, 'offline.html'), { query: { url: validatedURL || HOME, code: String(errorCode) } });
  });

  // 登录页会触发 Windows 通行密钥（WebAuthn）弹窗，直接不响应账号选择
  wc.on('select-webauthn-account', event => {
    event.preventDefault();
  });

  installContextMenu(mainWindow);
  installShortcuts(mainWindow);
  installWindowIpc();

  mainWindow.loadURL(HOME);
}

/* ---------------------------------------------------------------- 生命周期 */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (appConfig.blockAds !== false) installAdBlock();
    installThemeBridge();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
