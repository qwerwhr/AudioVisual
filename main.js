// main.js

const { app, screen, BrowserWindow, BrowserView, ipcMain, session, shell, dialog, net } = require('electron');

const path = require('path');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');

// --- 镜像节点配置 ---
const MIRROR_NODES = {
  github:  { type: 'github',  owner: 'qwerwhr', repo: 'AudioVisual' },
  gitcode: { type: 'generic', url: 'https://gitcode.com/qwerwhr/AudioVisual-releases/raw/main/' },
  custom: { type: 'custom',  url: null }
};
let currentMirrorType = 'github';
let currentMirrorURL = null;  // 仅 custom 类型时使用
let manualUpdateInfo = null;  // 手动更新时的版本信息

// --- Debounce Utility ---
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// --- Environment & Security Configuration ---

// 1. Environment Detection
const isDev = false; // Forced to false to disable auto DevTools

// 2. Hardware Acceleration (Re-enabled for performance)
// app.disableHardwareAcceleration(); // Commented out to fix resize flickering issue.

// 3. Command Line Switches
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion'); // Fixes some white flashes on Windows
app.commandLine.appendSwitch('ignore-certificate-errors'); // 全局忽略证书错误，影视站点多数使用自签名证书

// 4. Certificate Error Handler (全局忽略所有证书错误)
// 作为本地视频播放器，SSL 证书严格验证不必要，且多数影视站点使用自签名或过期证书
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  const hostname = new URL(url).hostname;
  console.log(`[Cert] Ignoring certificate error for ${hostname}: ${error}`);
  event.preventDefault();
  callback(true);
});

// --- Application Setup ---
app.setPath('userData', path.join(__dirname, 'userData'));

// --- Widevine CDM Injection ---
function getWidevinePath() {
  const platform = os.platform();
  const arch = os.arch();
  let widevinePath = '';
  const paths = {
    'win32': `${os.homedir()}/AppData/Local/Google/Chrome/User Data/WidevineCdm`,
    'darwin': `${os.homedir()}/Library/Application Support/Google/Chrome/WidevineCdm`,
    'linux': `${os.homedir()}/.config/google-chrome/WidevineCdm`
  };
  if (paths[platform]) {
    if (!fs.existsSync(paths[platform])) return null;
    const versions = fs.readdirSync(paths[platform]).filter(f => fs.statSync(`${paths[platform]}/${f}`).isDirectory());
    if (versions.length > 0) {
      const latestVersion = versions.sort().pop();
      let cdmPath = '';
      if (platform === 'win32') cdmPath = `${paths[platform]}/${latestVersion}/_platform_specific/win_${arch === 'x64' ? 'x64' : 'x86'}/widevinecdm.dll`;
      else if (platform === 'darwin') cdmPath = `${paths[platform]}/${latestVersion}/_platform_specific/mac_${arch}/libwidevinecdm.dylib`;
      else if (platform === 'linux') cdmPath = `${paths[platform]}/${latestVersion}/_platform_specific/linux_${arch}/libwidevinecdm.so`;
      if (fs.existsSync(cdmPath)) return { path: cdmPath, version: latestVersion };
    }
  }
  return null;
}
const widevineInfo = getWidevinePath();
if (widevineInfo) {
  app.commandLine.appendSwitch('widevine-cdm-path', widevineInfo.path);
  app.commandLine.appendSwitch('widevine-cdm-version', widevineInfo.version);
} else {
  console.error('Widevine CDM not found.');
}

let mainWindow;
let view;
let isSidebarCollapsed = false;
let currentThemeCss = `:root { --av-primary-bg: #1e1e2f; --av-accent-color: #3a3d5b; --av-highlight-color: #ff6768; }`;
const scrollbarCss = fs.readFileSync(path.join(__dirname, 'assets', 'css', 'view-style.css'), 'utf8');

// --- 用户配置持久化（JSON文件） ---
const USER_CONFIG_PATH = path.join(app.getPath('userData'), '..', 'userData', 'user-config.json');

// 默认配置
const DEFAULT_USER_CONFIG = {
  dramaSites: [
    { value: 'https://monkey-flix.com/', label: '猴影工坊' },
    { value: 'https://www.letu.me/', label: '茉小影' },
    { value: 'https://103.194.185.51:51122/', label: '网飞猫' },
    { value: 'https://www.keke6.app/', label: '可可影视' }
  ],
  apiList: []
};

// 加载用户配置文件
function loadUserConfig() {
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const raw = fs.readFileSync(USER_CONFIG_PATH, 'utf8');
      const config = JSON.parse(raw);
      console.log('[Config] Loaded user config from', USER_CONFIG_PATH);
      return { ...DEFAULT_USER_CONFIG, ...config };
    }
  } catch (e) {
    console.error('[Config] Failed to load user config:', e);
  }
  // 返回默认配置并保存
  saveUserConfig(DEFAULT_USER_CONFIG);
  return DEFAULT_USER_CONFIG;
}

