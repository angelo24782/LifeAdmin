import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseDbQueryOutput, type Row } from '../support/db-query-output'

/**
 * Accesso SQL al database LOCALE per i soli test di integrazione (stato di `auth.*`, DDL temporaneo
 * per provare i fallimenti): usa `supabase db query --local`, quindi non servono credenziali né
 * dipendenze aggiuntive. Esegue UNA SOLA istruzione per chiamata (limite della CLI).
 *
 * La CLI (2.120.0) sceglie il formato dell'output in base all'ambiente: con un agente AI rilevato
 * (per esempio la variabile `AI_AGENT`) risponde con un oggetto con `rows`, altrimenti con una tabella di
 * testo. Per avere lo stesso comportamento ovunque (sviluppo, agente, CI) la chiamata fissa
 * `--agent no --output-format json`; l'output è letto da `parseDbQueryOutput`, che non trasforma mai in
 * "nessuna riga" un formato inatteso o un errore.
 */
export type { Row }

export function sql(statement: string): Row[] {
  const dir = mkdtempSync(join(tmpdir(), 'lifeadmin-sql-'))
  const file = join(dir, 'query.sql')
  writeFileSync(file, statement, 'utf8')
  try {
    const result = spawnSync(
      `pnpm exec supabase db query --local --agent no --output-format json -f "${file}"`,
      { encoding: 'utf8', shell: true },
    )
    const out = `${result.stdout}`
    if (result.status !== 0) {
      throw new Error(`sql() fallita (${result.status}): ${out}${result.stderr}`)
    }
    // Le istruzioni senza righe (DDL, DELETE…) rispondono solo con il tag del comando: nessun JSON.
    return parseDbQueryOutput(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireUuid(value: string): string {
  if (!UUID.test(value)) throw new Error('Identificativo utente non valido.')
  return value
}

/**
 * Solo per la caratterizzazione di auth-js: cancella le sessioni dell'utente nel database LOCALE
 * (i refresh token vanno in cascata), come se il server le avesse revocate.
 */
export function deleteAuthSessions(userId: string): void {
  sql(`delete from auth.sessions where user_id = '${requireUuid(userId)}'`)
}

/** Solo per la caratterizzazione di auth-js: cancella i refresh token lasciando la sessione. */
export function deleteRefreshTokens(userId: string): void {
  sql(`delete from auth.refresh_tokens where user_id = '${requireUuid(userId)}'`)
}
