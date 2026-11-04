<script setup lang="ts">
import { useId } from 'vue'

withDefaults(
  defineProps<{
    size?: number
    glow?: boolean
    muted?: boolean
  }>(),
  { size: 36, glow: false, muted: false },
)

const gradientId = useId()
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <span
      v-if="glow"
      class="absolute inset-1 -z-10 rounded-[32%] bg-iris-500/50 blur-xl"
    />
    <svg viewBox="0 0 40 40" class="h-full w-full" fill="none">
      <defs>
        <linearGradient
          :id="gradientId"
          x1="4"
          y1="2"
          x2="36"
          y2="38"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#B9A8FF" />
          <stop offset="0.52" stop-color="#6642F5" />
          <stop offset="1" stop-color="#14C8B8" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="12"
        :fill="muted ? 'rgba(255,255,255,0.08)' : `url(#${gradientId})`"
      />
      <rect
        x="1.5"
        y="1.5"
        width="37"
        height="37"
        rx="11.5"
        stroke="white"
        stroke-opacity="0.16"
      />
      <path
        d="M9.2 21.9c3.1-4.85 6.5-7.28 10.1-7.28 3.6 0 7 2.43 10.1 7.28"
        stroke="white"
        stroke-opacity="0.92"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <circle cx="19.5" cy="21.9" r="3.25" fill="white" />
      <circle cx="19.5" cy="21.9" r="1.15" fill="#0B0B11" />
      <path
        d="M15.2 27.4h8.6"
        stroke="white"
        stroke-opacity="0.45"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  </span>
</template>
