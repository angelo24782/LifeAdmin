import { readFileSync } from 'node:fs'

/** Versione dell'app (da package.json), iniettata come `__APP_VERSION__` da Vite/Vitest. */
export const appVersion: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