// 保存用户配置文件
function saveUserConfig(config) {
  try {
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log('[Config] Saved user config to', USER_CONFIG_PATH);
    return true;
  } catch (e) {
    console.error('[Config] Failed to save user config:', e);
    return false;
  }
}

// --- Pre-rendering Logic ---
const viewPool = new Map(); // Stores fully rendered BrowserViews persistently
const siteUrlMappings = {}; // 存储失效域名到新域名的映射
const userConfig = loadUserConfig();
const dramaSites = (userConfig.dramaSites || []).map(site => site.value || site);

async function preloadSites() {
  console.log('Starting pre-rendering of drama sites...');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  for (const url of dramaSites) {
    // 先检测站点是否可用，不可用则尝试自动替换
    let effectiveUrl = url;
    try {
      const isAvailable = await checkSiteAvailability(url);
      if (!isAvailable) {
        console.warn(`[Preload] Site unavailable: ${url}, searching for alternative...`);
        const newUrl = await searchAndUpdateSiteUrl(url);
        if (newUrl) {
          console.log(`[Preload] Using alternative: ${newUrl}`);
          effectiveUrl = newUrl;
          // 更新 dramaSites 数组中的对应项
          const idx = dramaSites.indexOf(url);
          if (idx !== -1) dramaSites[idx] = newUrl;
          // 保存到映射表，供渲染进程使用
          siteUrlMappings[url] = newUrl;
        } else {
          console.warn(`[Preload] No alternative found for ${url}, skipping pre-render.`);
          continue;
        }
      }
    } catch (e) {
      console.warn(`[Preload] Availability check failed for ${url}, attempting load anyway...`);
    }

    try {
      console.log(`Pre-rendering ${effectiveUrl}`);
      const ghostView = new BrowserView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: path.join(__dirname, 'assets', 'js', 'preload-web.js'),
          plugins: true
        }
      });
      ghostView.setBackgroundColor('#1e1e2f');
      attachViewEvents(ghostView);

      const loadPromise = new Promise((resolve, reject) => {
        const handleFinish = () => {
          cleanup();
          resolve();
        };
        const handleFail = (event, errorCode, errorDescription) => {
          cleanup();
          if (errorCode !== -3) { // -3 is ABORTED
            reject(new Error(`ERR_FAILED (${errorCode}) loading '${effectiveUrl}': ${errorDescription}`));
          } else {
            resolve();
          }
        };
        const cleanup = () => {
          ghostView.webContents.removeListener('did-finish-load', handleFinish);
          ghostView.webContents.removeListener('did-fail-load', handleFail);
        };

        ghostView.webContents.on('did-finish-load', handleFinish);
        ghostView.webContents.on('did-fail-load', handleFail);
        ghostView.webContents.loadURL(effectiveUrl);
      });

      await loadPromise;
      viewPool.set(effectiveUrl, ghostView);
      if (effectiveUrl !== url) viewPool.set(url, ghostView); // 同时用原 URL 索引，方便查找
      console.log(`Finished pre-rendering ${effectiveUrl}`);
    } catch (error) {
      console.error(`Failed to pre-render ${effectiveUrl}:`, error);
    }
    await delay(500);
  }
  console.log('Pre-rendering complete.');
}

function injectThemeCss(targetView) {
  if (targetView && targetView.webContents && !targetView.webContents.isDestroyed()) {
    const nuisanceCss = `
      /* 强制隐藏已知顽固弹窗 */
      [class*="popwin_fullCover"], 
      [class*="shapedPopup_container"], 
      [class*="notSupportedDrm_drmTipsPopBox"],
      [class*="floatPage_floatPage"], 
      #tvgCashierPage,
      .browser-ver-tip, 
      .qy-dialog-container,
      .iqp-player-guide,
      .mgtv-player-layers, .mgtv-player-ad, .mgtv-player-overlay, #m-player-ad {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        z-index: -9999 !important;
      }
    `;
    const combinedCss = currentThemeCss + '\n' + scrollbarCss + '\n' + nuisanceCss;
    targetView.webContents.insertCSS(combinedCss).catch(console.error);
  }
}

