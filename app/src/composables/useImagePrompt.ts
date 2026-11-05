import { ref } from 'vue'

/**
 * Shared pending image prompt — allows TranslateView (or any view) to pass
 * a prompt string to ImageView without coupling their state.
 *
 * ImageView reads (and clears) this value in onActivated / onMounted.
 * TranslateView writes it before calling setView('image').
 */
const pendingPrompt = ref('')

export function useImagePrompt() {
  function setPendingPrompt(text: string) {
    pendingPrompt.value = text
  }

  function consumePendingPrompt(): string {
    const text = pendingPrompt.value
    pendingPrompt.value = ''
    return text
  }

  return { pendingPrompt, setPendingPrompt, consumePendingPrompt }
}
