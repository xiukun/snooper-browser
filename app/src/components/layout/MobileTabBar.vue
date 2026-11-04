<script setup lang="ts">
import { NAV_ITEMS, type ViewKey } from '@/lib/navigation'

defineProps<{ active: ViewKey }>()
const emit = defineEmits<{ select: [view: ViewKey] }>()
</script>

<template>
  <nav
    class="shrink-0 border-t border-white/8 bg-ink-950/85 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl"
  >
    <div class="grid grid-cols-4">
      <button
        v-for="item in NAV_ITEMS"
        :key="item.key"
        type="button"
        class="group flex flex-col items-center gap-1 rounded-xl py-1.5 transition-colors"
        :class="active === item.key ? 'text-white' : 'text-mist-500'"
        @click="emit('select', item.key)"
      >
        <span
          class="flex h-8 w-12 items-center justify-center rounded-full transition-colors"
          :class="active === item.key ? 'bg-iris-500/15 text-iris-300' : 'text-mist-500'"
        >
          <component :is="item.icon" class="h-[18px] w-[18px]" />
        </span>
        <span class="text-[10.5px] font-medium">{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>
