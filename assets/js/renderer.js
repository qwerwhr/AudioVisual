// renderer.js
// 确保所有函数在任何调用之前定义（防止 Electron 缓存或解析异常导致 undefined）
function populateSelect(selectElement, items) {
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        selectElement.appendChild(option);
    });
}

function navigateTo(url, isPlatformSwitch = false, themeVars = null) {
    console.log('[Renderer] navigateTo called with:', { url, isPlatformSwitch, themeVars });

    if (!url) {
        console.error('[Renderer] navigateTo called with empty URL!');
        showToast('导航错误：URL 为空', 'error');
        return;
    }

    if (!window.voidAPI) {
        console.error('[Renderer] window.voidAPI is not defined! Preload script may have failed.');
        showToast('系统错误：通信接口未加载', 'error');
        return;
    }

    if (typeof window.voidAPI.navigate !== 'function') {
        console.error('[Renderer] window.voidAPI.navigate is not a function!', typeof window.voidAPI.navigate);
        showToast('系统错误：导航方法不可用', 'error');
        return;
    }

    try {
        loadingOverlay.classList.remove('hidden');
        urlInput.value = url;
        currentVideoUrl = url;
        isCurrentlyParsing = false;

        console.log('[Renderer] Sending navigate IPC to main process:', url);
        window.voidAPI.navigate(url, isPlatformSwitch, themeVars);
        console.log('[Renderer] navigate IPC sent successfully');

        if (container.classList.contains('drama-mode')) {
            const dramaSite = dramaSites.find(site => url.startsWith(site.value));
            if (dramaSite) {
                quickDramaSelect.value = dramaSite.value;
            }
        }
    } catch (err) {
        console.error('[Renderer] navigateTo error:', err);
        showToast('导航失败: ' + (err.message || '未知错误'), 'error');
    }
}

console.log('[Renderer] Script loaded, starting execution...');

// 全局错误捕获——帮助诊断按钮无响应问题
window.addEventListener('error', (event) => {
    console.error('[Renderer] UNCAUGHT ERROR:', event.error?.message || event.message, 'at', event.filename, 'line', event.lineno);
    if (window.voidAPI?.showToast) {
        window.voidAPI.showToast(`脚本错误: ${event.error?.message || event.message}`, 'error');
    }
});

const urlInput = document.getElementById('url-input');
const goButton = document.getElementById('go-button');
const parseButton = document.getElementById('parse-button');
const sidebarToggleButton = document.getElementById('sidebar-toggle-button');
const backButton = document.getElementById('back-button');
const forwardButton = document.getElementById('forward-button');
const homeButton = document.getElementById('home-button');
const minimizeButton = document.getElementById('minimize-button');
const maximizeButton = document.getElementById('maximize-button');
const closeButton = document.getElementById('close-button');
const youkuCustomPage = document.getElementById('youku-custom-page');
const youkuUrlInput = document.getElementById('youku-url-input');
const quickPlatformSelect = document.getElementById('quick-platform-select');
const quickApiSelect = document.getElementById('quick-api-select');
const quickParseButton = document.getElementById('quick-parse-button');
const quickDramaSelect = document.getElementById('quick-drama-select');
const quickModeToggle = document.getElementById('quick-mode-toggle');
const loadingOverlay = document.getElementById('loading-overlay');

const dramaModeButton = document.getElementById('drama-mode-button');
const dramaTheme = document.getElementById('drama-theme');
const container = document.querySelector('.container');
const controlsWrapper = document.querySelector('.controls-wrapper');
const dramaControls = document.querySelector('.drama-controls');
const usageTips = document.querySelector('.usage-tips');
const dramaUsageTips = document.querySelector('.drama-usage-tips');
const sidebarScaler = document.querySelector('.sidebar-scaler');

// Settings Elements
const settingsButton = document.getElementById('settings-button');
const settingsPage = document.getElementById('settings-page');
const closeSettings = document.getElementById('close-settings');
const cancelSettings = document.getElementById('cancel-settings');
const saveSettings = document.getElementById('save-settings');
const resetSettings = document.getElementById('reset-settings');
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const parsingListInput = document.getElementById('parsing-list-input');
const dramaListInput = document.getElementById('drama-list-input');
const resolutionFilter = document.getElementById('resolution-filter');
const searchApiButton = document.getElementById('search-api-button');
const checkApiButton = document.getElementById('check-api-button');

let currentVideoUrl = '';
let isCurrentlyParsing = false;
let currentYoukuUrl = '';

// --- UI 工具 ---
function showToast(message, type = 'info') {
    const bgColor = type === 'error' ? '#ff6768' : (type === 'success' ? '#4caf50' : '#3a3d5b');
    Toastify({
        text: message,
        duration: 3000,
        gravity: "top", // `top` or `bottom`
        position: "center", // `left`, `center` or `right`
        offset: {
            y: 70 // 增加偏移量，避开顶部地址栏
        },
        stopOnFocus: true,
        style: {
            background: bgColor,
            borderRadius: "8px",
            boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
            fontSize: "14px",
            fontWeight: "500"
        }
    }).showToast();
}

function showConfirm(message, title = '提示信息') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const titleEl = document.getElementById('modal-title');
        const messageEl = document.getElementById('modal-message');
        const confirmBtn = document.getElementById('modal-confirm');
        const cancelBtn = document.getElementById('modal-cancel');

        if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
            resolve(confirm(message)); // Fallback
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex';

        const cleanup = (result) => {
            modal.style.display = 'none';
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(result);
        };

        confirmBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
    });
}

const platforms = [
    { value: 'https://v.qq.com', label: '腾讯视频' },
    { value: 'https://www.iqiyi.com', label: '爱奇艺' },
    { value: 'https://www.youku.com', label: '优酷' },
    { value: 'https://www.bilibili.com', label: '哔哩哔哩' },
    { value: 'https://www.mgtv.com', label: '芒果TV' }
];