function attachViewEvents(targetView) {
  if (!targetView || !targetView.webContents || targetView.webContents.isDestroyed()) {
    return;
  }

  targetView.webContents.on('dom-ready', () => {
    if (targetView && targetView.webContents && !targetView.webContents.isDestroyed()) {
      injectThemeCss(targetView);
      if (view === targetView) {
        updateViewBounds(true);
        updateZoomFactor(targetView); // Set initial zoom
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('load-finished');
        }
      }
    }
  });

  targetView.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
    if (isMainFrame && mainWindow && !mainWindow.isDestroyed() && view === targetView) {
      mainWindow.webContents.send('url-updated', url);
      // 核心：页面加载的第一时间主动请求解析，解决"第一次注入慢"
      targetView.webContents.executeJavaScript(`
        (() => {
          const url = window.location.href;
          const isVideoPage = url.includes('iqiyi.com/v_') || url.includes('mgtv.com/b/') || url.includes('v.qq.com/x/cover/');
          if (isVideoPage) {
            ipcRenderer.send('proactive-parse-request', url);
          }
        })();
      `);

      // 优酷反爬虫绕过：在导航阶段注入额外反检测脚本
      if (url.includes('youku.com')) {
        targetView.webContents.executeJavaScript(`
          (() => {
            // 覆写 Chrome 自动化标志
            if (!window.chrome) window.chrome = {};
            window.chrome.runtime = {};
            window.chrome.csi = function() {};
            window.chrome.loadTimes = function() {};
            // 覆写 Permissions API
            if (navigator.permissions && navigator.permissions.query) {
              const originalQuery = navigator.permissions.query.bind(navigator.permissions);
              navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                  Promise.resolve({ state: Notification.permission }) :
                  originalQuery(parameters)
              );
            }
            console.log('[Youku-AntiBot] Extra anti-detection injected in navigation phase.');
          })();
        `).catch(console.error);
      }
    }
  });

  targetView.webContents.on('did-navigate', (event, url) => {
    if (view !== targetView) return;
    console.log('Page navigated to:', url);
    // 所有视频页面自动触发解析
    const isVideoPage = url.includes('iqiyi.com/v_') || url.includes('mgtv.com/b/') || url.includes('v.qq.com/x/cover/') || url.includes('youku.com/v_show/') || url.includes('bilibili.com/video/') || url.includes('bilibili.com/bangumi/play/');
    if (isVideoPage && mainWindow) {
      console.log('[Main] Auto-triggering fast-parse for navigation to video page:', url);
      mainWindow.webContents.send('fast-parse-url', url);
    }
    // 附加保障：did-navigate 时也补一次脉冲
    if (isVideoPage && mainWindow) {
      mainWindow.webContents.send('fast-parse-url', url);
    }
    if (url.includes('iqiyi.com/v_') && url.includes('.html')) {
      console.log('iQiyi redirected to correct video page:', url);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('url-updated', url);
      }
    }
  });

  targetView.webContents.on('did-navigate-in-page', (event, url) => {
    if (view !== targetView) return;
    console.log('Page navigated in-page to:', url);
  });

  targetView.webContents.setWindowOpenHandler(({ url }) => {
    if (view !== targetView) return { action: 'deny' };
    if (targetView && targetView.webContents && !targetView.webContents.isDestroyed()) {
      console.log(`[WindowOpenHandler] Intercepted new window for URL: ${url}. Loading in current view and forcing re-parse.`);
      targetView.webContents.loadURL(url);
      updateViewBounds(true);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fast-parse-url', url);
      }
    }
    return { action: 'deny' };
  });

  const updateNavigationState = () => {
    if (view !== targetView) return;
    if (mainWindow && !mainWindow.isDestroyed() && targetView && targetView.webContents && !targetView.webContents.isDestroyed()) {
      const navState = {
        canGoBack: targetView.webContents.canGoBack(),
        canGoForward: targetView.webContents.canGoForward()
      };
      mainWindow.webContents.send('nav-state-updated', navState);
    }
  };
  targetView.webContents.on('did-navigate', updateNavigationState);
  targetView.webContents.on('did-navigate-in-page', updateNavigationState);
}

function updateViewBounds(isVisible = true) {
  if (!mainWindow || !view) return;
  const isFullScreen = mainWindow.isFullScreen();
  if (isFullScreen) {
    const bounds = mainWindow.getBounds();
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  } else {
    const contentBounds = mainWindow.getContentBounds();
    // 响应式布局计算逻辑，需与 style.css 保持一致
    // 侧边栏宽度：clamp(200px, 18vw, 280px)
    let sidebarWidth = Math.max(200, Math.min(Math.floor(contentBounds.width * 0.18), 280));
    if (isSidebarCollapsed) {
      sidebarWidth = 0;
    }
    console.log(`[Main] updateViewBounds. isCollapsed: ${isSidebarCollapsed}, sidebarWidth: ${sidebarWidth}`);

    // 顶部工具栏高度：clamp(50px, 7vh, 65px)
    const topBarHeight = Math.max(50, Math.min(Math.floor(contentBounds.height * 0.07), 65));

    if (isVisible) {
      view.setBounds({
        x: sidebarWidth,
        y: topBarHeight,
        width: contentBounds.width - sidebarWidth,
        height: contentBounds.height - topBarHeight
      });
    } else {
      view.setBounds({ x: sidebarWidth, y: topBarHeight, width: 0, height: 0 });
    }
  }
}

