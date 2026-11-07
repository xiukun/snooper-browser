/**
 * Unified side drawer: chat and notes tabs share one panel.
 */

export type DrawerTab = 'chat' | 'notes'

export interface DrawerRefs {
  drawer: HTMLElement
  close: HTMLElement
  chatButton: HTMLElement
  notesButton: HTMLElement
  chatTab: HTMLElement
  notesTab: HTMLElement
  chatPane: HTMLElement
  notesPane: HTMLElement
  chatEditor: HTMLElement
  notesEditor: HTMLElement
}

export interface DrawerDeps {
  refs: DrawerRefs
  setCiteOpen: (open: boolean) => void
  renderNotes: () => void
}

export function createDrawer(deps: DrawerDeps) {
  const r = deps.refs
  let isOpen = false
  let tab: DrawerTab = 'chat'

  function syncButtons() {
    r.chatButton.classList.toggle('active', isOpen && tab === 'chat')
    r.notesButton.classList.toggle('active', isOpen && tab === 'notes')
  }

  function setTab(next: DrawerTab) {
    tab = next
    r.chatTab.classList.toggle('active', next === 'chat')
    r.notesTab.classList.toggle('active', next === 'notes')
    r.chatTab.setAttribute('aria-selected', String(next === 'chat'))
    r.notesTab.setAttribute('aria-selected', String(next === 'notes'))
    r.chatPane.classList.toggle('active', next === 'chat')
    r.notesPane.classList.toggle('active', next === 'notes')
    if (next === 'notes') {
      deps.setCiteOpen(false)
      deps.renderNotes()
    }
    syncButtons()
  }

  function open(next: DrawerTab) {
    isOpen = true
    r.drawer.classList.add('open')
    setTab(next)
    if (next === 'notes') r.notesEditor.focus()
    else r.chatEditor.focus()
  }

  function close() {
    isOpen = false
    r.drawer.classList.remove('open')
    deps.setCiteOpen(false)
    syncButtons()
  }

  r.chatButton.addEventListener('click', () => {
    if (isOpen && tab === 'chat') close()
    else open('chat')
  })
  r.notesButton.addEventListener('click', () => {
    if (isOpen && tab === 'notes') close()
    else open('notes')
  })
  r.chatTab.addEventListener('click', () => setTab('chat'))
  r.notesTab.addEventListener('click', () => setTab('notes'))
  r.close.addEventListener('click', close)

  return {
    isOpen: () => isOpen,
    activeTab: () => tab,
    open,
    close,
    setTab,
  }
}