const DEFAULT_API_LIST = [
    { value: "https://jx.xmflv.com/?url=", label: "虾米视频解析", resolution: "1080P", status: "active" },
    { value: "https://jx.77flv.cc/?url=", label: "七七云解析", resolution: "1080P", status: "active" },
    { value: "https://jx.playerjy.com/?url=", label: "Player-JY", resolution: "720P", status: "active" },
    { value: "https://jiexi.789jiexi.icu:4433/?url=", label: "789解析", resolution: "720P", status: "active" },
    { value: "https://jx.2s0.cn/player/?url=", label: "极速解析", resolution: "1080P", status: "active" },
    { value: "https://bd.jx.cn/?url=", label: "冰豆解析", resolution: "720P", status: "active" },
    { value: "https://jx.973973.xyz/?url=", label: "973解析", resolution: "1080P", status: "active" },
    { value: "https://www.ckplayer.vip/jiexi/?url=", label: "CK", resolution: "4K", status: "active" },
    { value: "https://jx.nnxv.cn/tv.php?url=", label: "七哥解析", resolution: "1080P", status: "active" },
    { value: "https://www.yemu.xyz/?url=", label: "夜幕", resolution: "720P", status: "active" },
    { value: "https://www.pangujiexi.com/jiexi/?url=", label: "盘古", resolution: "1080P", status: "active" },
    { value: "https://www.playm3u8.cn/jiexi.php?url=", label: "playm3u8", resolution: "720P", status: "active" },
    { value: "https://video.isyour.love/player/getplayer?url=", label: "芒果TV1", resolution: "1080P", status: "active" },
    { value: "https://im1907.top/?jx=", label: "芒果TV2", resolution: "720P", status: "active" },
    { value: "https://jx.hls.one/?url=", label: "HLS解析", resolution: "4K", status: "active" },
];

// 分辨率分组定义
const RESOLUTION_GROUPS = [
    { key: '4K', label: '4K 超高清', color: '#ff6768' },
    { key: '1080P', label: '1080P 高清', color: '#4caf50' },
    { key: '720P', label: '720P 标准', color: '#3a3d5b' },
    { key: 'unknown', label: '未分类', color: '#888' }
];

const DEFAULT_DRAMA_SITES = [
    { value: 'https://monkey-flix.com/', label: '猴影工坊' },
    { value: 'https://www.letu.me/', label: '茉小影' },
    { value: 'https://103.194.185.51:51122/', label: '网飞猫' },
    { value: 'https://www.keke6.app/', label: '可可影视' }
];

let apiList = [...DEFAULT_API_LIST];
let dramaSites = [...DEFAULT_DRAMA_SITES];

// --- 去重工具函数 ---
function deduplicateList(list, key = 'value') {
    const seen = new Set();
    return list.filter(item => {
        if (seen.has(item[key])) return false;
        seen.add(item[key]);
        return true;
    });
}