function updateZoomFactor(targetView) {
  if (!targetView || !targetView.webContents || targetView.webContents.isDestroyed()) {
    return;
  }
  const viewBounds = targetView.getBounds();
  const viewWidth = viewBounds.width;
  if (viewWidth > 0) {
    const idealWidth = 1400; // Assumed ideal width for video websites
    const zoomFactor = viewWidth / idealWidth;
    targetView.webContents.setZoomFactor(zoomFactor);
    console.log(`[Zoom] View width is ${viewWidth}, setting zoom to ${zoomFactor.toFixed(2)}`);
  }
}

function createNewBrowserView() {
  const newView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'assets', 'js', 'preload-web.js'),
      plugins: true
    }
  });
  attachViewEvents(newView);

  // Anti-debugging trap: Many parser sites have aggressive `debugger;` loops that completely freeze 
  // their JavaScript execution if they detect DevTools are open. 
  // 自动调试已根据用户要求关闭
  if (isDev) {
    newView.webContents.openDevTools({ mode: 'detach' });
  }

  newView.setBackgroundColor('#1e1e2f');
  return newView;
}

// --- Window State Persistence ---
function getWindowState() {
  try {
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read window state:', e);
  }
  return null;
}

function saveWindowState() {
  if (mainWindow) {
    try {
      const stateFile = path.join(app.getPath('userData'), 'window-state.json');
      const state = {
        bounds: mainWindow.getBounds(),
        isMaximized: mainWindow.isMaximized(),
        isSidebarCollapsed: isSidebarCollapsed
      };
      fs.writeFileSync(stateFile, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save window state:', e);
    }
  }
}

function createWindow() {
  const windowState = getWindowState();
  if (windowState && windowState.isSidebarCollapsed !== undefined) {
    isSidebarCollapsed = windowState.isSidebarCollapsed;
  }
  const { workAreaSize } = screen.getPrimaryDisplay();
  const initialWidth = Math.min(1440, Math.round(workAreaSize.width * 0.8));
  const initialHeight = Math.min(1000, Math.round(workAreaSize.height * 0.85));

  let windowOptions = {
    width: windowState?.bounds?.width || initialWidth,
    height: windowState?.bounds?.height || initialHeight,
    x: windowState?.bounds?.x,
    y: windowState?.bounds?.y,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#11111a', // Solid base color matching our CSS
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'assets', 'js', 'preload-ui.js')
    },
    title: "AudioVisual",
    icon: path.join(__dirname, 'assets', 'images', 'icon.png'),
    show: false
  };

  const { nativeTheme } = require('electron');
  // Removed forced dark mode to allow following system theme

  mainWindow = new BrowserWindow(windowOptions);

  if (windowState?.isMaximized) {
    mainWindow.maximize();
  }

  const saveStateDebounced = debounce(saveWindowState, 500);
  mainWindow.on('resize', saveStateDebounced);
  mainWindow.on('move', saveStateDebounced);
  mainWindow.on('close', saveWindowState);

  // 用 ready-to-show 替代 show-window IPC 方案，更可靠
  mainWindow.once('ready-to-show', () => {
    console.log('[Main] === ready-to-show fired, showing window ===');
    console.log(`[Main] view exists at ready-to-show: ${!!view}`);
    mainWindow.show();
    mainWindow.webContents.send('init-sidebar-state', isSidebarCollapsed);

    // Attach view right away since we no longer have a manual fade-in
    if (view) {
      mainWindow.setBrowserView(view);
      updateViewBounds(true);
    }

    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenu(null);

  view = createNewBrowserView();
  // mainWindow.setBrowserView(view); // Deferred to ready-to-show
  // updateViewBounds(false); // Deferred to ready-to-show

  ipcMain.on('minimize-window', () => mainWindow.minimize());
  ipcMain.on('maximize-window', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('close-window', () => mainWindow.close());

  ipcMain.on('sidebar-toggle', (event, collapsed) => {
    isSidebarCollapsed = collapsed;
    updateViewBounds(true);
  });

  ipcMain.on('set-view-visibility', (event, visible) => {
    if (visible) {
      if (view && mainWindow) {
        mainWindow.setBrowserView(view);
        view.webContents.setAudioMuted(false);
        updateViewBounds(true);
      }
    } else {
      if (view && mainWindow) {
        console.log('[Visibility] Hiding view by detaching and muting it.');
        view.webContents.setAudioMuted(true);
        mainWindow.removeBrowserView(view);
      }
    }
  });

  ipcMain.on('navigate', async (event, { url, isPlatformSwitch, themeVars }) => {
    console.log(`[Navigate] === NAVIGATION STARTED ===`);
    console.log(`[Navigate] URL: ${url}`);
    console.log(`[Navigate] mainWindow exists: !!mainWindow`);
    console.log(`[Navigate] view exists before: ${!!view}`);
    console.log(`[Navigate] viewPool size: ${viewPool.size}`);
    
    if (themeVars) {
      currentThemeCss = `:root { ${Object.entries(themeVars).map(([key, value]) => `${key}: ${value}`).join('; ')} }`;
    }
    console.log(`[Navigate] Received request for ${url}.`);

    // 关键修复：切换平台前，先通知旧 view 停止注入和播放
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      console.log('[Navigate] Sending stop-injection to old view before switching.');
      try {
        view.webContents.send('stop-injection');
      } catch (e) {
        console.warn('[Navigate] Failed to send stop-injection to old view:', e.message);
      }
    }

    if (view) {
      mainWindow.removeBrowserView(view);
      // Detach and persist in pool instead of destroying
      console.log('[Navigate] Old BrowserView detached and kept in pool.');
    }

    let isFromCache = false;
    if (viewPool.has(url)) {
      console.log(`[Navigate] Using cached view for ${url}.`);
      view = viewPool.get(url);
      isFromCache = true;
    } else {
      console.log(`[Navigate] Creating a fresh BrowserView for ${url}.`);
      view = createNewBrowserView();
      viewPool.set(url, view);
    }

    mainWindow.setBrowserView(view);
    console.log(`[Navigate] BrowserView attached to mainWindow, view bounds will be updated`);
    updateViewBounds(true); // Must be true, setting it to 0x0 destroys frame buffer and causes layout flash
    console.log(`[Navigate] View bounds updated`);

    /* // User reported slow platform switching, removing cookie clearing for now
    if (isPlatformSwitch) {
      await view.webContents.session.clearStorageData({ storages: ['cookies'] });
    }
    */

    if (!isFromCache) {
      view.webContents.loadURL(url);
      console.log(`[Navigate] === Loading URL: ${url} ===`);
      // 核心提速：立即通知解析引擎开始工作，不等 BrowserView 的各种事件。解决"第一次加载慢"
      const isVideoUrl = url.includes('iqiyi.com/v_') || url.includes('mgtv.com/b/') || url.includes('v.qq.com/x/cover/') || url.includes('youku.com/v_show/') || url.includes('bilibili.com/video/') || url.includes('bilibili.com/bangumi/play/');
      if (isVideoUrl && mainWindow) {
        console.log('[Navigate] Extreme Speed: Early pulse for initial load:', url);
        mainWindow.webContents.send('fast-parse-url', url);
      }
    } else {
      console.log(`[Navigate] Activating cached URL: ${url}`);
      injectThemeCss(view);
      updateZoomFactor(view);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('url-updated', url);
        mainWindow.webContents.send('load-finished');
      }
    }
  });

  ipcMain.on('go-back', () => {
    if (view && view.webContents.canGoBack()) view.webContents.goBack();
  });
  ipcMain.on('go-forward', () => {
    if (view && view.webContents.canGoForward()) view.webContents.goForward();
  });

  ipcMain.on('proactive-parse-request', (event, url) => {
    console.log('[main.js] Received proactive parse request for:', url);
    updateViewBounds(true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fast-parse-url', url);
    }
  });

  ipcMain.on('embed-video', (event, url) => {
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      console.log('[Main] Sending apply-embed-video to view for:', url);
      view.webContents.send('apply-embed-video', url);
    }
  });

  const debouncedUpdateZoom = debounce(updateZoomFactor, 150);

  const handleResize = () => {
    const isVisible = view && view.getBounds().width > 0;
    updateViewBounds(isVisible); // Update bounds immediately
    if (isVisible) {
      debouncedUpdateZoom(view); // Debounce zoom factor updates
    }
  };

  mainWindow.on('resize', handleResize);
  mainWindow.on('enter-full-screen', handleResize);
  mainWindow.on('leave-full-screen', () => setTimeout(handleResize, 50));

  mainWindow.on('minimize', () => {
    if (view) {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  });

  mainWindow.on('restore', () => {
    if (view) {
      updateViewBounds(true);
      setTimeout(() => {
        if (view && view.webContents) {
          view.webContents.focus();
        }
      }, 100);
    }
  });

  mainWindow.on('show', () => {
    if (view) {
      updateViewBounds(true);
      setTimeout(() => {
        if (view && view.webContents) {
          view.webContents.focus();
        }
      }, 100);
    }
  });
}

