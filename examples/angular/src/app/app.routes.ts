import type { Routes } from '@angular/router'

import { Home } from './home'
import { Task } from './task'

export const routes: Routes = [
  { component: Home, path: '' },
  { component: Task, path: 'tasks/:taskId' }
]
