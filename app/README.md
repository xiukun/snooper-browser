# snooper app

Vue 3 + Vite 前端。产品说明、功能列表与配置指引见仓库根目录的 [README](../README.md)。

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # 产物在 dist/
pnpm preview
pnpm exec vue-tsc -b --force   # 类型检查
```

## 关键目录

| 路径 | 职责 |
| --- | --- |
| `src/lib/providers.ts` | `ProviderProfile[]` + 三条能力路由、默认值、迁移、`resolveRoute` |
| `src/lib/moss.ts` | `/chat/completions`、`/audio/transcriptions`、`/models` 客户端与流式降级 |
| `src/composables/useSettings.ts` | 服务商 CRUD、`/models` 同步、路由派生、防抖持久化 |
| `src/composables/useRealtime.ts` | 采集 → 6 秒分段 → 转写 → 翻译 → 字幕 |
| `src/views/` | 实时互译 / 智能对话 / 图像理解 / 能力设置 |

配置只写入浏览器 `localStorage`（键 `snooper.provider-config.v1`）。`VITE_MOSS_API_KEY` 与 `VITE_MOSS_BASE_URL` 仅用于本地开发预填，`.env.local` 已被忽略，切勿提交真实密钥。
