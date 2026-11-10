import { cancelSearch, searchLibrary } from '../library-search'
import { confirmDelete, libraryContext, libraryUsage, openLibrarySource, prepareDelete, retryDelete, setFavorite, LibraryError } from '../library-store'
import { waitForRecovery } from '../session-store'
import type { MessageHandler, MessageHandlerMap, RouterContext } from './types'

function handler(run: (message: Record<string, any>, context: RouterContext) => Promise<unknown>): MessageHandler {
  return (message, context) => {
    void waitForRecovery().then(()=>run(message,context)).then(result=>context.sendResponse({ok:true,...result as object})).catch(error=>context.sendResponse({ok:false,code:error.code || 'STORAGE_ERROR',error:error.message || String(error)}))
    return true
  }
}
export const libraryHandlers: MessageHandlerMap = {
  LIBRARY_SEARCH: handler(message=>searchLibrary({query:message.query,favoritesOnly:message.favoritesOnly,cursor:message.cursor})),
  LIBRARY_CANCEL_SEARCH: handler(async message=>{await cancelSearch(message.cursor);return {cancelled:true}}),
  LIBRARY_CONTEXT: handler(message=>libraryContext(message.ref)),
  LIBRARY_FAVORITE: handler(message=>setFavorite(message.ref,message.favorite)),
  LIBRARY_PREPARE_DELETE: handler(message=>prepareDelete({transcriptIds:message.transcriptIds,noteIds:message.noteIds,noteEntries:message.noteEntries})),
  LIBRARY_DELETE: handler(message=>confirmDelete(message.token)),
  LIBRARY_RETRY_DELETE: handler(message=>retryDelete(message.operationId)),
  LIBRARY_USAGE: handler(()=>libraryUsage()),
  LIBRARY_OPEN_SOURCE: handler((message,{tabId})=>{
    if(message.tabId!==undefined && (!Number.isInteger(message.tabId) || message.tabId<0)) throw new LibraryError('INVALID_INPUT','标签页 ID 无效')
    return openLibrarySource({ref:message.ref,recordId:message.recordId,seconds:message.seconds},tabId ?? message.tabId)
  }),
}