// --- 网址自动更新机制 ---
// 影视站点的已知域名列表，当主域名失效时自动尝试备选域名
const SITE_DOMAIN_MAP = {
  'keke6.app': ['keke6.app', 'keke6.cc', 'keke6.com', 'keke5.app', 'keke7.app'],
  '103.194.185.51': ['103.194.185.51'],
  'monkey-flix.com': ['monkey-flix.com', 'monkeyflix.com', 'www.monkey-flix.com'],
  'letu.me': ['letu.me', 'letu.cc', 'www.letu.me']
};

// 检测站点是否可用（发起轻量级 HTTP 请求）
async function checkSiteAvailability(url) {
  try {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'HEAD',
      timeout: 8000,
      rejectUnauthorized: false // 忽略 SSL 证书错误
    };
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  } catch (e) {
    return false;
  }
}

// 自动搜索并替换失效网址
async function searchAndUpdateSiteUrl(originalUrl) {
  try {
    const urlObj = new URL(originalUrl);
    const hostname = urlObj.hostname.replace('www.', '');
    const candidates = SITE_DOMAIN_MAP[hostname];
    if (!candidates) return null; // 没有备选域名

    for (const domain of candidates) {
      // 尝试多种 URL 格式
      const urlsToTry = [
        `https://${domain}/`,
        `https://www.${domain}/`
      ];
      for (const testUrl of urlsToTry) {
        if (testUrl === originalUrl) continue; // 跳过当前已失效的域名
        const isAvailable = await checkSiteAvailability(testUrl);
        if (isAvailable) {
          console.log(`[SiteUpdater] Found working alternative: ${testUrl} (original: ${originalUrl})`);
          return testUrl;
        }
      }
    }
    console.log(`[SiteUpdater] No working alternative found for: ${originalUrl}`);
    return null;
  } catch (e) {
    console.error('[SiteUpdater] Error searching for alternative URL:', e);
    return null;
  }
}

