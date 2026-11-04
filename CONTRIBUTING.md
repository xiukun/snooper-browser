# 贡献指南

snooper 是一个完全运行在浏览器里的开源多模态工作台。欢迎提交 issue 与 PR。

## 环境要求

- Node.js >= 20（推荐 22）
- pnpm >= 9（仓库使用 pnpm）

## 本地启动

```bash
cd app
pnpm install
cp .env.example .env.local   # 可留空，应用内也能配置服务商
pnpm dev                     # http://localhost:5173
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动开发服务器 |
| `pnpm type-check` | `vue-tsc -b` 类型检查 |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm preview` | 预览构建产物 |

## 代码约定

- Vue 3 + `<script setup lang="ts">` + Composition API，不写 Options API。
- 复用 `src/lib/` 的纯函数与 `src/composables/` 的状态，不在组件里重复造轮子。
- 颜色/间距只使用 `src/assets/main.css` 中的设计 token（`ink-*`、`mist-*`、`iris-*`、`aqua-*`、`rose-glow`、`amber-glow`），不要写临时 hex 值。
- 网络请求统一走 `src/lib/moss.ts`，按能力（`llm` / `audio` / `video`）通过 `resolveRoute` 解析服务商，禁止在组件里读全局 Key。
- 任何密钥都不得硬编码；`localStorage` 是唯一存储位置。

## 提交规范

使用 Conventional Commits：

`feat:` / `fix:` / `refactor:` / `docs:` / `style:` / `test:` / `chore:` / `perf:`

示例：`feat(settings): pull models from /models per provider`

## PR 检查清单

- [ ] `pnpm type-check` 通过
- [ ] `pnpm build` 通过
- [ ] 390 / 768 / 1440 三个宽度下界面无溢出
- [ ] 键盘可达（Tab / Esc / 焦点环）
- [ ] 没有提交任何密钥、`.env.local` 或构建产物
- [ ] 行为变更附带必要的说明

## 关于仓库内容

`doc/` 与 `viitor_extracted/` 属于第三方调研与逆向参考材料，被 `.gitignore` 排除，不随本仓库分发。请勿将它们加入提交。
