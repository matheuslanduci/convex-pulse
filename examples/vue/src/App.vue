<script setup lang="ts">
import { mountConvexPulseDevtools } from 'convex-pulse/devtools'
import { ConvexPulseVueClientKey } from 'convex-pulse/vue'
import { inject, onMounted, onUnmounted } from 'vue'

const client = inject(ConvexPulseVueClientKey)
if (client === undefined)
  throw new Error('Convex Pulse Vue client was not provided')

let unmountDevtools: () => void = () => undefined
onMounted(() => {
  const devtools = mountConvexPulseDevtools(client, { initialIsOpen: true })
  unmountDevtools = () => devtools.unmount()
})
onUnmounted(() => unmountDevtools())
</script>

<template>
  <div class="app-shell"><RouterView /></div>
</template>
