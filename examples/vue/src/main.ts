import { ConvexPulseVueClient, ConvexPulseVueClientKey } from 'convex-pulse/vue'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'

import './App.css'

const convex = new ConvexPulseVueClient(import.meta.env.VITE_CONVEX_URL, {
  gcTime: 60_000
})

createApp(App)
  .provide(ConvexPulseVueClientKey, convex)
  .use(router)
  .mount('#app')