// --- Settings Persistence ---
const SettingsManager = {
    async load() {
        try {
            // 优先从JSON配置文件读取（主进程持久化数据源）
            if (window.voidAPI && window.voidAPI.getUserConfig) {
                try {
                    const config = await window.voidAPI.getUserConfig();
                    if (config) {
                        if (config.apiList && config.apiList.length > 0) {
                            apiList = config.apiList;
                            console.log('[Settings] Loaded apiList from JSON config:', apiList.length, 'items');
                        }
                        if (config.dramaSites && config.dramaSites.length > 0) {
                            dramaSites = config.dramaSites;
                            console.log('[Settings] Loaded dramaSites from JSON config:', dramaSites.length, 'sites');
                            // 同步回localStorage作为备份
                            localStorage.setItem('dramaSites', JSON.stringify(dramaSites));
                            localStorage.setItem('apiList', JSON.stringify(apiList));
                        }
                        return; // 从配置文件成功加载，跳过 localStorage
                    }
                } catch (e) {
                    console.warn('[Settings] Failed to load JSON config, falling back to localStorage:', e);
                }
            }

            // 回退：从 localStorage 读取
            const savedApis = localStorage.getItem('apiList');
            const savedDramas = localStorage.getItem('dramaSites');

            if (savedApis) apiList = JSON.parse(savedApis);
            if (savedDramas) {
                dramaSites = JSON.parse(savedDramas);
                // Temporary migration to clear old netflixgc cache and apply new defaults
                if (dramaSites.some(d => d.value && d.value.includes('netflixgc.com'))) {
                    console.log('Detected old default drama sites in storage. Resetting to new defaults.');
                    dramaSites = [...DEFAULT_DRAMA_SITES];
                    localStorage.setItem('dramaSites', JSON.stringify(dramaSites));
                }
            }
            // 去重：防止配置数据中出现重复项
            apiList = deduplicateList(apiList);
            dramaSites = deduplicateList(dramaSites);
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    },
    save(newApis, newDramas) {
        try {
            // 保存前先去重
            newApis = deduplicateList(newApis);
            newDramas = deduplicateList(newDramas);
            // 1. 保存到 localStorage（渲染进程本地缓存）
            localStorage.setItem('apiList', JSON.stringify(newApis));
            localStorage.setItem('dramaSites', JSON.stringify(newDramas));
            apiList = newApis;
            dramaSites = newDramas;

            // 2. 同步写入JSON配置文件（主进程持久化，重启不丢失）
            const config = { apiList: newApis, dramaSites: newDramas };
            if (window.voidAPI && window.voidAPI.saveUserConfig) {
                window.voidAPI.saveUserConfig(config);
                console.log('[Settings] Config synced to JSON file (persistent).');
            }

            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            return false;
        }
    },
    reset() {
        localStorage.removeItem('apiList');
        localStorage.removeItem('dramaSites');
        apiList = [...DEFAULT_API_LIST];
        dramaSites = [...DEFAULT_DRAMA_SITES];
    },
    // Helper to parse textarea into objects (支持分辨率和状态字段)
    parseInput(text) {
        return text.split('\n')
            .map(line => line.trim())
            .filter(line => line.includes('|'))
            .map(line => {
                const parts = line.split('|');
                const label = parts[0]?.trim() || '';
                const value = parts[1]?.trim() || '';
                const resolution = parts[2]?.trim() || 'unknown';
                const status = parts[3]?.trim() || 'active';
                return { label, value, resolution, status };
            });
    },
    // Helper to format objects for textarea (包含分辨率和状态)
    formatForInput(list) {
        return list.map(item => {
            const resolution = item.resolution || 'unknown';
            const status = item.status || 'active';
            return `${item.label}|${item.value}|${resolution}|${status}`;
        }).join('\n');
    }
};

// --- 异步加载用户配置并初始化 UI ---
const platformSelect = document.getElementById('platform-select');
const apiSelect = document.getElementById('api-select');


function triggerParse() {
    console.log(`[Renderer] Attempting to trigger parse. isCurrentlyParsing: ${isCurrentlyParsing}, currentVideoUrl: ${currentVideoUrl}`);

    // Detect if the user is trying to parse the platform's homepage
    const isHomepage = platforms.some(p => currentVideoUrl === p.value || currentVideoUrl === p.value + '/');
    if (isHomepage) {
        console.warn('[Renderer] Cannot parse platform homepage.');
        showToast('当前页面为平台首页，请选择具体的视频后再点击解析。', 'error');
        isCurrentlyParsing = false;
        loadingOverlay.classList.add('hidden');
        return;
    }

    if (isCurrentlyParsing && currentVideoUrl) {
        // 立即显示加载状态
        loadingOverlay.classList.remove('hidden');

        const selectedApiUrl = apiSelect.value;
        const finalUrl = selectedApiUrl + currentVideoUrl;
        console.log(`[Renderer] Final Parse URL: ${finalUrl}`);

        // 使用setTimeout确保UI更新后再执行嵌入，避免阻塞
        setTimeout(() => {
            window.voidAPI.embedVideo(finalUrl);
            // 核心修复：1.5秒后强制隐藏加载层，防止遮挡解析结果
            setTimeout(() => {
                loadingOverlay.classList.add('hidden');
            }, 1500);
        }, 50);
    } else {
        console.warn('[Renderer] Cannot trigger parse: missing internal state or URL.');
        loadingOverlay.classList.add('hidden');
    }
}

function parseYoukuUrl() {
    let youkuVideoUrl = youkuUrlInput.value.trim() || currentYoukuUrl;
    if (youkuVideoUrl) {
        currentYoukuUrl = youkuVideoUrl;
        currentVideoUrl = youkuVideoUrl; // 更新currentVideoUrl确保地址栏显示正确
        const selectedApiUrl = apiSelect.value;
        const finalUrl = selectedApiUrl + youkuVideoUrl;
        urlInput.value = currentYoukuUrl;
        loadingOverlay.classList.remove('hidden');
        window.voidAPI.navigate(finalUrl, false);
        youkuCustomPage.style.display = 'none';
    } else {
        // 关键修复：隐藏加载层并使用美观的 Toast 提示
        loadingOverlay.classList.add('hidden');
        showToast('请输入有效的优酷视频链接。', 'error');
    }
}

(async () => {
    console.log('[Renderer] IIFE started');
    try {
        await SettingsManager.load();
        console.log('[Renderer] SettingsManager.load() completed');
    } catch (err) {
        console.error('[Renderer] SettingsManager.load() failed:', err);
        // 继续使用默认配置，不阻止 UI 初始化
        // 注意：不能重新赋值 const 变量，这里只是确保后续逻辑使用默认值
        console.log('[Renderer] Using DEFAULT config due to load failure');
    }

    // --- 分辨率筛选 ---
    // 根据筛选值过滤接口列表
function filterApisByResolution(resolution) {
    const activeApis = apiList.filter(api => api.status !== 'deprecated');
    if (resolution === 'all') return activeApis;
    return activeApis.filter(api => (api.resolution || 'unknown') === resolution);
}

// 分辨率筛选下拉框事件
resolutionFilter.addEventListener('change', () => {
    const resolution = resolutionFilter.value;
    const filteredApis = filterApisByResolution(resolution);
    // 更新两个接口选择器
    [apiSelect, quickApiSelect].forEach(sel => {
        sel.innerHTML = '';
        if (resolution === 'all') {
            // 全部分辨率时按分组显示
            RESOLUTION_GROUPS.forEach(group => {
                const groupApis = filteredApis.filter(api => (api.resolution || 'unknown') === group.key);
                if (groupApis.length === 0) return;
                const optgroup = document.createElement('optgroup');
                optgroup.label = group.label;
                groupApis.forEach(api => {
                    const option = document.createElement('option');
                    option.value = api.value;
                    option.textContent = api.label;
                    optgroup.appendChild(option);
                });
                sel.appendChild(optgroup);
            });
        } else {
            populateSelect(sel, filteredApis);
        }
    });
});

// --- 接口搜索按钮 ---
searchApiButton.addEventListener('click', () => {
    searchAndFetchApiList();
});

// --- 接口可用性检测按钮 ---
checkApiButton.addEventListener('click', () => {
    checkAllApiAvailability();
});



populateSelect(platformSelect, platforms);
populateSelect(apiSelect, apiList);
populateSelect(quickPlatformSelect, platforms);
populateSelect(quickApiSelect, apiList);
populateSelect(quickDramaSelect, dramaSites);
})(); // --- 异步配置加载完成，UI 初始化完毕 ---

// --- Selector Synchronization ---
function syncSelectors(source, target) {
    target.value = source.value;
}

platformSelect.addEventListener('change', (event) => {
    console.log('[Renderer] platformSelect change event fired, value:', event.target.value);
    syncSelectors(platformSelect, quickPlatformSelect);
    const selectedPlatform = event.target.value;
    isCurrentlyParsing = false;
    currentYoukuUrl = '';
    // 优酷直接导航到主页，不再显示自定义输入页
    navigateTo(selectedPlatform, true);
});

quickPlatformSelect.addEventListener('change', () => {
    syncSelectors(quickPlatformSelect, platformSelect);
    platformSelect.dispatchEvent(new Event('change'));
});

apiSelect.addEventListener('change', () => {
    triggerParse();
});

quickApiSelect.addEventListener('change', () => {
    syncSelectors(quickApiSelect, apiSelect);
    apiSelect.dispatchEvent(new Event('change'));
});

goButton.addEventListener('click', () => {
    let url = urlInput.value.trim();
    if (url) {
        isCurrentlyParsing = false;
        if (!url.startsWith('http')) url = 'https' + '://' + url;
        currentVideoUrl = url;
        navigateTo(url);
    }
});

urlInput.addEventListener('keydown', (e) => e.key === 'Enter' && goButton.click());

parseButton.addEventListener('click', () => {
    // 立即显示加载状态，提升响应速度
    loadingOverlay.classList.remove('hidden');
    isCurrentlyParsing = true;
    // 使用requestAnimationFrame确保UI更新后再执行解析
    requestAnimationFrame(() => {
        triggerParse();
    });
});

apiSelect.addEventListener('change', () => {
    if (platformSelect.value !== 'https://www.youku.com') {
        triggerParse();
    }
});

sidebarToggleButton.addEventListener('click', () => {
    // Force direct class manipulation for robustness
    const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
    console.log('[Renderer] Sidebar toggle. isCollapsed:', isCollapsed);
    requestAnimationFrame(() => window.voidAPI.toggleSidebar(isCollapsed));
});

quickParseButton.addEventListener('click', () => {
    parseButton.click();
});

quickDramaSelect.addEventListener('change', (event) => {
    navigateTo(event.target.value);
});

quickModeToggle.addEventListener('click', (event) => {
    dramaModeButton.click();
});

backButton.addEventListener('click', () => window.voidAPI.goBack());
forwardButton.addEventListener('click', () => window.voidAPI.goForward());

homeButton.addEventListener('click', () => {
    isCurrentlyParsing = false;
    const isDramaMode = container.classList.contains('drama-mode');
    if (isDramaMode) {
        try {
            const currentUrl = new URL(urlInput.value);
            const rootUrl = `${currentUrl.protocol}//${currentUrl.hostname}`;
            navigateTo(rootUrl);
        } catch (error) {
            console.error("Invalid URL in address bar:", urlInput.value);
        }
    } else {
        const homeUrl = platformSelect.value;
        navigateTo(homeUrl, true);
    }
});

minimizeButton.addEventListener('click', () => window.voidAPI.minimizeWindow());
maximizeButton.addEventListener('click', () => window.voidAPI.maximizeWindow());
closeButton.addEventListener('click', () => window.voidAPI.closeWindow());

window.voidAPI.onUrlUpdate((url) => {
    const isApiUrl = apiList.some(api => url.startsWith(api.value));
    if (isApiUrl) {
        // 如果是优酷解析的API URL，显示优酷视频链接
        if (currentYoukuUrl && url.includes(encodeURIComponent(currentYoukuUrl))) {
            urlInput.value = currentYoukuUrl;
        } else {
            urlInput.value = currentVideoUrl;
        }
    } else {
        const previousVideoUrl = currentVideoUrl;
        urlInput.value = url;
        currentVideoUrl = url;

        // 如果是爱奇艺视频页面且URL发生了变化，自动触发解析
        if (url.includes('iqiyi.com/v_') && url.includes('.html') &&
            previousVideoUrl && previousVideoUrl !== url &&
            platformSelect.value === 'https://www.iqiyi.com') {
            console.log('iQiyi episode changed, auto-parsing:', url);
            isCurrentlyParsing = true;
            triggerParse();
        }

        // 如果是腾讯视频页面且URL发生了变化，自动触发解析
        if (url.includes('v.qq.com/x/cover/') &&
            previousVideoUrl && previousVideoUrl !== url &&
            platformSelect.value === 'https://v.qq.com') {
            console.log('Tencent Video episode changed, auto-parsing:', url);
            isCurrentlyParsing = true;
            triggerParse();
        }

        // 如果是芒果TV页面且URL发生了变化，自动触发解析
        if (url.includes('mgtv.com/b/') &&
            previousVideoUrl && previousVideoUrl !== url &&
            platformSelect.value === 'https://www.mgtv.com') {
            console.log('Mango TV episode changed, auto-parsing:', url);
            isCurrentlyParsing = true;
            triggerParse();
        }

        // 如果是优酷视频页面且URL发生了变化，自动触发解析
        if (url.includes('youku.com/v_show/') &&
            previousVideoUrl && previousVideoUrl !== url &&
            platformSelect.value === 'https://www.youku.com') {
            console.log('Youku episode changed, auto-parsing:', url);
            isCurrentlyParsing = true;
            triggerParse();
        }

        // 如果是哔哩哔哩番剧页面且URL发生了变化，自动触发解析
        if ((url.includes('bilibili.com/bangumi/play/') ||
            url.includes('bilibili.com/video/') && (url.includes('?p=') || url.includes('&p='))) &&
            previousVideoUrl && previousVideoUrl !== url &&
            platformSelect.value === 'https://www.bilibili.com') {
            console.log('Bilibili episode changed, auto-parsing:', url);
            isCurrentlyParsing = true;
            triggerParse();
        }
    }
});

window.voidAPI.onNavStateUpdate(({ canGoBack, canGoForward }) => {
    backButton.disabled = !canGoBack;
    forwardButton.disabled = !canGoForward;
});

window.voidAPI.onLoadFinished(() => {
    loadingOverlay.classList.add('hidden');
});

// 处理主动探测到的视频 URL，实现零延迟注入
window.voidAPI.onFastParseUrl((url) => {
    if (url) {
        currentVideoUrl = url;
        urlInput.value = url;
        isCurrentlyParsing = true;
        triggerParse();
    }
});

window.voidAPI.onInitSidebarState((isCollapsed) => {
    console.log('[Renderer] Received initial sidebar state:', isCollapsed);
    if (isCollapsed) {
        document.body.classList.add('sidebar-collapsed');
    } else {
        document.body.classList.remove('sidebar-collapsed');
    }
});

// --- Initialization ---
function initialize() {
    // Initial UI state setup
    dramaControls.style.display = 'none';
    dramaUsageTips.style.display = 'none';

    // Populate Dynamic UI from settings
    refreshDynamicUI();

    updateDOMForTheme(true);
    // Use setTimeout so the DOM and IPC have time to settle their visual state before navigation triggers
    setTimeout(() => {
        navigateForTheme(true);
    }, 50);
}
// Moved to bottom to ensure all functions are defined

function updateDOMForTheme(isSwitchingToDrama) {
    if (isSwitchingToDrama) {
        dramaModeButton.innerHTML = `
            <div class="button-icon" style="display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;">
                🏠
            </div>
            <div class="button-text">国内解析</div>
        `;
        const modeIcon = quickModeToggle.querySelector('.mode-icon');
        if (modeIcon) modeIcon.textContent = '🏠';
        dramaTheme.disabled = false;
        container.classList.add('drama-mode');
    } else {
        dramaModeButton.innerHTML = `
            <div class="button-icon" style="display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;">
                🌍
            </div>
            <div class="button-text">美韩日剧</div>
        `;
        const modeIcon = quickModeToggle.querySelector('.mode-icon');
        if (modeIcon) modeIcon.textContent = '🌍';
        dramaTheme.disabled = true;
        container.classList.remove('drama-mode');
    }
}

function navigateForTheme(isSwitchingToDrama) {
    console.log('[Renderer] navigateForTheme called, isSwitchingToDrama:', isSwitchingToDrama);
    const theme = isSwitchingToDrama ? {
        '--av-primary-bg': '#000000',
        '--av-accent-color': '#333333',
        '--av-highlight-color': '#C0FAA0'
    } : {
        '--av-primary-bg': '#1e1e2f',
        '--av-accent-color': '#3a3d5b',
        '--av-highlight-color': '#ff6768'
    };
    const url = isSwitchingToDrama
        ? (dramaSites.length > 0 ? dramaSites[0].value : '')
        : platformSelect.value;

    console.log('[Renderer] navigateForTheme URL:', url, 'dramaSites count:', dramaSites.length);

    if (!url) {
        console.warn('[Renderer] navigateForTheme: URL is empty, aborting.');
        showToast('没有可用的影视站点', 'error');
        return; // Safety check
    }

    // 优酷现在直接显示主页，不再使用自定义输入页
    navigateTo(url, !isSwitchingToDrama, theme);
}

dramaModeButton.addEventListener('click', (event) => {
    const isCurrentlyDrama = container.classList.contains('drama-mode');
    const isSwitchingToDrama = !isCurrentlyDrama;
    navigateForTheme(isSwitchingToDrama);

    if (!document.startViewTransition) {
        updateDOMForTheme(isSwitchingToDrama);
        return;
    }

    const x = event.clientX;
    const y = event.clientY;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => updateDOMForTheme(isSwitchingToDrama));
    transition.ready.then(() => {
        document.documentElement.animate(
            { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
            { duration: 600, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
        );
    });
});

// --- Settings Page Logic ---
const tabMetadata = {
    'parsing-tab': { title: '解析接口管理', desc: '配置自定义解析引擎，支持快速切换与负载均衡' },
    'drama-tab': { title: '影视导航管理', desc: '自定义侧边栏影视导航站点，打造您的私人影视库' },
    'appearance-tab': { title: '界面偏好设置', desc: '调整应用视觉风格与交互体验' }
};

const settingsTabTitle = document.getElementById('settings-current-tab-title');
const settingsTabDesc = document.getElementById('settings-current-tab-desc');
const parsingLineCount = document.getElementById('parsing-line-count');
const dramaLineCount = document.getElementById('drama-line-count');

function updateLineCount(textarea, display) {
    const lines = textarea.value.split('\n').filter(l => l.trim() !== '').length;
    display.textContent = lines;
}

function openSettings() {
    parsingListInput.value = SettingsManager.formatForInput(apiList);
    dramaListInput.value = SettingsManager.formatForInput(dramaSites);
    updateLineCount(parsingListInput, parsingLineCount);
    updateLineCount(dramaListInput, dramaLineCount);
    settingsPage.style.display = 'flex';
    window.voidAPI.setViewVisibility(false);
}

function closeSettingsPage() {
    settingsPage.style.display = 'none';
    window.voidAPI.setViewVisibility(true);
}

settingsButton.addEventListener('click', openSettings);
closeSettings.addEventListener('click', closeSettingsPage);
cancelSettings.addEventListener('click', async () => {
    if (await showConfirm('确定要恢复默认设置吗？所有自定义列表将被清除。')) {
        SettingsManager.reset();
        refreshDynamicUI();
        parsingListInput.value = SettingsManager.formatForInput(apiList);
        dramaListInput.value = SettingsManager.formatForInput(dramaSites);
        showToast('已恢复默认设置，请点击“应用并保存”使其生效。', 'info');
    }
});

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = btn.dataset.tab;
        document.getElementById(targetTab).classList.add('active');

        // Update header metadata
        if (tabMetadata[targetTab]) {
            settingsTabTitle.textContent = tabMetadata[targetTab].title;
            settingsTabDesc.textContent = tabMetadata[targetTab].desc;
        }
    });
});

