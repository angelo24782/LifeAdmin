// Verifica post-build (SPECIFICA §14 regola 3, §17): il bundle Web NON deve contenere moduli
// Capacitor. Eseguire dopo `pnpm build`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
const FORBIDDEN = [/@capacitor/i, /@capacitor-firebase/i, /capacitor-community/i, /@aparajita/i]
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html'])

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

let files
try {
  files = listFiles(distDir)
} catch {
  console.error('dist/ non trovato: eseguire prima `pnpm build`.')
  process.exit(1)
}

const offenders = files
  .filter((file) => SCANNED_EXTENSIONS.has(extname(file)))
  .flatMap((file) => {
    const content = readFileSync(file, 'utf8')
    return FORBIDDEN.filter((pattern) => pattern.test(content)).map(
      (pattern) => `${file} contiene ${pattern}`,
    )
  })

if (offenders.length > 0) {
  console.error('Il bundle Web include moduli nativi:\n' + offenders.join('\n'))
  process.exit(1)
}

console.log(`Bundle Web pulito: ${files.length} file controllati, nessun modulo Capacitor.`)
