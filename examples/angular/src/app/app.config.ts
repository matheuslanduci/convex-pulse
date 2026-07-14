import type { ApplicationConfig } from '@angular/core'
import { provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter } from '@angular/router'
import {
  CONVEX_PULSE_CLIENT,
  ConvexPulseAngularClient
} from 'convex-pulse/angular'

import { routes } from './app.routes'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    {
      provide: CONVEX_PULSE_CLIENT,
      useValue: new ConvexPulseAngularClient(CONVEX_URL, { gcTime: 60_000 })
    },
    provideRouter(routes)
  ]
}