[parsingListInput, dramaListInput].forEach(input => {
    const display = input.id === 'parsing-list-input' ? parsingLineCount : dramaLineCount;
    input.addEventListener('input', () => updateLineCount(input, display));
});

saveSettings.addEventListener('click', () => {
    const newApis = SettingsManager.parseInput(parsingListInput.value);
    const newDramas = SettingsManager.parseInput(dramaListInput.value);

    // Enforce 5-site limit for Drama Mode
    if (newDramas.length > 5) {
        showToast('影视导航最多只能添加 5 个网站，请删减后再保存。', 'error');
        return;
    }

    if (SettingsManager.save(newApis, newDramas)) {
        showToast('设置已保存，正在刷新列表...', 'success');
        refreshDynamicUI();
        closeSettingsPage();
    } else {
        showToast('保存失败，请检查输入格式。', 'error');
    }
});

if (resetSettings) {
    resetSettings.addEventListener('click', async () => {
        if (await showConfirm('确定要恢复默认设置吗？所有自定义列表将被清除。')) {
            SettingsManager.reset();
            refreshDynamicUI();
            parsingListInput.value = SettingsManager.formatForInput(apiList);
            dramaListInput.value = SettingsManager.formatForInput(dramaSites);
            showToast('已恢复默认设置', 'info');
        }
    });
}

