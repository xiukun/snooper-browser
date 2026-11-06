<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number
    glow?: boolean
    muted?: boolean
  }>(),
  { size: 36, glow: false, muted: false },
)
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <span
      v-if="glow"
      class="absolute inset-1 -z-10 rounded-[32%] bg-aqua-500/40 blur-xl"
    />
    <svg viewBox="0 0 40 40" class="h-full w-full" fill="none">
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="10"
        :fill="muted ? 'rgba(255,255,255,0.08)' : '#0B0F19'"
        :stroke="muted ? 'rgba(255,255,255,0.12)' : '#14C8B8'"
        stroke-width="1.4"
        :stroke-opacity="muted ? '0.2' : '0.35'"
      />
      <path
        d="M7 17.5c3.6-5.5 8.2-8 13-8s9.4 2.5 13 8c-3.6 5.5-8.2 8-13 8s-9.4-2.5-13-8Z"
        :stroke="muted ? 'rgba(255,255,255,0.6)' : '#FFFFFF'"
        stroke-width="2.2"
        :fill="muted ? 'transparent' : '#141E30'"
        stroke-linejoin="round"
      />
      <circle cx="20" cy="17.5" r="4.2" :fill="muted ? 'rgba(255,255,255,0.6)' : '#FFFFFF'" />
      <circle cx="20" cy="17.5" r="1.7" :fill="muted ? 'transparent' : '#0B0F19'" />
      <line
        x1="9.5"
        y1="29"
        x2="30.5"
        y2="29"
        :stroke="muted ? 'rgba(255,255,255,0.45)' : '#14C8B8'"
        stroke-width="2.4"
        stroke-linecap="round"
      />
      <line
        x1="13.5"
        y1="34"
        x2="26.5"
        y2="34"
        :stroke="muted ? 'rgba(255,255,255,0.3)' : '#14C8B8'"
        stroke-width="2"
        stroke-linecap="round"
        :stroke-opacity="muted ? '0.6' : '0.8'"
      />
    </svg>
  </span>
</template>
