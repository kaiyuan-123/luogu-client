'use strict';

/**
 * 洛谷桌面客户端 —— 页面注入（preload）
 *
 *   1. 注入主题样式（暗色 / 亮色 + 背景透明度）
 *   2. 洛谷顶栏右上角：主题开关、背景透明度滑块、全屏 / 最小化 / 最大化 / 关闭
 *   3. 顶栏兼作窗口拖动区域
 *   4. 隐藏站内推广位
 */

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');

const CSS = fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8');
const ATTR = 'data-lgd';
const STORAGE_THEME = 'lgd-theme';
const STORAGE_ALPHA = 'lgd-alpha';
const STORAGE_FROST = 'lgd-frost';
const BTN_ID = 'lgd-toggle';
const CTRL_ID = 'lgd-wincontrols';

const isLuogu = /(^|\.)luogu\.com\.cn$/.test(location.hostname);

// 读取可选的开关文件（app\config.json），没写就用默认值
let appConfig = { hidePromos: true };
try {
  appConfig = Object.assign(appConfig, JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')));
} catch (e) {
  /* 忽略 */
}

/* ------------------------------------------------------------------ 主题 */

function readTheme() {
  try {
    const v = localStorage.getItem(STORAGE_THEME);
    return v === 'dark' || v === 'light' ? v : null;
  } catch (e) {
    return null;
  }
}

function writeTheme(v) {
  try {
    localStorage.setItem(STORAGE_THEME, v);
  } catch (e) {
    /* 忽略 */
  }
  try {
    ipcRenderer.send('lgd-theme', v);
  } catch (e) {
    /* 忽略 */
  }
}

let mode = 'dark';

function applyTheme(next, persist) {
  mode = next === 'dark' ? 'dark' : 'light';
  const root = document.documentElement;
  if (!root) return;
  // 两种模式都打标记，CSS 才能分别给底色加透明度
  root.setAttribute(ATTR, mode);
  if (persist) writeTheme(mode);
  syncWindowBg();
  if (lastSentTheme !== mode) {
    lastSentTheme = mode;
    try {
      ipcRenderer.send('win:theme', mode);
    } catch (e) {
      /* 忽略 */
    }
  }
  syncThemeButton();
}

function toggleTheme() {
  applyTheme(mode === 'dark' ? 'light' : 'dark', true);
}

/* ------------------------------------------------------------------ 磨砂 */

let frostMode = 'frost'; // 'clear' 纯透明 | 'frost' 磨砂(亚克力)

function normalizeFrost(v) {
  return v === 'clear' ? 'clear' : 'frost';
}

function applyFrost(next, persist) {
  frostMode = normalizeFrost(next);
  syncWindowBg();
  document.documentElement.setAttribute('data-lgd-frost', frostMode);
  try {
    ipcRenderer.send('win:frost', frostMode);
  } catch (e) {
    /* 忽略 */
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_FROST, frostMode);
    } catch (e) {
      /* 忽略 */
    }
  }
  syncFrostMenu();
}

function initFrost() {
  let v = null;
  try {
    v = localStorage.getItem(STORAGE_FROST);
  } catch (e) {
    /* 忽略 */
  }
  applyFrost(normalizeFrost(v), false);
}

/* ---------------------------------------------------------------- 透明度 */

// t = 0 完全不透明，1 最透；桌面露出来多少由 t 决定
// 页面 / 卡片 / 顶栏统一用 alpha = 1 - t，这样“站内小框”和整页是同一档透明度
let currentTransparency = 0.3;

let lastSentBg = '';
let lastSentTheme = '';

function syncWindowBg() {
  try {
    const rgb = mode === 'light' ? '239, 239, 239' : '19, 21, 26';
    let alpha = 1 - currentTransparency;
    // 亚克力材质本身偏亮，深色下如果不留一档底色，把透明度拉满会整页发白
    if (mode === 'dark' && frostMode === 'frost') alpha = Math.max(alpha, 0.34);
    const value = 'rgba(' + rgb + ', ' + Number(alpha).toFixed(3) + ')';
    if (value === lastSentBg) return; // 同样的值不用再发，省一次窗口重绘
    lastSentBg = value;
    ipcRenderer.send('win:bg', value);
  } catch (e) {
    /* 忽略 */
  }
}

