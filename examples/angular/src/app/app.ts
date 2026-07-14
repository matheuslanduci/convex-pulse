import { Component, DestroyRef, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { CONVEX_PULSE_CLIENT } from 'convex-pulse/angular'
import { mountConvexPulseDevtools } from 'convex-pulse/devtools'

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: '<div class="app-shell"><router-outlet /></div>'
})
export class App {
  constructor() {
    const devtools = mountConvexPulseDevtools(inject(CONVEX_PULSE_CLIENT), {
      initialIsOpen: true
    })
    inject(DestroyRef).onDestroy(() => devtools.unmount())
  }
}
