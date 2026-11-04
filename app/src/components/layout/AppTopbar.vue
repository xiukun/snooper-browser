<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, ExternalLink, GitBranch, TriangleAlert } from 'lucide-vue-next'
import SnooperMark from '@/components/SnooperMark.vue'
import { BRAND } from '@/lib/brand'
import type { NavItem } from '@/lib/navigation'
import { useNavigation } from '@/composables/useNavigation'
import { useSettings } from '@/composables/useSettings'

defineProps<{ item: NavItem }>()

const { setView } = useNavigation()
const { isConfigured } = useSettings()

const statusLabel = computed(() => (isConfigured.value ? 'Routes ready' : 'Key required'))
</script>

<template>
  <header
    class="flex h-[76px] shrink-0 items-center justify-between gap-4 border-b border-white/6 px-4 sm:px-6 lg:px-8"
  >
    <div class="flex min-w-0 items-center gap-3">
      <SnooperMark :size="30" class="lg:hidden" />
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h1 class="truncate text-[15px] font-semibold tracking-[-0.01em] text-white">
            {{ item.title }}
          </h1>
          <span
            class="hidden rounded-full border border-white/8 bg-white/[0.035] px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] text-mist-500 uppercase sm:inline"
          >
            {{ BRAND.product }}
          </span>
        </div>
        <p class="mt-0.5 hidden truncate text-[12px] text-mist-500 sm:block">
          {{ item.subtitle }}
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <button
        type="button"
        class="inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[11.5px] font-medium transition-colors"
        :class="
          isConfigured
            ? 'border-aqua-400/20 bg-aqua-400/8 text-aqua-300 hover:bg-aqua-400/12'
            : 'border-amber-glow/25 bg-amber-glow/8 text-amber-glow hover:bg-amber-glow/12'
        "
        @click="setView('settings')"
      >
        <CircleCheck v-if="isConfigured" class="h-3.5 w-3.5" />
        <TriangleAlert v-else class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">{{ statusLabel }}</span>
      </button>

      <a
        :href="BRAND.repoUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="hidden h-9 items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 text-[11.5px] text-mist-400 transition-colors hover:border-white/15 hover:text-mist-100 sm:inline-flex"
      >
        <GitBranch class="h-3.5 w-3.5" />
        <span class="hidden md:inline">Open source</span>
        <ExternalLink class="h-3 w-3 opacity-50" />
      </a>
    </div>
  </header>
</template>
