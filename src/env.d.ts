/// <reference types="vite/client" />

/** Versione dell'app (package.json), definita a build-time da Vite/Vitest. */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