// IPC 通道：渲染进程请求检测并更新站点
ipcMain.on('check-and-update-site', async (event, originalUrl) => {
  const newUrl = await searchAndUpdateSiteUrl(originalUrl);
  if (newUrl && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('site-url-updated', { originalUrl, newUrl });
  }
});

// IPC 通道：批量检测所有影视导航站点
ipcMain.on('check-all-sites', async (event, sites) => {
  const results = [];
  for (const site of sites) {
    const isAvailable = await checkSiteAvailability(site.value);
    if (!isAvailable) {
      const newUrl = await searchAndUpdateSiteUrl(site.value);
      results.push({ original: site.value, available: false, newUrl });
    } else {
      results.push({ original: site.value, available: true, newUrl: null });
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sites-check-results', results);
  }
});

// IPC 通道：渲染进程请求获取失效域名映射
ipcMain.handle('get-site-url-mappings', async (event) => {
  return siteUrlMappings;
});

// --- 用户配置文件同步（主进程 ↔ 渲染进程） ---
// 渲染进程保存完整用户配置到JSON文件
ipcMain.on('save-user-config', (event, config) => {
  saveUserConfig(config);
  // 同步更新主进程内存中的 dramaSites
  if (config.dramaSites) {
    dramaSites.length = 0;
    const newSites = (config.dramaSites || []).map(site => site.value || site);
    dramaSites.push(...newSites);
  }
});

// 渲染进程请求获取当前用户配置
ipcMain.handle('get-user-config', async (event) => {
  return loadUserConfig();
});

app.whenReady().then(async () => {
  await session.defaultSession.clearStorageData();
  await session.defaultSession.clearCache();

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = userAgent;
    callback({ requestHeaders: details.requestHeaders });
  });

  const filter = { urls: ['*://*/*'] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    if (details.responseHeaders) {
      const headersToLower = Object.keys(details.responseHeaders).reduce((acc, key) => {
        acc[key.toLowerCase()] = key;
        return acc;
      }, {});

      if (headersToLower['content-security-policy']) {
        delete details.responseHeaders[headersToLower['content-security-policy']];
      }
      if (headersToLower['x-frame-options']) {
        delete details.responseHeaders[headersToLower['x-frame-options']];
      }
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  const cacheInfoPath = path.join(app.getPath('userData'), 'cache_info.json');
  const twentyFourHours = 24 * 60 * 60 * 1000;
  let cacheIsValid = false;

  if (fs.existsSync(cacheInfoPath)) {
    try {
      const cacheInfo = JSON.parse(fs.readFileSync(cacheInfoPath, 'utf8'));
      if (cacheInfo.lastPreloadTimestamp && (Date.now() - cacheInfo.lastPreloadTimestamp < twentyFourHours)) {
        cacheIsValid = true;
        console.log('Pre-rendering cache is still valid.');
      }
    } catch (error) {
      console.error('Error reading cache info file:', error);
    }
  }

  createWindow();

  if (!cacheIsValid) {
    console.log('Cache is missing or stale. Clearing session cache...');
    await session.defaultSession.clearCache();
    try {
      fs.writeFileSync(cacheInfoPath, JSON.stringify({ lastPreloadTimestamp: Date.now() }));
      console.log('Updated session cache timestamp.');
    } catch (error) {
      console.error('Error writing cache info file:', error);
    }
  }

  // Unconditionally preload sites on startup, regardless of session cache validity
  await preloadSites();

  // Initialize auto updater after window is ready
  initializeAutoUpdater();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('open-external-link', (event, url) => {
  shell.openExternal(url);
});
ipcMain.on('check-for-updates', () => {
  checkUpdate();
});

ipcMain.on('download-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

// --- 镜像选择 IPC ---
ipcMain.handle('set-update-mirror', (event, config) => {
  console.log('[AutoUpdater] Setting mirror:', config);
  if (config.type === 'github') {
    currentMirrorType = 'github';
    currentMirrorURL = null;
  } else if (config.type === 'generic') {
    currentMirrorType = 'generic';
    currentMirrorURL = config.url;
  } else if (config.type === 'custom') {
    currentMirrorType = 'custom';
    currentMirrorURL = config.url;
  } else {
    throw new Error('未知的镜像类型: ' + config.type);
  }

  // 重新配置 autoUpdater
  configureAutoUpdater();
  isUpdaterInitialized = false; // 强制重新初始化
  if (isAppPacked) {
    initializeAutoUpdater();
  }

  return { success: true, type: currentMirrorType, url: currentMirrorURL };
});

// --- 手动更新（当 electron-updater 不可用时） ---
let manualUpdateDownload = null;

ipcMain.handle('manual-check-update', async (event, mirrorURL) => {
  console.log('[ManualUpdate] Checking for updates via mirror:', mirrorURL);
  // 获取当前版本
  const currentVersion = app.getVersion();
  // 尝试获取 latest.yml
  const url = mirrorURL + 'latest.yml';
  console.log('[ManualUpdate] Fetching:', url);

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: url,
      session: session.defaultSession
    });

    let data = '';
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error('获取 latest.yml 失败，状态码: ' + response.statusCode));
      }

      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          // 简单解析 YAML（只解析 version 和 files)
          const versionMatch = data.match(/version:\s*(.+)/);
          if (!versionMatch) {
            return reject(new Error('无法解析 latest.yml'));
          }
          const latestVersion = versionMatch[1].trim();
          console.log('[ManualUpdate] Current:', currentVersion, 'Latest:', latestVersion);

          // 简单版本比较
          const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

          if (hasUpdate) {
            // 获取文件名
            const fileMatch = data.match(/path:\s*(.+)/);
            const fileName = fileMatch ? fileMatch[1].trim() : null;
            manualUpdateInfo = { version: latestVersion, fileName: fileName, mirrorURL: mirrorURL, yaml: data };
            resolve({ hasUpdate: true, version: latestVersion, fileName: fileName });
          } else {
            resolve({ hasUpdate: false, version: latestVersion });
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    request.on('error', (err) => {
      reject(err);
    });

    request.end();
  });
});

