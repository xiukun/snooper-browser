<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Toaster } from 'vue-sonner'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppTopbar from '@/components/layout/AppTopbar.vue'
import MobileTabBar from '@/components/layout/MobileTabBar.vue'
import ChatView from '@/views/ChatView.vue'
import SettingsView from '@/views/SettingsView.vue'
import TranslateView from '@/views/TranslateView.vue'
import VisionView from '@/views/VisionView.vue'
import { useNavigation } from '@/composables/useNavigation'
import { NAV_ITEMS, type ViewKey } from '@/lib/navigation'

const { activeView, setView } = useNavigation()

const VIEWS: Record<ViewKey, unknown> = {
  translate: TranslateView,
  chat: ChatView,
  vision: VisionView,
  settings: SettingsView,
}

const currentView = computed(() => VIEWS[activeView.value])
const currentItem = computed(
  () => NAV_ITEMS.find((item) => item.key === activeView.value) ?? NAV_ITEMS[0]!,
)

function onKeydown(event: KeyboardEvent) {
  if (!event.altKey || event.metaKey || event.ctrlKey) return
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.closest('input, textarea, select, [contenteditable="true"]') !== null)
  ) {
    return
  }
  const match = NAV_ITEMS.find((item) => item.shortcut === event.key)
  if (!match) return
  event.preventDefault()
  setView(match.key)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app-canvas flex h-dvh overflow-hidden">
    <div class="aurora-field" aria-hidden="true" />
    <div class="noise-overlay" aria-hidden="true" />

    <AppSidebar :active="activeView" @select="setView" />

    <div class="flex min-w-0 flex-1 flex-col">
      <AppTopbar :item="currentItem" />
      <main class="relative min-h-0 flex-1 overflow-hidden">
        <KeepAlive>
          <component :is="currentView" :key="activeView" />
        </KeepAlive>
      </main>
      <MobileTabBar class="lg:hidden" :active="activeView" @select="setView" />
    </div>

    <Toaster
      theme="dark"
      position="top-right"
      :visible-toasts="3"
      :toast-options="{ duration: 3600 }"
      class="font-sans"
    />
  </div>
</template>
