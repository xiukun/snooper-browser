import { AudioLines, Image as ImageIcon, MessagesSquare, ScanEye, Settings2 } from '@lucide/vue'
import type { Component } from 'vue'

export interface NavItem {
  key: ViewKey
  label: string
  title: string
  subtitle: string
  icon: Component
  shortcut: string
}

export type ViewKey = 'translate' | 'chat' | 'vision' | 'image' | 'settings'

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'translate',
    label: '实时互译',
    title: '实时互译',
    subtitle: '捕获任意音视频，实时生成双语字幕',
    icon: AudioLines,
    shortcut: '1',
  },
  {
    key: 'chat',
    label: '智能对话',
    title: '智能对话',
    subtitle: '多模态问答、写作与代码，一站完成',
    icon: MessagesSquare,
    shortcut: '2',
  },
  {
    key: 'vision',
    label: '图像理解',
    title: '图像理解',
    subtitle: 'OCR、图表与代码截图，上传即分析',
    icon: ScanEye,
    shortcut: '3',
  },
  {
    key: 'image',
    label: '图像生成',
    title: '图像生成',
    subtitle: '文字/SVG/Logo 创作，翻译内容一键配图',
    icon: ImageIcon,
    shortcut: '5',
  },
  {
    key: 'settings',
    label: '能力设置',
    title: '能力设置',
    subtitle: '模型、密钥与开放源码信息',
    icon: Settings2,
    shortcut: '4',
  },
] as const