function refreshDynamicUI() {
    // Clear and re-populate selects - 按分辨率分组填充
    [apiSelect, quickApiSelect].forEach(sel => {
        sel.innerHTML = '';
        // 按分辨率分组添加接口
        const activeApis = apiList.filter(api => api.status !== 'deprecated');
        RESOLUTION_GROUPS.forEach(group => {
            const groupApis = activeApis.filter(api => (api.resolution || 'unknown') === group.key);
            if (groupApis.length === 0) return;
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;
            groupApis.forEach(api => {
                const option = document.createElement('option');
                option.value = api.value;
                const statusTag = api.status === 'deprecated' ? ' [已弃用]' : '';
                option.textContent = api.label + statusTag;
                optgroup.appendChild(option);
            });
            sel.appendChild(optgroup);
        });
        // 如果分组为空，回退到平铺
        if (sel.options.length === 0) {
            populateSelect(sel, activeApis);
        }
    });

    quickDramaSelect.innerHTML = '';
    populateSelect(quickDramaSelect, dramaSites);

    // Refresh sidebar drama site buttons if needed
    refreshDramaSidebar();
}

// --- 接口搜索功能 ---
// 从已知接口仓库自动搜索并获取视频解析接口
const API_SOURCE_URLS = [
    'https://raw.githubusercontent.com/RemotePinee/AudioVisual/main/api-list.json',
];

