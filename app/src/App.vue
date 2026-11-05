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
import { useSettings } from '@/composables/useSettings'
import { NAV_ITEMS, type ViewKey } from '@/lib/navigation'

const { activeView, setView } = useNavigation()
const {
  hasExternalConfigUpdate,
  applyExternalConfig,
  dismissExternalConfigUpdate,
} = useSettings()

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
      <div
        v-if="hasExternalConfigUpdate"
        class="shrink-0 border-b border-amber-glow/20 bg-amber-glow/8 px-4 py-2 sm:px-6 lg:px-8"
        role="alert"
      >
        <p class="flex flex-wrap items-center gap-2 text-[12px] leading-relaxed text-mist-200">
          <span class="text-amber-glow">检测到配置在其他标签页更新</span>
          <span class="text-mist-400">为保护当前会话，已暂不覆盖。</span>
          <button
            type="button"
            class="rounded-lg border border-amber-glow/30 px-2.5 py-1 text-[11px] font-medium text-amber-glow transition-colors hover:bg-amber-glow/12"
            @click="applyExternalConfig"
          >
            应用更新
          </button>
          <button
            type="button"
            class="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-mist-400 transition-colors hover:bg-white/5"
            @click="dismissExternalConfigUpdate"
          >
            忽略
          </button>
        </p>
      </div>
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
