import { createRouter, createWebHistory } from 'vue-router'

import Home from './views/Home.vue'
import Task from './views/Task.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { component: Home, path: '/' },
    { component: Task, path: '/tasks/:taskId' }
  ]
})