function syncSlider() {
  const input = document.getElementById('lgd-alpha');
  if (!input) return;
  const pct = Math.round(currentTransparency * 100);
  if (input.value !== String(pct)) input.value = String(pct);
  input.title = '背景透明度 ' + pct + '%';
}

/* 让被“批量透明化”接管过的元素跟着滑块一起变 */
function refreshSwept(alpha) {
  for (const el of document.querySelectorAll('[data-lgd-swept="1"]')) {
    const rgb = el.dataset.lgdRgb;
    if (rgb) el.style.setProperty('background-color', 'rgba(' + rgb + ', ' + alpha + ')', 'important');
  }
}

function applyTransparency(t) {
  const v = Math.max(0, Math.min(1, Number(t)));
  currentTransparency = v;
  const alpha = 1 - v;
  const root = document.documentElement;
  root.style.setProperty('--lgd-a', String(alpha));
  root.style.setProperty('--lgd-ab', String(alpha));
  root.style.setProperty('--lgd-ac', String(alpha));
  // 窗口本体底色跟着变：页面和边角都用同一档透明度
  syncWindowBg();
  syncSlider();
  refreshSwept(alpha);
  scheduleSweep(260);
  return v;
}

function initAlpha() {
  let t = 0.3;
  try {
    const raw = localStorage.getItem(STORAGE_ALPHA);
    if (raw !== null) {
      const n = Number(raw);
      if (!Number.isNaN(n)) t = Math.max(0, Math.min(1, n));
    }
  } catch (e) {
    /* 忽略 */
  }
  return applyTransparency(t);
}

function setAlphaFromSlider(pct) {
  const t = Math.max(0, Math.min(100, Number(pct))) / 100;
  applyTransparency(t);
  try {
    localStorage.setItem(STORAGE_ALPHA, String(t));
  } catch (e) {
    /* 忽略 */
  }
}

/* ------------------------------------------------- 批量兜底：把剩下的实心块也透明化
   洛谷各页面组件太多（IDE、题库筛选、各种面板），逐个写规则写不完，
   这里做一遍兜底扫描：面积够大、实心、没有背景图、不是图片/代码的块，
   统一换成同色 + 当前透明度。分块执行，避免卡顿。 */

const SWEEP_SKIP_TAGS = {
  IMG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, SVG: 1, PATH: 1, PRE: 1, CODE: 1,
  TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, BR: 1, HR: 1,
};

let sweepTimer = 0;
let sweeping = false;

function scheduleSweep(delay) {
  if (currentTransparency < 0.03) return;
  if (sweepTimer) return; // 已经在排队了，别反复重置导致永远轮不到
  sweepTimer = setTimeout(() => {
    sweepTimer = 0;
    runSweep();
  }, delay || 400);
}

