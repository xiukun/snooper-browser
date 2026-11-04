# snooper

**See it. Translate it. Understand it.**

[![License: MIT](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-3ee6d5.svg)](https://vuejs.org)
[![Vite](https://img.shields.io/badge/Vite-8-9c85ff.svg)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-7ef2e4.svg)](https://tailwindcss.com)

snooper 是一个完全运行在浏览器里的开源多模态工作台：抓取任意标签页或麦克风的音频做**实时双语字幕**，用**对话**理解内容，用**图像理解**看清画面。没有后端，没有内置密钥，服务商由你自己接入。

## 功能特性

### 实时互译

- 麦克风与**标签页音频**双来源采集：网页视频、直播、会议都能直接听。
- 6 秒分段上行 → 语音转写（ASR）→ 结合上下文翻译，字幕按句流式出现。
- 原视频**不会被静音**，字幕与画面同时存在。
- 任意语言对（中 / 英 / 日 / 韩 / 法 / 德 / 西 / 俄 / 阿 / 葡），切换后下一条生效。
- 内置演示信号，无需 Key 即可预览完整字幕动效。

### 智能对话

- 多模态问答：文字、图片、代码一起丢进来。
- Markdown 渲染 + Shiki 代码高亮，流式输出可随时停止。
- 历史自动压缩为单轮上下文，适配只接受单条 user 消息的模型。
- 拖拽、粘贴、文件选择三种附图方式。

### 图像理解

- 上传 / 拖拽 / 粘贴截图，最多 10 张，单图 20MB。
- 6 种预设：全面描述、文字提取、图表解读、代码识别、图文翻译、商品分析。
- 结果以 Markdown 呈现，支持历史归档与图片灯箱。

### 服务商管理

- **多家服务商并存**：官方网关、第三方中转、私有化地址各自独立保存。
- **三条能力独立路由**：`LLM`（对话 / 视觉 / 翻译）、`音频`（ASR）、`视频`（实时画面）可以指向不同服务商与模型。
- 一键调用 `GET /models` **拉取模型列表**，并按服务商缓存、显示状态与错误。
- 任意 OpenAI 兼容中转可用；MOSS 原生协议内置支持。
- 所有配置与密钥仅保存在浏览器 `localStorage`。

## 快速开始

```bash
cd app
pnpm install
cp .env.example .env.local   # 可选，留空也能在应用内配置
pnpm dev                     # http://localhost:5173
```

生产构建：

```bash
pnpm build
pnpm preview
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `VITE_MOSS_API_KEY` | 否 | 首次启动时预填到默认服务商的 Key，留空则手动填写 |
| `VITE_MOSS_BASE_URL` | 否 | 默认服务商地址，默认 `https://api.mosi.cn/v1` |

两者都只是**开发期便利**：正式使用时把 Key 写进应用内设置即可，不需要重新构建。

## 配置模型

1. 打开「能力设置 → 服务商」，填写名称、Base URL、API Key，选择协议（MOSS 原生 / OpenAI 兼容）。
2. 点击「拉取模型」，调用 `GET {baseUrl}/models` 并缓存结果；失败时错误会显示在该服务商卡片下。
3. 在「能力路由」中分别为 **LLM / 音频 / 视频** 选择服务商与模型 ID。模型输入框支持下拉补全，也可以直接手填。
4. 对话、图片理解、字幕翻译共用 `LLM` 路由；字幕的听写部分走 `音频` 路由。

> 密钥只写入本机 `localStorage`，请求从浏览器直连你配置的服务商。若部署到公网并希望隐藏密钥，请自行加一层服务端代理。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Vue 3.5（`<script setup lang="ts">`） |
| 构建 | Vite 8 + TypeScript 6 |
| 样式 | Tailwind CSS v4（自定义设计 token） |
| 图标 / 反馈 | lucide-vue-next · vue-sonner |
| 渲染 | markdown-it + Shiki |
| 状态 | Composition API（模块级单例 composable） |

## 项目结构

```
app/
├── index.html
├── public/favicon.svg
└── src/
    ├── assets/main.css        # 设计 token、玻璃拟态、Markdown 排版
    ├── components/            # 品牌标记、布局壳、通用表单
    ├── composables/
    │   ├── useRealtime.ts     # 采集 → 分段 → 转写 → 翻译 → 字幕
    │   ├── useChat.ts         # 对话流与附件
    │   ├── useVision.ts       # 图像分析
    │   ├── useSettings.ts     # 服务商 CRUD、路由、/models 同步
    │   └── useNavigation.ts
    ├── lib/
    │   ├── providers.ts       # 配置模型、默认值、迁移、resolveRoute
    │   ├── moss.ts            # OpenAI 兼容客户端（流式降级、转写、视觉）
    │   ├── models.ts          # 消息类型、模型目录、语言表
    │   ├── markdown.ts        # Shiki 高亮
    │   ├── navigation.ts      # 视图与快捷键定义
    │   └── brand.ts           # 品牌与存储键
    └── views/                 # Translate / Chat / Vision / Settings
```

## 浏览器支持

- Chrome / Edge 116+（`tabCapture` 需要用户手势触发）。
- 麦克风采集需要 `getUserMedia` 权限；标签页音频需要共享授权。
- Safari / Firefox 可运行对话与图像功能，音频采集能力有限。

## 隐私

- 无后端、无遥测、无账号体系。
- 音频仅以 6 秒片段发送给你为 `音频` 路由选择的服务商；图片以 base64 发送给 `LLM` 路由的服务商。
- 服务商地址、密钥、模型选择只存在浏览器本地。

## 开源协议

[MIT](./LICENSE) © 2026 snooper-browser contributors

参与贡献请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告。