// 简单版本比较函数
function compareVersions(v1, v2) {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const n1 = parts1[i] || 0;
    const n2 = parts2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

ipcMain.on('manual-download-update', (event) => {
  if (!manualUpdateInfo || !manualUpdateInfo.fileName) {
    event.sender.send('update-error', { message: '没有可下载的更新信息', code: 'NO_UPDATE_INFO' });
    return;
  }

  const fileName = manualUpdateInfo.fileName;
  const downloadURL = manualUpdateInfo.mirrorURL + fileName;
  const savePath = path.join(app.getPath('temp'), fileName);

  console.log('[ManualUpdate] Downloading:', downloadURL, '->', savePath);

  const file = fs.createWriteStream(savePath);
  let downloadedBytes = 0;
  let totalBytes = 0;

  const request = net.request({
    method: 'GET',
    url: downloadURL,
    session: session.defaultSession
  });

  request.on('response', (response) => {
    if (response.statusCode !== 200) {
      event.sender.send('update-error', { message: '下载失败，状态码: ' + response.statusCode, code: 'DOWNLOAD_FAILED' });
      file.close();
      fs.unlinkSync(savePath);
      return;
    }

    totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    console.log('[ManualUpdate] Total bytes:', totalBytes);

    response.on('data', (chunk) => {
      file.write(chunk);
      downloadedBytes += chunk.length;

      if (totalBytes > 0) {
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        event.sender.send('manual-update-progress', {
          percent: percent,
          transferred: downloadedBytes,
          total: totalBytes
        });
      }
    });

    response.on('end', () => {
      file.end(() => {
        console.log('[ManualUpdate] Download complete:', savePath);
        manualUpdateDownload = savePath;
        event.sender.send('manual-update-downloaded', { version: manualUpdateInfo.version, filePath: savePath });
      });
    });
  });

  request.on('error', (err) => {
    console.error('[ManualUpdate] Download error:', err);
    event.sender.send('update-error', { message: '下载失败: ' + err.message, code: 'DOWNLOAD_ERROR' });
    file.close();
    try { fs.unlinkSync(savePath); } catch (e) {}
  });

  // 支持取消下载
  manualUpdateCanceled = false;
  ipcMain.once('cancel-manual-download', () => {
    manualUpdateCanceled = true;
    request.abort();
    file.close();
    try { fs.unlinkSync(savePath); } catch (e) {}
  });

  request.end();
});

let manualUpdateCanceled = false;

// --- Auto Updater ---

// 检测是否为开发模式（应用未打包）
const isAppPacked = app.isPackaged;

// 配置 autoUpdater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// 根据当前镜像类型配置 autoUpdater
function configureAutoUpdater() {
  if (currentMirrorType === 'github') {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'qwerwhr',
      repo: 'AudioVisual'
    });
    console.log('[AutoUpdater] Using GitHub official source');
  } else if (currentMirrorType === 'generic') {
    if (!currentMirrorURL) {
      console.error('[AutoUpdater] Generic mirror URL not set, falling back to GitHub');
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'qwerwhr',
        repo: 'AudioVisual'
      });
    } else {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: currentMirrorURL
      });
      console.log('[AutoUpdater] Using generic mirror:', currentMirrorURL);
    }
  }
}

