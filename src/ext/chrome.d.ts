/** Minimal Chrome extension API types for build-time resolution. */
declare namespace chrome {
  namespace runtime {
    const id: string
    function getURL(path: string): string
    function sendMessage(message: any): Promise<any>
    function sendMessage(message: any, callback?: (response: any) => void): void
    namespace onMessage {
      function addListener(callback: (message: any, sender: any, sendResponse: (response?: any) => void) => void | boolean): void
    }
    namespace onInstalled {
      function addListener(callback: (details: any) => void): void
    }
  }
  namespace tabs {
    function create(properties: { url: string; active?: boolean }): Promise<any>
    function sendMessage(tabId: number, message: any): Promise<any>
    function get(tabId: number): Promise<any>
    function query(queryInfo: any): Promise<any[]>
    namespace onRemoved {
      function addListener(callback: (tabId: number) => void): void
    }
    namespace onUpdated {
      function addListener(callback: (tabId: number, changeInfo: any, tab?: any) => void): void
    }
  }
  namespace scripting {
    function executeScript(details: {
      target: { tabId: number }
      files?: string[]
      func?: (...args: any[]) => any
      world?: 'ISOLATED' | 'MAIN'
    }): Promise<any[]>
  }
  namespace storage {
    namespace local {
      function getBytesInUse(keys: null | string | string[]): Promise<number>
      function get(keys: string | string[] | Record<string, any>): Promise<Record<string, any>>
      function set(items: Record<string, any>): Promise<void>
      function remove(keys: string | string[]): Promise<void>
    }
    namespace session {
      function get(keys: string | string[] | Record<string, any>): Promise<Record<string, any>>
      function set(items: Record<string, any>): Promise<void>
      function remove(keys: string | string[]): Promise<void>
    }
  }
  namespace sidePanel {
    function open(options: { tabId?: number }): Promise<void>
    function setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>
  }
  namespace offscreen {
    function createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>
    function hasDocument(): Promise<boolean>
    function closeDocument(): Promise<void>
  }
  namespace tabCapture {
    function getMediaStreamId(options: { targetTabId: number }, callback: (streamId: string) => void): void
  }
  namespace management {
    function getAll(): Promise<any[]>
  }
  namespace permissions {
    function request(permissions: { origins?: string[]; permissions?: string[] }): Promise<boolean>
  }
  namespace action {
    namespace onClicked {
      function addListener(callback: (tab: any) => void): void
    }
  }
}
