import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { analyzeImages, fileToDataUrl } from '@lib/moss'
import { resolveRoute } from '@lib/providers'
import { friendlyError } from '@lib/errors'
import { uid } from '@lib/utils'
import { useSettings } from './useSettings'

export interface VisionImage {
  id: string
  name: string
  size: number
  dataUrl: string
}

export interface VisionRun {
  id: string
  prompt: string
  content: string
  images: string[]
  model: string
  createdAt: number
  status: 'streaming' | 'done' | 'error'
}

export interface VisionPreset {
  id: string
  label: string
  hint: string
  prompt: string
}

export const VISION_PRESETS: VisionPreset[] = [
  {
    id: 'describe',
    label: '全面描述',
    hint: '主体 / 场景 / 细节',
    prompt:
      '请详细分析这张图片：先说明整体场景，再描述主体、环境、构图与关键细节。使用简体中文，分点输出。',
  },
  {
    id: 'ocr',
    label: '文字提取',
    hint: 'OCR 与排版还原',
    prompt:
      '提取图片中的所有文字，按原始阅读顺序与排版输出。如果有表格，请用 Markdown 表格还原；如果是截图，请保留标题层级。',
  },
  {
    id: 'chart',
    label: '图表解读',
    hint: '趋势 / 结论 / 异常',
    prompt:
      '这是一张图表。请说明图表类型、横纵轴含义、关键数据点与整体趋势，指出异常值与可行动结论。使用简体中文。',
  },
  {
    id: 'code',
    label: '代码识别',
    hint: '还原可运行代码',
    prompt:
      '识别图片中的代码截图，判断语言，并还原为可运行的代码块。保留缩进与注释，最后用一句话说明代码用途。',
  },
  {
    id: 'translate',
    label: '翻译图中文字',
    hint: '识别并译为中文',
    prompt:
      '识别图片中的全部文字，并翻译为简体中文。先输出原文，再输出译文，保持段落对应关系。',
  },
  {
    id: 'product',
    label: '商品分析',
    hint: '卖点 / 受众 / 建议',
    prompt:
      '分析图片中的商品：品类、材质、设计卖点、目标人群与可能的营销文案。使用简体中文，结构清晰。',
  },
]

const images = ref<VisionImage[]>([])
const runs = ref<VisionRun[]>([])
const isAnalyzing = ref(false)
const error = ref('')
let controller: AbortController | null = null

async function addFiles(files: File[] | FileList) {
  const list = Array.from(files).filter((file) => file.type.startsWith('image/'))
  if (!list.length) {
    toast.error('请选择图片文件（PNG / JPEG / WebP）')
    return
  }
  const remaining = 10 - images.value.length
  if (remaining <= 0) {
    toast.error('单次最多上传 10 张图片')
    return
  }

  for (const file of list.slice(0, remaining)) {
    if (file.size > 20 * 1024 * 1024) {
      toast.error(`${file.name} 超过 20MB，已跳过`)
      continue
    }
    try {
      const dataUrl = await fileToDataUrl(file)
      images.value.push({ id: uid('img'), name: file.name, size: file.size, dataUrl })
    } catch {
      toast.error(`${file.name} 读取失败`)
    }
  }
}

function removeImage(id: string) {
  images.value = images.value.filter((image) => image.id !== id)
}

function clearImages() {
  images.value = []
}

async function analyze(prompt: string) {
  if (isAnalyzing.value) return
  if (!images.value.length) {
    toast.error('请先上传至少一张图片')
    return
  }
  const { settings } = useSettings()
  const model = (() => {
    try {
      return resolveRoute(settings, 'llm').model
    } catch {
      return settings.routes.llm.model || '未配置模型'
    }
  })()
  const run: VisionRun = {
    id: uid('run'),
    prompt,
    content: '',
    images: images.value.map((image) => image.dataUrl),
    model,
    createdAt: Date.now(),
    status: 'streaming',
  }
  runs.value.unshift(run)
  isAnalyzing.value = true
  error.value = ''
  controller = new AbortController()

  try {
    const result = await analyzeImages({
      images: run.images,
      prompt,
      config: settings,
      capability: 'llm',
      signal: controller.signal,
      maxTokens: 2048,
      onDelta: (_chunk, full) => {
        run.content = full
      },
    })
    run.content = result
    run.status = 'done'
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    if (aborted) {
      run.status = 'done'
      if (!run.content) run.content = '（已停止分析）'
    } else {
      const message = friendlyError(err)
      run.status = 'error'
      run.content = message
      error.value = message
      toast.error(message)
    }
  } finally {
    isAnalyzing.value = false
    controller = null
  }
}

function stop() {
  controller?.abort()
}

function injectImageDataUrl(dataUrl: string, name = '截图帧.jpg') {
  if (!dataUrl) return
  const image: VisionImage = { id: uid('img'), name, size: 0, dataUrl }
  images.value.push(image)
  toast.success('已注入图像视图')
}

function clearHistory() {
  stop()
  runs.value = []
  error.value = ''
}

const activeRun = computed(() => runs.value[0] ?? null)

export function useVision() {
  return {
    images,
    runs,
    activeRun,
    isAnalyzing,
    error,
    presets: VISION_PRESETS,
    addFiles,
    removeImage,
    clearImages,
    analyze,
    stop,
    clearHistory,
    injectImageDataUrl,
  }
}
