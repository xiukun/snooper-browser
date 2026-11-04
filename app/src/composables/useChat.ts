import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { MossMessage } from '@/lib/models'
import { fileToDataUrl, streamChat } from '@/lib/moss'
import { resolveRoute } from '@/lib/providers'
import { friendlyError } from '@/lib/errors'
import { uid } from '@/lib/utils'
import { useSettings } from './useSettings'

export interface ChatAttachment {
  id: string
  name: string
  size: number
  type: string
  dataUrl: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  model?: string
  attachments?: ChatAttachment[]
  status: 'done' | 'streaming' | 'error'
}

const messages = ref<ChatMessage[]>([])
const attachments = ref<ChatAttachment[]>([])
const isStreaming = ref(false)
const error = ref('')
let controller: AbortController | null = null
let stopRequested = false

function toMossMessages(history: ChatMessage[]): MossMessage[] {
  return history.map((message) => {
    if (message.attachments?.length) {
      return {
        role: message.role,
        content: [
          { type: 'text' as const, text: message.content || '请分析这些图片。' },
          ...message.attachments.map((attachment) => ({
            type: 'image_url' as const,
            image_url: { url: attachment.dataUrl },
          })),
        ],
      }
    }
    return { role: message.role, content: message.content }
  })
}

async function addFiles(files: File[] | FileList) {
  const list = Array.from(files).filter((file) => file.type.startsWith('image/'))
  if (!list.length) {
    toast.error('请选择图片文件（PNG / JPEG / WebP）')
    return
  }
  const remaining = 8 - attachments.value.length
  if (remaining <= 0) {
    toast.error('单次最多附加 8 张图片')
    return
  }

  for (const file of list.slice(0, remaining)) {
    if (file.size > 12 * 1024 * 1024) {
      toast.error(`${file.name} 超过 12MB，已跳过`)
      continue
    }
    try {
      const dataUrl = await fileToDataUrl(file)
      attachments.value.push({
        id: uid('att'),
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl,
      })
    } catch {
      toast.error(`${file.name} 读取失败`)
    }
  }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter((attachment) => attachment.id !== id)
}

function clearAttachments() {
  attachments.value = []
}

async function send(rawText: string) {
  if (isStreaming.value) return
  const text = rawText.trim()
  const currentAttachments = [...attachments.value]
  if (!text && !currentAttachments.length) return

  const { settings } = useSettings()
  const model =
    (() => {
      try {
        return resolveRoute(settings, 'llm').model
      } catch {
        return settings.routes.llm.model || '未配置模型'
      }
    })()
  const userMessage: ChatMessage = {
    id: uid('msg'),
    role: 'user',
    content: text || '请分析这些图片。',
    createdAt: Date.now(),
    attachments: currentAttachments.length ? currentAttachments : undefined,
    status: 'done',
  }
  const assistantMessage: ChatMessage = {
    id: uid('msg'),
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    model,
    status: 'streaming',
  }

  const history = messages.value.filter((message) => message.status !== 'streaming')
  messages.value.push(userMessage, assistantMessage)
  attachments.value = []
  isStreaming.value = true
  error.value = ''
  stopRequested = false
  controller = new AbortController()

  try {
    const result = await streamChat({
      config: settings,
      capability: 'llm',
      model,
      messages: [...toMossMessages(history.slice(-12)), ...toMossMessages([userMessage])],
      signal: controller.signal,
      temperature: currentAttachments.length ? 0.25 : 0.5,
      maxTokens: 2048,
      onDelta: (_chunk, full) => {
        assistantMessage.content = full
      },
    })
    assistantMessage.content = result
    assistantMessage.status = 'done'
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    if (aborted) {
      assistantMessage.status = 'done'
      if (!assistantMessage.content) assistantMessage.content = '（已停止生成）'
      if (!stopRequested) toast.info('已停止生成')
    } else {
      const message = friendlyError(err)
      assistantMessage.status = 'error'
      assistantMessage.content = message
      error.value = message
      toast.error(message)
    }
  } finally {
    isStreaming.value = false
    controller = null
  }
}

function stop() {
  if (!controller) return
  stopRequested = true
  controller.abort()
}

function clear() {
  stop()
  messages.value = []
  attachments.value = []
  error.value = ''
}

const canSend = computed(() => !isStreaming.value)

export function useChat() {
  return {
    messages,
    attachments,
    isStreaming,
    error,
    canSend,
    addFiles,
    removeAttachment,
    clearAttachments,
    send,
    stop,
    clear,
  }
}
