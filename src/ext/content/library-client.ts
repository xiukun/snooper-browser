import type { DeleteResult, DeleteSelection } from '../../lib/knowledge-types'

/** Shared minimal confirmation for existing buttons; full library UI uses the same protocol. */
export async function confirmLibraryDelete(selection: DeleteSelection): Promise<DeleteResult | null> {
  const preview = await chrome.runtime.sendMessage({target:'background',type:'LIBRARY_PREPARE_DELETE',...selection})
  if(!preview?.ok) throw new Error(preview?.error || '无法预览删除范围，请重试')
  const count = preview.targets.length
  if(!count) throw new Error(preview.skipped[0]?.reason || '没有可删除的资料')
  if(!confirm(`确定删除 ${count} 项资料？将同时移除 ${preview.favoriteCount} 条收藏。独立另存的笔记会保留。此操作不可恢复。`)) return null
  const result=await chrome.runtime.sendMessage({target:'background',type:'LIBRARY_DELETE',token:preview.token})
  if(!result?.ok) throw new Error(result?.error || '删除未完成，请重试')
  if(result.pending.length) throw new Error(`部分删除未完成：${result.pending[0].error}。操作 ID：${result.operationId}，可在资料库重试`)
  return result
}
