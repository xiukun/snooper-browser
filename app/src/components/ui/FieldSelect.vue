<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

export interface FieldOption {
  value: string
  label: string
  short?: string
}

withDefaults(
  defineProps<{
    label?: string
    options: readonly FieldOption[]
    compact?: boolean
    disabled?: boolean
  }>(),
  { label: '', compact: false, disabled: false },
)

const model = defineModel<string>({ required: true })
</script>

<template>
  <label class="block">
    <span
      v-if="label"
      class="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.18em] text-mist-500"
    >
      {{ label }}
    </span>
    <span class="relative block">
      <select
        v-model="model"
        :disabled="disabled"
        class="w-full appearance-none rounded-xl border border-white/8 bg-white/[0.04] pr-9 text-mist-100 transition outline-none hover:border-white/15 focus:border-iris-400/60 focus:bg-white/[0.06] disabled:opacity-50"
        :class="compact ? 'h-10 pl-3 text-[13px]' : 'h-11 pl-3.5 text-sm'"
      >
        <option v-for="option in options" :key="option.value" :value="option.value" class="bg-ink-850">
          {{ option.label }}
        </option>
      </select>
      <ChevronDown
        class="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 text-mist-500"
      />
    </span>
  </label>
</template>