function parseColor(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

function runSweep() {
  if (!document.body || sweeping || currentTransparency < 0.03) return;
  sweeping = true;
  const alpha = 1 - currentTransparency;
  const all = document.body.querySelectorAll('*');
  let i = 0;

  const chunk = () => {
    const end = Math.min(i + 400, all.length);
    for (; i < end; i++) {
      const el = all[i];
      if (el.dataset.lgdSwept === '1' || el.dataset.lgdCleared === '1') continue;
      if (SWEEP_SKIP_TAGS[el.tagName]) continue;
      if (el.closest('#lgd-wincontrols,#lgd-toggle,#lgd-scrollbar,#lgd-rz-wrap')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height < 4000) continue;

      const cs = getComputedStyle(el);
      if (cs.backgroundImage !== 'none') continue;
      const c = parseColor(cs.backgroundColor);
      if (!c || c.a < 0.98) continue;

      // 外面已经有一块被透明化了：里面这层就别再叠不透明的底，清成透明，
      // 否则两层 alpha 叠起来还是实心（IDE 编辑器就是这样）
      if (el.parentElement && el.parentElement.closest('[data-lgd-swept="1"]')) {
        el.dataset.lgdCleared = '1';
        el.style.setProperty('background-color', 'transparent', 'important');
        continue;
      }

      const rgb = c.r + ',' + c.g + ',' + c.b;
      el.dataset.lgdSwept = '1';
      el.dataset.lgdRgb = rgb;
      el.style.setProperty('background-color', 'rgba(' + rgb + ', ' + alpha + ')', 'important');
    }
    if (i < all.length) {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(chunk, { timeout: 400 });
      else setTimeout(chunk, 16);
    } else {
      sweeping = false;
    }
  };

  chunk();
}

/* ------------------------------------------------------------------ 图标 */

const SVG = (body, size) =>
  '<svg viewBox="0 0 16 16" width="' + (size || 14) + '" height="' + (size || 14) + '" aria-hidden="true" ' +
  'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';

const ICON = {
  moon: SVG('<path d="M14 9.4A6 6 0 1 1 6.6 2a4.8 4.8 0 0 0 7.4 7.4z"/>', 15),
  sun: SVG('<circle cx="8" cy="8" r="2.9"/><path d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2"/>', 15),
  minimize: SVG('<path d="M3.2 8h9.6"/>'),
  maximize: SVG('<rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1.2"/>'),
  restore: SVG('<rect x="3" y="5.2" width="7.8" height="7.8" rx="1.1"/><path d="M5.4 3h6.1a1.5 1.5 0 0 1 1.5 1.5v6.1"/>'),
  close: SVG('<path d="M4 4l8 8M12 4l-8 8"/>'),
  fullscreen: SVG('<path d="M3 6.2V3h3.2M12.8 9.8V13H9.6M9.6 3H13v3.2M6.2 13H3V9.8"/>'),
  back: SVG('<path d="M10 3.5L5.5 8l4.5 4.5"/>'),
  forward: SVG('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  reload: SVG('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8V5.6h-2.8"/>'),
};

/* ------------------------------------------------------- 顶栏：主题按钮 */

function syncThemeButton() {
  const btn = document.getElementById(BTN_ID);
  if (!btn) return;
  const dark = mode === 'dark';
  btn.setAttribute('data-dark', dark ? '1' : '0');
  btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  btn.setAttribute('title', (dark ? '切换到亮色' : '切换到夜间') + ' (Alt+Shift+D)');
}

function findBar() {
  const sels = ['.top-bar .user-nav', '.top-bar .right', '.top-bar', '.l-nav .user-nav', '.nav-r'];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function mountThemeButton() {
  const existing = document.getElementById(BTN_ID);
  const host = findBar();
  if (existing) {
    if (host && existing.parentElement !== host) {
      existing.className = 'lgd-toggle lgd-toggle--bar';
      host.insertBefore(existing, host.firstChild);
    }
    syncThemeButton();
    return;
  }
  if (!document.body || !host) return;
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.className = 'lgd-toggle lgd-toggle--bar';
  btn.setAttribute('aria-label', '切换夜间模式');
  // 两个图标都放进去，靠 data-dark 切换显示；点击走 document 上的事件代理，
  // 这样即使按钮被页面框架重渲染，也不会“吞掉”点击
  btn.innerHTML =
    '<span class="lgd-icon lgd-icon--moon">' + ICON.moon + '</span>' +
    '<span class="lgd-icon lgd-icon--sun">' + ICON.sun + '</span>' +
    '<span class="lgd-toggle-text"><i class="lgd-text-moon">夜间</i><i class="lgd-text-sun">日间</i></span>';
  host.insertBefore(btn, host.firstChild);
  syncThemeButton();
}

/* --------------------------------------------------- 顶栏：窗口控制按钮 */

let winState = { maximized: false, fullScreen: false };

function syncWinControls() {
  document.documentElement.classList.toggle('lgd-fullscreen', !!winState.fullScreen);
  document.documentElement.classList.toggle('lgd-maximized', !!winState.maximized);
  const max = document.getElementById('lgd-max');
  if (max) {
    max.innerHTML = winState.maximized ? ICON.restore : ICON.maximize;
    max.title = winState.maximized ? '向下还原' : '最大化';
  }
}

function syncFrostMenu() {
  const btn = document.getElementById('lgd-frost-btn');
  if (btn) {
    const label = frostMode === 'frost' ? '磨砂' : '纯透明';
    btn.title = '当前：' + label + ' · 点击切换';
  }
  const menu = document.getElementById('lgd-frost-menu');
  if (!menu) return;
  for (const b of menu.querySelectorAll('[data-frost]')) {
    const on = b.dataset.frost === frostMode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

function closeFrostMenu() {
  const menu = document.getElementById('lgd-frost-menu');
  if (!menu) return;
  menu.hidden = true;
}

function openFrostMenu(anchor) {
  let menu = document.getElementById('lgd-frost-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'lgd-frost-menu';
    menu.className = 'lgd-menu';
    menu.innerHTML =
      '<button type="button" data-frost="clear"><b>纯透明</b><span>桌面清晰可见</span></button>' +
      '<button type="button" data-frost="frost"><b>磨砂</b><span>桌面做模糊处理</span></button>';
    for (const b of menu.querySelectorAll('[data-frost]')) {
      b.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        applyFrost(b.dataset.frost, true);
        closeFrostMenu();
      });
    }
    document.body.appendChild(menu);
  }
  syncFrostMenu();
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 180;
  let left = Math.min(r.left, window.innerWidth - mw - 10);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = r.bottom + 8 + 'px';

  setTimeout(() => {
    const onDoc = ev => {
      if (!menu.contains(ev.target)) {
        closeFrostMenu();
        document.removeEventListener('mousedown', onDoc, true);
      }
    };
    document.addEventListener('mousedown', onDoc, true);
  }, 0);
}

function buildCluster() {
  const box = document.createElement('div');
  box.id = CTRL_ID;
  box.className = 'lgd-wincontrols';

  const sliderWrap = document.createElement('label');
  sliderWrap.className = 'lgd-alpha';
  sliderWrap.title = '背景透明度';
  sliderWrap.innerHTML =
    '<span class="lgd-alpha-icon" id="lgd-frost-btn" role="button" tabindex="0" title="点击切换：纯透明 / 磨砂">' +
    SVG('<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none"/>', 13) +
    '</span>';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'lgd-alpha';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(Math.round(currentTransparency * 100));
  slider.addEventListener('input', () => setAlphaFromSlider(slider.value));
  sliderWrap.appendChild(slider);
  box.appendChild(sliderWrap);

  const frostBtn = sliderWrap.querySelector('#lgd-frost-btn');
  if (frostBtn) frostBtn.addEventListener('mousedown', e => e.stopPropagation());

  const mk = (id, action, icon, title) => {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = 'lgd-wincontrol' + (id === 'lgd-close' ? ' lgd-wincontrol--close' : '');
    b.dataset.lgdAction = action;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    box.appendChild(b);
    return b;
  };

  mk('lgd-fs', 'fullscreen', ICON.fullscreen, '全屏 (F11)');
  mk('lgd-min', 'minimize', ICON.minimize, '最小化 (Ctrl+M)');
  mk('lgd-max', 'maximize', ICON.maximize, '最大化');
  mk('lgd-close', 'close', ICON.close, '关闭 (Ctrl+W)');

  return box;
}

function mountWinControls() {
  const bar = document.querySelector('.top-bar .right') || document.querySelector('.top-bar');
  const existing = document.getElementById(CTRL_ID);

  if (existing) {
    // 顶栏出现/消失时，在“顶栏内”和“右上角悬浮”之间来回搬
    if (bar && existing.parentElement !== bar) {
      existing.classList.remove('lgd-wincontrols--float');
      bar.appendChild(existing);
    } else if (!bar && !existing.classList.contains('lgd-wincontrols--float') && document.body) {
      existing.classList.add('lgd-wincontrols--float');
      document.body.appendChild(existing);
    }
    syncWinControls();
    return;
  }
  if (!document.body) return;
  const box = buildCluster();
  if (bar) {
    bar.appendChild(box);
  } else {
    // 登录页这种没有顶栏的页面：贴右上角，顺带自己当拖动区
    box.classList.add('lgd-wincontrols--float');
    document.body.appendChild(box);
  }
  syncWinControls();
}

/* 没有顶栏的页面（登录页）也要能拖窗口：顶部留一条看不见的拖动条 */
function mountDragStrip() {
  const hasBar = !!document.querySelector('.top-bar');
  const strip = document.getElementById('lgd-dragstrip');
  if (hasBar) {
    if (strip) strip.remove();
    return;
  }
  if (!strip && document.body) {
    const d = document.createElement('div');
    d.id = 'lgd-dragstrip';
    document.body.appendChild(d);
  }
}

/* ------------------------------------------------- 左上角：后退 / 刷新 / 前进 */

function buildNavbar() {
  const box = document.createElement('div');
  box.id = 'lgd-navbar';
  box.className = 'lgd-navbar';
  const mk = (action, icon, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lgd-navbtn';
    b.dataset.lgdNav = action;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    return b;
  };
  box.appendChild(mk('back', ICON.back, '后退 (Alt+←)'));
  box.appendChild(mk('reload', ICON.reload, '刷新 (F5)'));
  box.appendChild(mk('forward', ICON.forward, '前进 (Alt+→)'));
  return box;
}

function mountNavbar() {
  if (document.getElementById('lgd-navbar')) return;
  const left = document.querySelector('.top-bar .left');
  if (!left || !left.parentElement) return;
  left.insertBefore(buildNavbar(), left.firstChild);
}

function applyNavState(state) {
  const back = document.querySelector('[data-lgd-nav="back"]');
  const fwd = document.querySelector('[data-lgd-nav="forward"]');
  if (back) back.disabled = !state.canBack;
  if (fwd) fwd.disabled = !state.canForward;
}

/* ----------------------------------------------------- 无边框窗口：边缘拖拽 */

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function startResize(dir, event) {
  const handle = event.currentTarget;
  if (!handle) return;
  ipcRenderer.invoke('win:bounds').then(bounds => {
    if (!bounds) return;
    const startX = event.screenX;
    const startY = event.screenY;
    const start = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    let queued = null;
    let raf = 0;

    try {
      handle.setPointerCapture(event.pointerId);
    } catch (e) {
      /* 忽略 */
    }

    const flush = () => {
      raf = 0;
      if (queued) {
        ipcRenderer.send('win:set-bounds', queued);
        queued = null;
      }
    };

    const onMove = ev => {
      const dx = ev.screenX - startX;
      const dy = ev.screenY - startY;
      let x = start.x;
      let y = start.y;
      let width = start.width;
      let height = start.height;

      if (dir.indexOf('e') >= 0) width = start.width + dx;
      if (dir.indexOf('s') >= 0) height = start.height + dy;
      if (dir.indexOf('w') >= 0) {
        width = start.width - dx;
        x = start.x + dx;
      }
      if (dir.indexOf('n') >= 0) {
        height = start.height - dy;
        y = start.y + dy;
      }
      if (width < 960) {
        if (dir.indexOf('w') >= 0) x = start.x + start.width - 960;
        width = 960;
      }
      if (height < 620) {
        if (dir.indexOf('n') >= 0) y = start.y + start.height - 620;
        height = 620;
      }

      queued = { x, y, width, height };
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (raf) cancelAnimationFrame(raf);
      flush();
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (e) {
        /* 忽略 */
      }
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

function mountResizeHandles() {
  if (document.getElementById('lgd-rz-wrap')) return;
  if (!document.body) return;
  const wrap = document.createElement('div');
  wrap.id = 'lgd-rz-wrap';
  for (const dir of RESIZE_DIRS) {
    const h = document.createElement('div');
    h.className = 'lgd-rz lgd-rz--' + dir;
    h.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      startResize(dir, e);
    });
    wrap.appendChild(h);
  }
  document.body.appendChild(wrap);
}

/* ------------------------------------------- 自定义滚动条（原生那条是浏览器画的，透明窗口里对不上色） */

function updateScrollIndicator() {
  if (!document.body) return;
  const doc = document.documentElement;
  const total = Math.max(doc.scrollHeight, document.body.scrollHeight);
  const vh = window.innerHeight;
  let bar = document.getElementById('lgd-scrollbar');

  if (total <= vh + 2) {
    if (bar) bar.style.display = 'none';
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'lgd-scrollbar';
    document.body.appendChild(bar);
  }
  bar.style.display = 'block';
  const thumbH = Math.max(36, Math.round((vh * vh) / total));
  const maxScroll = total - vh;
  const y = Math.min(Math.max(window.scrollY || doc.scrollTop || 0, 0), maxScroll);
  const top = Math.round((y / maxScroll) * (vh - thumbH));
  bar.style.height = thumbH + 'px';
  bar.style.transform = 'translateY(' + top + 'px)';
}

/* ------------------------------------------------------------------ 去推广 */

function hideEl(el) {
  el.style.setProperty('display', 'none', 'important');
}

let lastPromoPath = '';
let lastPromoAt = 0;

function cleanPromos() {
  if (appConfig.hidePromos === false) return;
  const now = Date.now();
  // 同一页面上最多每 2.5 秒清一次：推广位常常是延迟加载的，只清一次会漏
  if (lastPromoPath === location.pathname && now - lastPromoAt < 2500) return;
  lastPromoPath = location.pathname;
  lastPromoAt = now;
  for (const side of document.querySelectorAll('.sidebar-container .side')) {
    for (const el of Array.from(side.children)) {
      if (el.dataset.lgdHidden === '1') continue;
      if (el.querySelector('h3, .lfe-h3')) continue;
      // 用容器自身的尺寸判断：图片可能还没加载完，img 的宽度是 0
      const img = el.querySelector('img');
      const rect = el.getBoundingClientRect();
      if (img && rect.width >= 220 && rect.height >= 100) {
        hideEl(el);
        el.dataset.lgdHidden = '1';
      }
    }
  }
  for (const side of document.querySelectorAll('.sidebar-container')) {
    for (const el of side.querySelectorAll('*')) {
      if (el.childElementCount > 1) continue;
      const t = (el.textContent || '').replace(/\s+/g, '');
      if (t === '洛谷推荐') {
        let box = el;
        for (let i = 0; i < 4 && box.parentElement && box !== side; i++) box = box.parentElement;
        if (box !== side) hideEl(box);
      }
    }
  }
}

/* ------------------------------------------------------------------ 根容器 */

function markRoots() {
  const roots = [];
  const app = document.getElementById('app');
  const push = (parent, skip) => {
    if (!parent) return;
    for (const el of parent.children) {
      if (el === skip) continue;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
      if (el.id === BTN_ID || el.id === CTRL_ID || el.id === 'lgd-scrollbar') continue;
      roots.push(el);
    }
  };
  if (app) {
    push(app, null);
    push(document.body, app);
  } else {
    push(document.body, null);
  }
  for (const el of document.querySelectorAll('.lgd-root')) {
    if (roots.indexOf(el) === -1) el.classList.remove('lgd-root');
  }
  for (const el of roots) {
    if (!el.classList.contains('lgd-root')) el.classList.add('lgd-root');
  }
}

/* ------------------------------------------------------------------ 启动 */

/* boot 只做“改 DOM、不量布局”的轻活；量布局的活（滚动条、去推广、兜底扫描）
   统一交给 settle，等页面安静下来再做，避免导航过程中反复强制重排 */
function boot() {
  try {
    markRoots();
    mountThemeButton();
    mountWinControls();
    mountNavbar();
    mountDragStrip();
    mountResizeHandles();
    syncSlider();
    scheduleSettle();
  } catch (err) {
    /* 忽略 */
  }
}

let settleTimer = 0;
function scheduleSettle() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = 0;
    try {
      updateScrollIndicator();
      cleanPromos();
      scheduleSweep(300);
    } catch (e) {
      /* 忽略 */
    }
  }, 450);
}

/* 页面变化时合并处理：连续变动期间不断延后，最多等 800ms 就强制跑一次，
   这样导航时那一大串 DOM 变动只会触发一次 boot，而不是每 150ms 一次 */
let pendTimer = 0;
let pendFirst = 0;
function schedule() {
  const now = Date.now();
  if (!pendFirst) pendFirst = now;
  if (pendTimer) clearTimeout(pendTimer);
  const wait = now - pendFirst > 800 ? 0 : 220;
  pendTimer = setTimeout(() => {
    pendTimer = 0;
    pendFirst = 0;
    boot();
  }, wait);
}

function start() {
  const style = document.createElement('style');
  style.id = 'lgd-style';
  style.textContent = CSS;
  document.documentElement.appendChild(style);

  document.documentElement.classList.add('lgd-frameless');

  applyTheme(readTheme() || 'dark', false);
  initFrost();
  initAlpha();

  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') {
        schedule();
        return;
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  ipcRenderer.on('win:nav-state', (_e, state) => {
    if (state) applyNavState(state);
  });

  ipcRenderer.on('win:state', (_e, state) => {
    winState = state || winState;
    syncWinControls();
  });
  ipcRenderer
    .invoke('win:query')
    .then(state => {
      if (state) {
        winState = state;
        syncWinControls();
      }
    })
    .catch(() => {});

  boot();
  document.addEventListener('DOMContentLoaded', boot, { once: true });
  [0, 350, 1200].forEach(t => setTimeout(boot, t));

  setInterval(() => {
    if (mode === 'dark') markRoots();
    cleanPromos(); // 自己内部有 2.5s 节流，推广位晚加载也能补上
    updateScrollIndicator();
  }, 3000);

  window.addEventListener('resize', () => updateScrollIndicator(), { passive: true });

  /* 洛谷的链接是普通 <a>，点一下是整页重新加载（20+ 个请求）。
     这里让 Chromium 在鼠标悬停时预渲染目标页；不支持预渲染就退回 prefetch。 */
  function installSpeculation() {
    try {
      if (typeof HTMLScriptElement.supports !== 'function' || !HTMLScriptElement.supports('speculationrules')) return false;
      const s = document.createElement('script');
      s.type = 'speculationrules';
      s.textContent = JSON.stringify({
        prerender: [
          {
            source: 'document',
            where: {
              and: [
                { href_matches: 'https://www.luogu.com.cn/*' },
                { not: { href_matches: 'https://www.luogu.com.cn/auth/*' } },
                { not: { href_matches: 'https://www.luogu.com.cn/api/*' } },
                { not: { href_matches: 'https://www.luogu.com.cn/upload/*' } },
              ],
            },
            eagerness: 'moderate',
          },
        ],
      });
      (document.head || document.documentElement).appendChild(s);
      return true;
    } catch (e) {
      return false;
    }
  }

  installSpeculation();

  const prefetched = new Set();
  let hoverTimer = 0;

  function prefetchUrl(url) {
    if (!url || prefetched.has(url) || prefetched.size > 40) return;
    if (url.indexOf('https://www.luogu.com.cn/') !== 0) return;
    if (url.split('#')[0] === location.href.split('#')[0]) return;
    prefetched.add(url);
    const l = document.createElement('link');
    l.rel = 'prefetch';
    l.as = 'document';
    l.href = url;
    (document.head || document.documentElement).appendChild(l);
  }

  function fromEvent(target) {
    const a = target && target.closest ? target.closest('a[href]') : null;
    if (a) prefetchUrl(a.href);
  }

  document.addEventListener('mouseover', e => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => fromEvent(e.target), 80);
  }, { passive: true });
  document.addEventListener('mousedown', e => {
    clearTimeout(hoverTimer);
    fromEvent(e.target);
  }, true);
  window.addEventListener('scroll', () => updateScrollIndicator(), { passive: true });
}

