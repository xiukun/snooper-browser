/**
 * Toolbar overflow menu: open/close, arrow-key roving focus, outside click.
 */

export interface ToolsMenuRefs {
  button: HTMLButtonElement
  menu: HTMLElement
  shadow: ShadowRoot
}

export function createToolsMenu(refs: ToolsMenuRefs) {
  const { button, menu, shadow } = refs

  function setOpen(open: boolean) {
    menu.classList.toggle('open', open)
    button.classList.toggle('active', open)
    button.setAttribute('aria-expanded', String(open))
  }

  function items(): HTMLButtonElement[] {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>('.rtts-menu-item'))
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation()
    setOpen(!menu.classList.contains('open'))
  })

  // Any item click closes the menu; individual handlers are bound separately.
  menu.addEventListener('click', () => setOpen(false))

  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    setOpen(true)
    const all = items()
    ;(event.key === 'ArrowDown' ? all[0] : all[all.length - 1])?.focus()
  })

  menu.addEventListener('keydown', (event) => {
    const all = items()
    if (all.length === 0) return
    const active = shadow.activeElement as HTMLElement | null
    const index = active ? all.indexOf(active as HTMLButtonElement) : -1
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      all[(index + 1) % all.length]!.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      all[(index - 1 + all.length) % all.length]!.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      all[0]!.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      all[all.length - 1]!.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      button.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  })

  shadow.addEventListener('click', (event) => {
    if (!menu.classList.contains('open')) return
    const path = (event as any).composedPath?.() || []
    if (path.includes(button) || path.includes(menu)) return
    setOpen(false)
  })

  return { setOpen }
}
