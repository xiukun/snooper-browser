import { ref } from 'vue'
import { STORAGE_KEYS } from '@lib/brand'
import type { ViewKey } from '@/lib/navigation'

const VALID: ViewKey[] = ['translate', 'chat', 'vision', 'settings']

function readStoredView(): ViewKey {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.activeView)
    if (stored && VALID.includes(stored as ViewKey)) return stored as ViewKey
  } catch {
    /* storage unavailable */
  }
  return 'translate'
}

const activeView = ref<ViewKey>(readStoredView())

function setView(view: ViewKey) {
  activeView.value = view
  try {
    localStorage.setItem(STORAGE_KEYS.activeView, view)
  } catch {
    /* storage unavailable */
  }
}

export function useNavigation() {
  return { activeView, setView }
}
