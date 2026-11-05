<script setup lang="ts">
import { computed } from 'vue'
import { AudioLines, Database, GitBranch, Sparkles, Video } from '@lucide/vue'
import SnooperMark from '@/components/SnooperMark.vue'
import { useSettings } from '@/composables/useSettings'
import { BRAND } from '@lib/brand'
import { NAV_ITEMS, type ViewKey } from '@/lib/navigation'

defineProps<{ active: ViewKey }>()
const emit = defineEmits<{ select: [view: ViewKey] }>()

const { providers, settings } = useSettings()

const lanes = computed(() => {
  const route = (capability: 'audio' | 'llm' | 'video') => {
    const slot = settings.routes[capability]
    const provider = providers.value.find((item) => item.id === slot.providerId)
    const dot =
      provider?.status === 'ok'
        ? 'bg-aqua-400/80'
        : provider?.status === 'error'
          ? 'bg-rose-glow/80'
          : 'bg-mist-600'
    return { provider, dot, model: slot.model }
  }
  return [
    { key: 'audio', icon: AudioLines, ...route('audio'), empty: '未选择转写模型' },
    { key: 'llm', icon: Database, ...route('llm'), empty: '未选择语言模型' },
    { key: 'video', icon: Video, ...route('video'), empty: '未选择画面模型' },
  ]
})
</script>

<template>
  <aside class="hidden w-[252px] shrink-0 flex-col border-r border-white/6 lg:flex">
    <div class="flex h-[76px] items-center gap-3 px-5">
      <SnooperMark :size="38" glow />
      <div class="min-w-0">
        <p class="text-[17px] leading-none font-semibold tracking-[-0.02em] text-white">
          snooper
        </p>
        <p class="mt-1 text-[10px] font-medium tracking-[0.22em] text-mist-500 uppercase">
          browser
        </p>
      </div>
    </div>

    <div class="px-3 pt-3">
      <p class="px-3 pb-2 text-[10px] font-medium tracking-[0.18em] text-mist-600 uppercase">
        Workspace
      </p>
      <nav class="space-y-1">
        <button
          v-for="item in NAV_ITEMS"
          :key="item.key"
          type="button"
          class="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200"
          :class="
            active === item.key
              ? 'bg-white/[0.07] text-white'
              : 'text-mist-400 hover:bg-white/[0.035] hover:text-mist-100'
          "
          @click="emit('select', item.key)"
        >
          <span
            v-if="active === item.key"
            class="absolute top-1/2 left-0 h-5 w-[2px] -translate-y-1/2 rounded-full bg-gradient-to-b from-iris-300 to-aqua-400"
          />
          <component
            :is="item.icon"
            class="h-[18px] w-[18px] transition-colors"
            :class="active === item.key ? 'text-iris-300' : 'text-mist-500 group-hover:text-mist-300'"
          />
          <span class="flex-1 text-[13.5px] font-medium">{{ item.label }}</span>
          <kbd
            class="rounded border border-white/8 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-mist-600 opacity-0 transition group-hover:opacity-100"
          >
            ⌥{{ item.shortcut }}
          </kbd>
        </button>
      </nav>
    </div>

    <div class="mt-auto space-y-3 p-3">
      <div class="glass-soft rounded-2xl p-3.5">
        <div class="flex items-center gap-2 text-[11px] font-medium text-mist-300">
          <Sparkles class="h-3.5 w-3.5 text-aqua-300" />
          Model routes
          <span class="ml-auto font-mono text-[9.5px] text-mist-600">
            {{ providers.length }} provider{{ providers.length === 1 ? '' : 's' }}
          </span>
        </div>
        <ul class="mt-2.5 space-y-2">
          <li
            v-for="lane in lanes"
            :key="lane.key"
            class="flex items-center gap-2 text-[11px] text-mist-500"
          >
            <component :is="lane.icon" class="h-3.5 w-3.5 shrink-0 text-mist-600" />
            <span class="truncate font-mono text-[10px]" :class="lane.model ? '' : 'text-mist-600'">
              {{ lane.model || lane.empty }}
            </span>
            <span class="ml-auto h-1 w-1 shrink-0 rounded-full" :class="lane.dot" />
          </li>
        </ul>
      </div>

      <div class="flex items-center justify-between px-2 text-[10.5px] text-mist-600">
        <span>v{{ BRAND.version }} · {{ BRAND.license }}</span>
        <a
          :href="BRAND.repoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 transition-colors hover:text-mist-300"
        >
          <GitBranch class="h-3 w-3" />
          source
        </a>
      </div>
    </div>
  </aside>
</template>
