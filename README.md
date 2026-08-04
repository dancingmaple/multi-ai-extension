# Multi AI Web Automation

一个 Chrome / Edge 浏览器插件（Manifest V3），让你在侧边栏里**一次性把同一个问题并发发送给多个 AI 网页**，并在同一个界面里并排查看、对比各家回答。

支持 7 个 AI 平台：**ChatGPT、Gemini、DeepSeek、通义千问 (Qwen)、智谱清言 (Z.AI)、豆包 (Doubao)、Kimi**。

---

## 功能特性

- **一键群发**：在侧边栏输入一个问题，勾选目标平台，并发发送到所有已打开 / 自动打开的 AI 网页。
- **网页视图嵌入**：把各 AI 网页以 `iframe` 形式直接嵌在插件里（通过 DNR 规则剥离 `X-Frame-Options` / `Content-Security-Policy` 实现嵌套），无需在多个标签页之间来回切换。
- **流式采集**：实时监听每个网页的回答流式更新，按平台分栏展示。
- **多轮会话**：支持多轮对话，按「会话 / 轮次」组织，可回看历史上下文。
- **历史记录**：自动保存每次会话，支持**关键词搜索**、**标签筛选 / 增删**、**一键导出 Markdown**。
- **原网页链接还原**：导出内容会附带每一家 AI 当时的原始网页链接；切换历史记录 / 会话 / 轮次时，网页视图会自动跳回当时保存的地址。
- **手动获取**：每个 AI 页签提供「大屏 / 阅读 / 手动获取」；右上角提供「📥 一键全部手动获取」按钮，应对流式抓取失败时的兜底补录。
- **主题切换**：网页风格支持浅色 / 深色 / 跟随系统。
- **大弹窗阅读器**：单家回答可点开大屏弹窗阅读、复制。
- **Kimi 兼容**：针对 Kimi 只接受受信任（isTrusted）事件的特性，使用 `chrome.debugger` 派发受信任点击完成发送。

---

## 支持的 AI 平台

| 平台 | 域名 |
| --- | --- |
| ChatGPT | `chatgpt.com` |
| Gemini | `gemini.google.com` |
| DeepSeek | `chat.deepseek.com` |
| 通义千问 Qwen | `chat.qwen.ai` |
| 智谱清言 Z.AI | `chat.z.ai` |
| 豆包 Doubao | `www.doubao.com` |
| Kimi | `kimi.moonshot.cn` |

> 使用前请先在对应网页**登录**你的账号；未登录时插件会提示 `login_required`。

---

## 架构

插件采用分层架构：

```
Side Panel UI (React + Zustand)
   ↓ 消息
Background Service Worker（任务调度中心）
   ↓ 消息
Content Script（注入各 AI 网页，all_frames）
   ↓ 调用
Site Adapter（每个站点的自动化逻辑：定位输入框 / 填值 / 点击发送 / 监听回答）
```

此外，网页视图（iframe 嵌入）通过 `postMessage` 跨域通信协议（`EMBED_MSG`）在插件父页与 iframe 内的 content script 之间桥接：
父页请求执行 / 抓取 → iframe 内就地读屏 → 回传结果。

---

## 安装与构建

> 要求 Node.js 18+，推荐使用 pnpm。

```bash
# 安装依赖
pnpm install

# 构建（类型检查 + 打包到 dist/）
pnpm build

# 开发模式（带 HMR）
pnpm dev
```

构建产物输出到 `dist/` 目录。

---

## 加载扩展到浏览器

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 右上角开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目的 `dist/` 目录。
4. 点击浏览器工具栏的扩展图标即可打开侧边栏；也可右键图标选择「打开侧边栏」。

> 修改代码后重新 `pnpm build`，回到扩展管理页点击「刷新」即可生效。
> 由于 Kimi 发送依赖 `chrome.debugger`，加载后首次在 Kimi 上发送可能会出现浏览器顶部的「已开启调试」横幅，属正常现象。

---

## 使用说明

1. 在侧边栏输入问题，勾选要发送的平台。
2. 点击「发送」，插件会并发打开 / 复用对应网页并自动填写、发送。
3. 在网页视图或分栏中实时查看各家回答；可切换「大屏 / 阅读」模式。
4. 流式抓取异常时，用「手动获取」或右上角「一键全部手动获取」兜底。
5. 在历史栏中搜索、打标签、导出 Markdown（含各平台原网页链接）。

---

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `tabs` / `webNavigation` | 查找、创建、复用各 AI 网页标签页并等待加载 |
| `storage` | 保存最近任务、历史会话、设置 |
| `scripting` | 向目标网页注入 / 执行脚本 |
| `sidePanel` | 提供侧边栏主界面 |
| `alarms` | 定时任务兜底（如抓取超时） |
| `downloads` | 导出 Markdown 文件下载到本地 |
| `debugger` | Kimi 发送所需的受信任点击（仅在该平台发送时使用） |
| `declarativeNetRequestWithHostAccess` | 剥离 `X-Frame-Options` / CSP，使 AI 网页可被 iframe 嵌套 |

---

## 项目结构

```
multi-ai-extension/
├─ public/                  # 静态资源（图标、sidepanel.html）
├─ src/
│  ├─ background/           # Service Worker：调度、标签页管理、消息路由、历史存储、debugger 受信任点击、DNR
│  ├─ content/
│  │  ├─ adapters/          # 各站点适配器（chatgpt/gemini/deepseek/qwen/zai/doubao/kimi）
│  │  ├─ dom/              # DOM 观察工具
│  │  └─ index.ts          # content script 入口
│  ├─ sidepanel/           # 侧边栏 UI（React + Zustand）+ 网页视图 WebView
│  └─ shared/              # 类型、常量、消息协议、导出、工具
├─ manifest.ts              # MV3 清单
├─ vite.config.ts
└─ package.json
```

---

## 已知限制

- 依赖各 AI 网页的 DOM 结构，站点改版可能导致选择器失效，需要更新对应适配器。
- Kimi 发送使用 `chrome.debugger`，可能触发浏览器调试横幅。
- 本插件通过网页自动化操作，不使用任何官方 API；请遵守各平台服务条款。

---

## License

MIT