async function searchAndFetchApiList() {
    showToast('正在搜索视频解析接口...', 'info');
    const newApis = [];
    for (const sourceUrl of API_SOURCE_URLS) {
        try {
            const response = await fetch(sourceUrl);
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    data.forEach(api => {
                        if (!newApis.some(a => a.value === api.value) && !DEFAULT_API_LIST.some(a => a.value === api.value)) {
                            newApis.push({ ...api, status: 'active' });
                        }
                    });
                }
            }
        } catch (e) {
            console.log('[ApiSearch] Failed to fetch from:', sourceUrl, e);
        }
    }
    if (newApis.length > 0) {
        const mergedApis = [...DEFAULT_API_LIST, ...newApis];
        SettingsManager.save(mergedApis, dramaSites);
        refreshDynamicUI();
        showToast(`发现 ${newApis.length} 个新接口！`, 'success');
    } else {
        showToast('暂未发现新的解析接口', 'info');
    }
    return newApis;
}

// --- 失效接口检测 ---
// 通过尝试加载解析接口页面来检测是否可用
async function checkApiAvailability(apiUrl) {
    try {
        const testUrl = apiUrl + 'https://www.iqiyi.com/v_test.html'; // 构造测试URL
        const request = await fetch(testUrl, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: AbortSignal.timeout(5000)
        });
        return true; // no-cors 模式下只要不抛异常就认为可达
    } catch (e) {
        return false;
    }
}

async function checkAllApiAvailability() {
    showToast('正在检测接口可用性...', 'info');
    let deprecatedCount = 0;
    const updatedApis = apiList.map(api => {
        // 标记为已弃用的接口不重复检测
        if (api.status === 'deprecated') return api;
        return { ...api, status: 'active' };
    });

    for (let i = 0; i < updatedApis.length; i++) {
        const api = updatedApis[i];
        try {
            const response = await fetch(api.value, {
                method: 'HEAD',
                mode: 'no-cors',
                signal: AbortSignal.timeout(5000)
            });
            // no-cors 模式下 response.type 是 'opaque'，只要没抛异常就算可达
        } catch (e) {
            // 超时或网络错误说明接口可能失效
            updatedApis[i].status = 'deprecated';
            deprecatedCount++;
        }
    }

    if (deprecatedCount > 0) {
        SettingsManager.save(updatedApis, dramaSites);
        refreshDynamicUI();
        showToast(`检测完成：${deprecatedCount} 个接口已标记为失效`, 'error');
    } else {
        showToast('所有接口均可正常使用', 'success');
    }
}

function refreshDramaSidebar() {
    const dramaControls = document.querySelector('.drama-controls');
    // Keep internal buttons by regenerating them
    dramaControls.innerHTML = dramaSites.map(site => `
        <div class="control-group">
            <button class="action-button custom-drama-btn" data-url="${site.value}">
                <div class="button-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
                    </svg>
                </div>
                <div class="button-text">${site.label}</div>
            </button>
        </div>
    `).join('');

    // Re-attach listeners to new buttons
    dramaControls.querySelectorAll('.custom-drama-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = btn.dataset.url;
            console.log('[Renderer] Drama button clicked! URL:', url);
            // 临时诊断：确认点击事件能到达这里
            btn.style.outline = '3px solid red';
            setTimeout(() => { btn.style.outline = ''; }, 500);
            navigateTo(url);
        });
    });
}


// Drama buttons are now dynamically generated in refreshDramaSidebar()



