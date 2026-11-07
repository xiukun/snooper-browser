/**
 * Chat image attachments: compression, file picking, paste, drag & drop, and
 * the removable chip row.
 */

const MAX_IMAGES = 4

export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('图片过大（超过 10MB）'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let w = img.naturalWidth
        let h = img.naturalHeight
        const max = 1280
        if (w > max || h > max) {
          if (w > h) { h = Math.round((h * max) / w); w = max }
          else { w = Math.round((w * max) / h); h = max }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('压缩失败')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = () => reject(new Error('图片解码失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export interface AttachmentsUI {
  container: HTMLElement
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  onChange?: () => void
}

export function createAttachments(ui: AttachmentsUI) {
  let pendingImages: string[] = []

  function render() {
    ui.container.textContent = ''
    if (pendingImages.length === 0) return
    for (let i = 0; i < pendingImages.length; i++) {
      const url = pendingImages[i]!
      const chip = document.createElement('div')
      chip.className = 'rtts-attach'
      const img = document.createElement('img')
      img.src = url
      img.alt = '已添加图片'
      chip.appendChild(img)
      const remove = document.createElement('button')
      remove.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      remove.setAttribute('aria-label', '移除图片')
      remove.addEventListener('click', () => {
        pendingImages.splice(i, 1)
        render()
      })
      chip.appendChild(remove)
      ui.container.appendChild(chip)
    }
  }

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      if (pendingImages.length >= MAX_IMAGES) { ui.toast('最多 4 张图片', 'err'); break }
      compressImage(file).then((dataUrl) => {
        pendingImages.push(dataUrl)
        render()
      }).catch((err) => {
        ui.toast(err.message, 'err')
      })
    }
  }

  function addUrl(url: string): 'ok' | 'duplicate' | 'full' {
    if (pendingImages.includes(url)) return 'duplicate'
    if (pendingImages.length >= MAX_IMAGES) return 'full'
    pendingImages.push(url)
    render()
    return 'ok'
  }

  return {
    render,
    addFiles,
    addUrl,
    list: () => pendingImages.slice(),
    clear: () => {
      pendingImages = []
      render()
    },
    count: () => pendingImages.length,
  }
}