configureAutoUpdater();

// 添加日志以便调试（如果 electron-log 可用）
try {
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';
} catch (e) {
  // electron-log 不可用，使用 console
  autoUpdater.logger = console;
}

let isUpdaterInitialized = false;
let updateCheckTimeout = null;

function initializeAutoUpdater() {
  if (isUpdaterInitialized) {
    return;
  }

  console.log('[AutoUpdater] Initializing auto updater...');
  console.log('[AutoUpdater] Current version:', app.getVersion());
  console.log('[AutoUpdater] Update feed URL:', `https://github.com/${MIRROR_NODES.github.owner}/${MIRROR_NODES.github.repo}`);

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-checking');
    }
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    if (updateCheckTimeout) {
      clearTimeout(updateCheckTimeout);
      updateCheckTimeout = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] Update not available. Current version:', info.version);
    if (updateCheckTimeout) {
      clearTimeout(updateCheckTimeout);
      updateCheckTimeout = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available');
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const logMessage = `Downloaded ${Math.floor(progressObj.percent)}% (${Math.floor(progressObj.transferred / 1024 / 1024)}MB / ${Math.floor(progressObj.total / 1024 / 1024)}MB)`;
    console.log('[AutoUpdater]', logMessage);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err);
    const isNetworkError = err.code && ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'TIMEOUT'].includes(err.code);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const errorMessage = err.message || err.toString();
      mainWindow.webContents.send('update-error', {
        message: errorMessage,
        code: err.code,
        stack: err.stack
      });
      // 网络错误时通知渲染进程弹窗选择镜像
      if (isNetworkError) {
        mainWindow.webContents.send('update-timeout');
      }
    }
  });

  isUpdaterInitialized = true;
  console.log('[AutoUpdater] Initialization complete.');
}

function checkUpdate() {
  if (!isUpdaterInitialized) {
    initializeAutoUpdater();
  }

  // 清除之前的超时定时器
  if (updateCheckTimeout) {
    clearTimeout(updateCheckTimeout);
    updateCheckTimeout = null;
  }

  console.log('[AutoUpdater] Manually checking for updates...');
  console.log('[AutoUpdater] App is packed:', isAppPacked);

  // 开发模式下的特殊处理
  if (!isAppPacked) {
    console.log('[AutoUpdater] Running in development mode, update check is disabled.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 延迟一下让用户看到"检查中"状态
      setTimeout(() => {
        mainWindow.webContents.send('update-dev-mode', {
          message: '开发模式下无法检查更新。\n请使用打包后的应用程序进行更新检查。',
          version: app.getVersion()
        });
      }, 500);
    }
    return;
  }

  // 设置30秒超时，防止一直卡住
  updateCheckTimeout = setTimeout(() => {
    console.error('[AutoUpdater] Check timeout after 30 seconds');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', {
        message: '检查更新超时，请检查网络连接或稍后重试。',
        code: 'TIMEOUT'
      });
      // 通知渲染进程弹出镜像选择对话框
      mainWindow.webContents.send('update-timeout');
    }
  }, 30000);
  
  try {
    autoUpdater.checkForUpdates()
      .then(result => {
        console.log('[AutoUpdater] Check result:', result);
      })
      .catch(err => {
        console.error('[AutoUpdater] Check failed:', err);
        if (updateCheckTimeout) {
          clearTimeout(updateCheckTimeout);
          updateCheckTimeout = null;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-error', {
            message: err.message || '检查更新失败，请检查网络连接或稍后重试。',
            code: err.code
          });
        }
      });
  } catch (err) {
    console.error('[AutoUpdater] Check failed (sync error):', err);
    if (updateCheckTimeout) {
      clearTimeout(updateCheckTimeout);
      updateCheckTimeout = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', {
        message: err.message || '检查更新失败，请检查网络连接或稍后重试。',
        code: err.code
      });
    }
  }
}