document.addEventListener('DOMContentLoaded', () => {
    console.log('[Renderer] DOMContentLoaded fired.');
    console.log('[Renderer] platformSelect found:', !!platformSelect);
    console.log('[Renderer] dramaModeButton found:', !!dramaModeButton);
    console.log('[Renderer] parseButton found:', !!parseButton);
    // 立即淡入页面，不等 window.load 事件（图片加载慢会导致长时间空白）
    const container = document.querySelector('.container');
    if (container) container.classList.add('loaded');
    
    const externalLink = document.querySelector('.footer a');
    if (externalLink) {
        externalLink.addEventListener('click', (event) => {
            event.preventDefault();
            window.voidAPI.openExternalLink(event.currentTarget.href);
        });
    }

    const checkUpdateButton = document.getElementById('check-update-button');
    const updateNotificationArea = document.getElementById('update-notification-area');
    let currentNotificationTimeout = null;

    function showUpdateNotification(message, type = 'info', persistent = false) {
        if (currentNotificationTimeout) {
            clearTimeout(currentNotificationTimeout);
            currentNotificationTimeout = null;
        }

        updateNotificationArea.innerHTML = `<div style="padding: 8px; border-radius: 4px; font-size: 12px; text-align: center; background: ${type === 'error' ? '#ff6768' : type === 'success' ? 'var(--highlight-color)' : 'var(--accent-color)'}; color: ${type === 'success' ? 'var(--primary-bg)' : 'white'}; word-wrap: break-word; line-height: 1.3;">${message}</div>`;

        if (!persistent && type !== 'success' && type !== 'available') {
            currentNotificationTimeout = setTimeout(() => {
                updateNotificationArea.innerHTML = '';
                currentNotificationTimeout = null;
            }, 8000);
        }
    }

    checkUpdateButton.addEventListener('click', () => {
        checkUpdateButton.disabled = true;
        checkUpdateButton.textContent = '检查中...';
        window.voidAPI.checkForUpdates();
    });

    // 新增：处理开始检查更新的事件
    window.voidAPI.onUpdateChecking(() => {
        console.log('[Renderer] Checking for updates...');
        showUpdateNotification("正在检查更新...", 'info', true);
    });

    window.voidAPI.onUpdateAvailable((info) => {
        console.log('[Renderer] Update available:', info.version);
        checkUpdateButton.disabled = false;
        checkUpdateButton.textContent = '检查更新';
        showUpdateNotification(`🎉 发现新版本 ${info.version}！点击此处开始下载。`, 'available', true);
        const notificationDiv = updateNotificationArea.querySelector('div');
        notificationDiv.style.cursor = 'pointer';
        notificationDiv.onclick = function () {
            showUpdateNotification("⏬ 正在下载更新...", 'info', true);
            window.voidAPI.downloadUpdate();
            const newDiv = updateNotificationArea.querySelector('div');
            if (newDiv) {
                newDiv.onclick = null;
                newDiv.style.cursor = 'default';
            }
        };
    });

    window.voidAPI.onUpdateNotAvailable(() => {
        console.log('[Renderer] Already on latest version');
        checkUpdateButton.disabled = false;
        checkUpdateButton.textContent = '检查更新';
        showUpdateNotification("✅ 已是最新版本", 'success', false);
    });

    window.voidAPI.onUpdateDownloadProgress((progressObj) => {
        const percent = Math.floor(progressObj.percent);
        const downloaded = Math.floor(progressObj.transferred / 1024 / 1024);
        const total = Math.floor(progressObj.total / 1024 / 1024);
        checkUpdateButton.textContent = `下载中 ${percent}%`;
        showUpdateNotification(`⏬ 下载进度: ${percent}% (${downloaded}MB / ${total}MB)`, 'info', true);
    });

    window.voidAPI.onUpdateDownloaded(() => {
        console.log('[Renderer] Update downloaded');
        checkUpdateButton.disabled = false;
        checkUpdateButton.textContent = '检查更新';
        showUpdateNotification("✅ 更新已下载完成！点击此处重启以应用。", 'success', true);
        const notificationDiv = updateNotificationArea.querySelector('div');
        notificationDiv.style.cursor = 'pointer';
        notificationDiv.onclick = function () {
            window.voidAPI.quitAndInstall();
        };
    });

    window.voidAPI.onUpdateError((err) => {
        console.error('[Renderer] Update error:', err);
        checkUpdateButton.disabled = false;
        checkUpdateButton.textContent = '检查更新';
        
        // 提供更友好的错误信息
        let errorMsg = '更新检查失败';
        if (err && err.message) {
            if (err.code === 'TIMEOUT') {
                errorMsg = '⚠️ 检查更新超时，请检查网络连接后重试';
            } else if (err.message.includes('ENOTFOUND') || err.message.includes('ETIMEDOUT')) {
                errorMsg = '⚠️ 网络连接失败，请检查网络后重试';
            } else if (err.message.includes('404')) {
                errorMsg = '⚠️ 未找到更新文件，请稍后重试';
            } else {
                errorMsg = `⚠️ ${err.message}`;
            }
        }
        showUpdateNotification(errorMsg, 'error', false);
        // 仅网络/超时错误时弹出镜像选择对话框（让用户选择其他节点重试）
        if (err && err.message && (
            err.message.includes('ENOTFOUND') ||
            err.message.includes('ETIMEDOUT') ||
            err.message.includes('ECONNREFUSED') ||
            err.message.includes('ECONNRESET') ||
            err.message.includes('TIMEOUT') ||
            err.message.includes('net::ERR_') ||
            (err.code && ['ENOTFOUND','ETIMEDOUT','ECONNREFUSED','ECONNRESET','TIMEOUT'].includes(err.code))
        )) {
            setTimeout(() => showMirrorDialog(), 800);
        }
    });

    // 处理开发模式提示
    window.voidAPI.onUpdateDevMode((info) => {
        console.log('[Renderer] Update check in dev mode:', info);
        checkUpdateButton.disabled = false;
        checkUpdateButton.textContent = '检查更新';
        showUpdateNotification(`ℹ️ ${info.message}\n当前版本：v${info.version}`, 'info', false);
    });

    // --- Sidebar Auto-Scaling Logic ---
    const sidebar = document.querySelector('.sidebar');
    const sidebarScaler = document.querySelector('.sidebar-scaler');

    if (sidebar && sidebarScaler) {
        const updateSidebarScale = () => {
            const idealHeight = sidebarScaler.scrollHeight;
            const availableHeight = sidebar.clientHeight;

            const verticalPadding = parseFloat(getComputedStyle(sidebarScaler).paddingTop) + parseFloat(getComputedStyle(sidebarScaler).paddingBottom);
            const effectiveAvailableHeight = availableHeight - verticalPadding;

            // Add a small tolerance to prevent scaling for minor pixel differences
            if (idealHeight > effectiveAvailableHeight + 2) {
                const scale = effectiveAvailableHeight / idealHeight;
                sidebarScaler.style.transform = `scale(${scale})`;
            } else {
                sidebarScaler.style.transform = 'scale(1)';
            }
        };

        const resizeObserver = new ResizeObserver(updateSidebarScale);
        resizeObserver.observe(sidebar);

        const mutationObserver = new MutationObserver(updateSidebarScale);
        mutationObserver.observe(sidebarScaler, { childList: true, subtree: true, attributes: true });

        setTimeout(updateSidebarScale, 100);
    }

    // === 镜像选择对话框逻辑 ===
    const mirrorDialog = document.getElementById('mirror-dialog');
    const mirrorList = document.getElementById('mirror-list');
    const mirrorCustom = document.getElementById('mirror-custom');
    const mirrorCustomUrl = document.getElementById('mirror-custom-url');
    const mirrorCancel = document.getElementById('mirror-cancel');
    const mirrorConfirm = document.getElementById('mirror-confirm');
    const manualUpdateDialog = document.getElementById('manual-update-dialog');
    const manualUpdateTitle = document.getElementById('manual-update-title');
    const manualUpdateFilename = document.getElementById('manual-update-filename');
    const manualUpdateProgressBar = document.getElementById('manual-update-progress-bar');
    const manualUpdateProgressText = document.getElementById('manual-update-progress-text');
    const manualUpdateCancel = document.getElementById('manual-update-cancel');

    const MIRROR_NODES = [
        { id: 'github', name: '官方源 (GitHub)', desc: '官方源，需网络连通 GitHub', type: 'github' },
        { id: 'gitcode', name: 'GitCode 镜像', desc: '国内节点，速度较快', type: 'generic', url: 'https://gitcode.com/qwerwhr/AudioVisual-releases/raw/main/' },
        { id: 'custom', name: '自定义镜像', desc: '输入自定义镜像地址', type: 'custom' }
    ];

    let selectedMirrorId = 'github';
    let manualUpdateCanceled = false;

    function renderMirrorList() {
        mirrorList.innerHTML = '';
        MIRROR_NODES.forEach(node => {
            const item = document.createElement('div');
            item.className = 'mirror-item' + (selectedMirrorId === node.id ? ' selected' : '');
            item.dataset.id = node.id;
            item.innerHTML = `
                <div class="mirror-item-radio"></div>
                <div class="mirror-item-info">
                    <div class="mirror-item-name">${node.name}</div>
                    <div class="mirror-item-desc">${node.desc}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                selectedMirrorId = node.id;
                renderMirrorList();
                if (node.id === 'custom') {
                    mirrorCustom.style.display = 'block';
                } else {
                    mirrorCustom.style.display = 'none';
                }
            });
            mirrorList.appendChild(item);
        });
    }

    function showMirrorDialog() {
        selectedMirrorId = 'github';
        renderMirrorList();
        mirrorCustom.style.display = 'none';
        mirrorCustomUrl.value = '';
        // 临时隐藏 BrowserView，让对话框可见
        if (window.voidAPI.hideBrowserView) window.voidAPI.hideBrowserView();
        mirrorDialog.style.display = 'flex';
    }

    function hideMirrorDialog() {
        mirrorDialog.style.display = 'none';
        // 恢复 BrowserView
        if (window.voidAPI.showBrowserView) window.voidAPI.showBrowserView();
    }

    mirrorCancel.addEventListener('click', hideMirrorDialog);

    mirrorConfirm.addEventListener('click', () => {
        const selectedNode = MIRROR_NODES.find(n => n.id === selectedMirrorId);
        if (!selectedNode) return;

        let mirrorConfig = { type: selectedNode.type };
        if (selectedNode.type === 'github') {
            mirrorConfig.owner = 'qwerwhr';
            mirrorConfig.repo = 'AudioVisual';
        } else if (selectedNode.type === 'generic') {
            mirrorConfig.url = selectedNode.url;
        } else if (selectedNode.type === 'custom') {
            const url = mirrorCustomUrl.value.trim();
            if (!url) {
                alert('请输入自定义镜像地址');
                return;
            }
            mirrorConfig.url = url;
        }

        hideMirrorDialog();
        showUpdateNotification('⏳ 正在使用选定节点检查更新...', 'info', true);
        checkUpdateButton.disabled = true;
        checkUpdateButton.textContent = '检查中...';

        window.voidAPI.setUpdateMirror(mirrorConfig).then(() => {
            window.voidAPI.checkForUpdates();
        }).catch(err => {
            console.error('[Renderer] Set mirror failed:', err);
            checkUpdateButton.disabled = false;
            checkUpdateButton.textContent = '检查更新';
            showUpdateNotification('⚠️ 设置镜像失败：' + (err.message || err), 'error', false);
        });
    });

    // 监听主进程发来的更新超时事件，自动弹出镜像选择对话框
    window.voidAPI.onUpdateTimeout(() => {
        showMirrorDialog();
    });

    // 监听手动更新下载进度
    window.voidAPI.onManualUpdateProgress((progress) => {
        if (!manualUpdateDialog || !manualUpdateProgressBar || !manualUpdateProgressText) return;
        manualUpdateDialog.style.display = 'flex';
        const percent = Math.floor(progress.percent || 0);
        manualUpdateProgressBar.style.width = percent + '%';
        const downloaded = (progress.transferred || progress.transferred || 0) / 1024 / 1024;
        const total = (progress.total || 0) / 1024 / 1024;
        manualUpdateProgressText.textContent = `${percent}% (${downloaded.toFixed(1)}MB / ${total.toFixed(1)}MB)`;
    });

    // 监听手动更新下载完成
    window.voidAPI.onManualUpdateDownloaded((info) => {
        if (!manualUpdateDialog || !manualUpdateTitle || !manualUpdateProgressText || !manualUpdateCancel) return;
        manualUpdateTitle.textContent = '更新已下载完成';
        manualUpdateProgressText.textContent = '点击"立即安装"按钮重启应用以应用更新';
        manualUpdateCancel.textContent = '立即安装';
        manualUpdateCancel.onclick = () => {
            window.voidAPI.quitAndInstall();
        };
    });

    manualUpdateCancel.addEventListener('click', () => {
        manualUpdateCanceled = true;
        if (manualUpdateDialog) manualUpdateDialog.style.display = 'none';
    });
});

initialize();
