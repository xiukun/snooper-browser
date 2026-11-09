/** Obsidian export/upload/test handlers. */

import { exportToObsidian, testObsidian, uploadObsidianAsset } from '../obsidian'
import type { MessageHandlerMap } from './types'

export const obsidianHandlers: MessageHandlerMap = {
  EXPORT_TO_OBSIDIAN: (message, { sendResponse }) => {
    exportToObsidian(message).then(sendResponse).catch((err: any) => {
      sendResponse({ ok: false, error: err.message || '导出失败' })
    })
    return true
  },

  OBSIDIAN_UPLOAD_ASSET: (message, { sendResponse }) => {
    uploadObsidianAsset(message).then(sendResponse).catch((err: any) => {
      sendResponse({ ok: false, error: err.message || '图片上传失败' })
    })
    return true
  },

  TEST_OBSIDIAN: (message, { sendResponse }) => {
    testObsidian(message).then(sendResponse).catch(() => {
      sendResponse({ ok: false, error: '无法连接 Obsidian' })
    })
    return true
  },
}