/* 统一的点击代理：按钮被页面框架重渲染、换了节点，点击也不会丢 */
document.addEventListener(
  'click',
  e => {
    const t = e.target;
    if (!t || !t.closest) return;

    if (t.closest('#lgd-toggle')) {
      e.preventDefault();
      e.stopPropagation();
      toggleTheme();
      return;
    }

    if (t.closest('#lgd-frost-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const menu = document.getElementById('lgd-frost-menu');
      if (menu && !menu.hidden) closeFrostMenu();
      else openFrostMenu(t.closest('#lgd-frost-btn'));
      return;
    }

    const navBtn = t.closest('[data-lgd-nav]');
    if (navBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (!navBtn.disabled) ipcRenderer.send('win:nav', navBtn.dataset.lgdNav);
      return;
    }

    const act = t.closest('[data-lgd-action]');
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    const a = act.dataset.lgdAction;
    if (a === 'fullscreen') ipcRenderer.send('win:fullscreen', true);
    else if (a === 'minimize') ipcRenderer.send('win:minimize');
    else if (a === 'maximize') ipcRenderer.send('win:maximize');
    else if (a === 'close') ipcRenderer.send('win:close');
  },
  true
);

document.addEventListener(
  'keydown',
  e => {
    if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      toggleTheme();
    }
  },
  true
);

if (isLuogu) {
  if (document.documentElement) {
    start();
  } else {
    const obs = new MutationObserver(() => {
      if (document.documentElement) {
        obs.disconnect();
        start();
      }
    });
    obs.observe(document, { childList: true, subtree: true });
  }
}
