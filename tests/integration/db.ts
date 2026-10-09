import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Accesso SQL al database LOCALE per i soli test di integrazione (stato di `auth.*`, DDL temporaneo
 * per provare i fallimenti): usa `supabase db query --local`, quindi non servono credenziali né
 * dipendenze aggiuntive. Esegue UNA SOLA istruzione per chiamata (limite della CLI).
 */
export type Row = Record<string, unknown>

export function sql(statement: string): Row[] {
  const dir = mkdtempSync(join(tmpdir(), 'lifeadmin-sql-'))
  const file = join(dir, 'query.sql')
  writeFileSync(file, statement, 'utf8')
  try {
    const result = spawnSync(`pnpm exec supabase db query --local -f "${file}"`, {
      encoding: 'utf8',
      shell: true,
    })
    const out = `${result.stdout}`
    if (result.status !== 0) {
      throw new Error(`sql() fallita (${result.status}): ${out}${result.stderr}`)
    }
    const start = out.indexOf('{')
    // Le istruzioni senza righe (DDL) rispondono solo con il tag del comando: nessun JSON.
    if (start < 0) return []
    const parsed = JSON.parse(out.slice(start)) as { rows?: Row[]; error?: { message?: string } }
    if (parsed.error) throw new Error(`sql() fallita: ${parsed.error.message ?? out}`)
    return parsed.rows ?? []
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
