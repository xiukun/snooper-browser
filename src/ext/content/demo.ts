/**
 * Demo subtitle loop.
 *
 * Plays a fixed set of bilingual lines so a fresh install can show the
 * toolbar's value before any API key is configured.
 */

export const DEMO_SUBTITLES: Array<{ source: string; target: string; delay: number }> = [
  { source: 'Welcome to snooper-browser', target: '欢迎使用 snooper-browser', delay: 2000 },
  { source: 'This is a real-time translation demo', target: '这是一个实时翻译演示', delay: 2500 },
  { source: 'You can also take notes and generate images', target: '你可以记笔记和生成图片', delay: 3000 },
  { source: 'Click the record button to start real transcription', target: '点击录音按钮开始真实转写', delay: 2800 },
  { source: 'Configure your API key in the settings panel', target: '在设置面板中配置你的 API 密钥', delay: 3000 },
  { source: 'Enjoy the seamless multilingual experience', target: '享受无缝的多语言体验', delay: 2500 },
]
