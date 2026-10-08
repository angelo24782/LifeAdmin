import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'

import { routes } from './routes'

/**
 * Router in modalità `history` (SPECIFICA §14, regola 6). La history è iniettabile per i test
 * (memory history); in produzione si usa quella del browser.
 */
export function createAppRouter(
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  return createRouter({ history, routes })
}
