# AudioVisual 项目记忆

## 项目架构
- Electron 视频播放应用，BrowserView + IPC 架构
- 主进程 `main.js`，渲染进程 `renderer.js`
- preload: `preload-ui.js`（UI层）+ `preload-web.js`（网页层）
- 视频播放使用 iframe 内嵌模式（`startInjectionGuardian`）
- **持久化存储：JSON配置文件 `userData/user-config.json`**（主进程+渲染进程共享数据源）
- localStorage 作为渲染进程本地缓存备份
- 视图池（viewPool）缓存已渲染 BrowserView

## 核心数据结构
- API 接口列表含 resolution（4K/1080P/720P）和 status（active/deprecated）字段
- 影视导航站点含可可影视（keke6.app）、网飞猫（ncat24.com）等，上限5个
- 网址自动更新：SITE_DOMAIN_MAP 存储备选域名，`checkSiteAvailability` 用 https HEAD 请求检测

## 2026-06-18 功能升级
- 优酷改为直接显示主页，绕过反爬虫（preload-web.js 注入 navigator.webdriver/languages/plugins/chrome 覆写）
- 弹幕保留：移除 bilibili-player-video-wrap 等弹幕元素的 CSS 屏蔽，iframe z-index 留出弹幕层
- 分辨率分组：接口按 4K/1080P/720P 分组显示在 optgroup 中，有分辨率筛选下拉框
- 接口搜索/检测：search-api-button（搜索新接口）、check-api-button（检测失效接口并标记 deprecated）
- 优酷和哔哩哔哩视频页面检测加入自动解析触发（main.js + preload-web.js + renderer.js）

## 2026-06-20 修复
- **网址持久化**：新增 JSON 配置文件机制解决重启后用户添加的网址丢失问题
- 主进程 preloadSites() 从 user-config.json 读取 dramaSites（不再硬编码）
- 渲染进程 SettingsManager.save() 同步写入 JSON 配置文件 + localStorage
- SettingsManager.load() 改为 async，优先从 JSON 配置文件加载
- **网飞猫域名更新**：ncat21.com → ncat24.com，SITE_DOMAIN_MAP 添加 ncat23-26 备选
