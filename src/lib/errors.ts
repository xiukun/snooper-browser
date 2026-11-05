import { MossError } from './moss'

export function friendlyError(err: unknown): string {
  if (err instanceof MossError) {
    const raw = err.message.toLowerCase()
    if (raw.includes('unauthorized') || err.status === 401) {
      return 'API Key 无权访问该模型，请在「设置」中检查 Key 与模型权限。'
    }
    if (raw.includes('rate limit') || err.status === 429) {
      return '请求过于频繁，已触发限流，请稍后重试。'
    }
    if (raw.includes('image')) {
      return `图片处理失败：${err.message}`
    }
    if (raw.includes('file') && raw.includes('required')) {
      return '音频片段为空，请重新采集后再试。'
    }
    return err.message
  }
  if (err instanceof TypeError) {
    return '网络请求失败，请检查网络或 Base URL 配置。'
  }
  return err instanceof Error ? err.message : '未知错误'
}
