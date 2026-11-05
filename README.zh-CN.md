# snooper

**看得见，译得出，读得懂。**

[![License: MIT](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-3ee6d5.svg)](https://vuejs.org)
[![Vite](https://img.shields.io/badge/Vite-8-9c85ff.svg)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-7ef2e4.svg)](https://tailwindcss.com)

[English](./README.md) · 简体中文

snooper 是一个完全运行在浏览器里的开源多模态工作台。抓取标签页或麦克风的音频做实时双语字幕，向视觉模型提问屏幕上的内容，并把每种能力分别指向你信任的服务商。没有后端，不内置密钥，不做遥测。

## 功能特性

### 实时互译

- 两种音频来源：麦克风，或通过 `getDisplayMedia({ audio: true })` 捕获标签页声音。
- 原视频**不会被静音**，字幕与画面同时存在。
- 6 秒分段 → 语音转写 → 结合上下文翻译 → 字幕逐句出现。
- 十种语言对（中 / 英 / 日 / 韩 / 法 / 德 / 西 / 俄 / 阿 / 葡），切换后下一条生效。
- 内置演示信号，没有任何 Key 也能完整预览字幕动效。

### 智能对话

- 多模态输入：文字、图片、代码可以放进同一个对话。
- Markdown 渲染 + Shiki 代码高亮，流式输出可随时停止。
- 历史被压缩成单条 user 消息，这正是单轮模型所要求的形态。
- 拖拽、粘贴、文件选择三种附图方式。

### 图像理解

- 单次最多 10 张图，单图上限 20 MB，上传前在浏览器内压缩。
- 六种预设：全面描述、文字提取、图表解读、代码识别、图文翻译、商品分析。
- 结果为 Markdown，保留运行历史，支持原图灯箱查看。

### 服务商管理

- **多家服务商并存**：官方网关、第三方中转、自建端点，各自独立保存地址与密钥。
- **三条能力独立路由**：`LLM`（对话 / 视觉 / 翻译）、`音频`（ASR）、`视频`（低延迟画面理解）可以分别指向不同服务商与模型。
- **模型发现**：调用 `GET /models`，按服务商缓存，并记录状态与原始错误信息。
- 任何 OpenAI 兼容中转都可用；MOSS 协议内置支持。
- 配置与密钥只保存在 `localStorage`。

## 快速开始

```bash
cd app
pnpm install
cp .env.example .env.local   # 可选——应用内也能完成配置
pnpm dev                     # http://localhost:5173
```

生产构建：

```bash
pnpm build
pnpm preview
```

### 环境变量

| 变量 | 必填 | 用途 |
| --- | --- | --- |
| `VITE_MOSS_API_KEY` | 否 | 首次启动时预填默认服务商的密钥 |
| `VITE_MOSS_BASE_URL` | 否 | 默认服务商的地址，默认 `https://api.mosi.cn/v1` |

两者都只是**开发期便利**。日常使用在应用内添加服务商即可，切换服务商不需要重新构建。`.env.local` 已被忽略，切勿提交真实密钥。

## 配置模型

1. 打开**能力设置 → 服务商**，填写名称、Base URL、API Key，并选择协议（`MOSS 原生` 或 `OpenAI 兼容`）。
2. 点击**拉取模型**，调用 `GET {baseUrl}/models`。结果按服务商缓存；失败时原始错误会显示在该服务商卡片上。
3. 在**能力路由**中为 **LLM / 音频 / 视频** 分别选择服务商与模型。模型输入框会从已拉取列表补全，也允许手填——很多中转并不实现 `/models`。
4. 对话、图像理解、字幕翻译共用 `LLM` 路由；字幕的听写部分走 `音频` 路由。

> 密钥写入 `localStorage`，请求从浏览器直连你配置的服务商。若公开部署且需要隐藏密钥，请自行加一层代理。

## 技术栈

| 层 | 选择 | 为什么不是另一种 |
| --- | --- | --- |
| 框架 | Vue 3.5（`<script setup lang="ts">`） | 每种能力一个响应式单例，没有路由、没有 SSR——单页工具不需要元框架。 |
| 构建 | Vite 8 | 原生 ESM 开发服务器；构建期插件只有 Vue 一个。 |
| 语言 | TypeScript 6，`strict` + `noUnusedLocals` | 配置与路由层最容易出现「改了字段名漏改调用点」，类型系统能整类拦下。 |
| 样式 | Tailwind CSS 4（设计 token 写在 `main.css`） | token 本身就是设计系统，不必和组件库的默认样式对抗。 |
| 图标 | `@lucide/vue` | 按需引入，线条粗细统一。 |
| Markdown | `markdown-it` + Shiki | Shiki 使用 TextMate 语法，对话里的代码块接近编辑器效果，而不是朴素 `<pre>`；进入 Markdown 视图时才惰性加载，仅预置五门核心语言。 |
| 提示 | `vue-sonner` | 两行接入，默认即可访问。 |

### 版本策略

- 依赖跟随最新版本，**但有一个刻意例外**：TypeScript 锁在最新 6.x。`vue-tsc` 3.3.x 会解析 `typescript/lib/tsc`，而 TypeScript 7 已不再导出该子路径——用 TS 7 运行 `vue-tsc` 会直接报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。等 `vue-tsc` 支持 TS 7 后再放开。
- `@types/node` 跟随构建所用的 Node 主版本（当前 22），而不是无条件追最新。
- `lucide-vue-next` 在上游被标记弃用后，已替换为 `@lucide/vue`。
- 依赖更新由 Dependabot 每周发起，主版本升级一律人工审查。验收命令始终是同一条：`pnpm exec vue-tsc -b --force && pnpm build`。

## 项目结构

```
app/
├── index.html
├── public/favicon.svg
└── src/
    ├── assets/main.css        # 设计 token、玻璃拟态、Markdown 排版
    ├── components/            # 品牌标记、布局壳、表单基础件
    ├── composables/
    │   ├── useRealtime.ts     # 采集 → 分段 → 转写 → 翻译 → 字幕
    │   ├── useChat.ts         # 对话流与附件
    │   ├── useVision.ts       # 图像分析
    │   ├── useSettings.ts     # 服务商 CRUD、路由、/models 同步
    │   └── useNavigation.ts
    ├── lib/
    │   ├── providers.ts       # 配置模型、默认值、迁移、resolveRoute
    │   ├── moss.ts            # OpenAI 兼容客户端：流式降级、ASR、视觉
    │   ├── models.ts          # 消息类型、模型目录、语言表
    │   ├── markdown.ts        # Shiki 高亮
    │   ├── navigation.ts      # 视图与快捷键
    │   └── brand.ts           # 品牌与存储键
    └── views/                 # 实时互译 / 智能对话 / 图像理解 / 能力设置
```

## 浏览器支持

- 标签页音频与屏幕捕获需要 Chrome / Edge 116+。
- 麦克风采集需要 `getUserMedia` 授权；标签页音频需要用户显式共享。
- Safari 与 Firefox 可运行对话与图像理解，音频采集能力有限。

## 隐私

- 无后端、无统计、无账号体系。
- 音频以 6 秒片段发送给 `音频` 路由背后的服务商；图片以 base64 发送给 `LLM` 路由背后的服务商。
- 服务商地址、密钥与模型选择只留在浏览器。威胁模型见 [SECURITY.md](./SECURITY.md)。

## 参与贡献

提交 PR 前请先读 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告，不要开公开 issue。

## 开源协议

[MIT](./LICENSE) © 2026 snooper-browser contributors
