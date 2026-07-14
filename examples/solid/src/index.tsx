/* @refresh reload */
import { render } from 'solid-js/web'

import App from './App.tsx'

const root = document.querySelector('#root')

render(() => <App />, root!)
