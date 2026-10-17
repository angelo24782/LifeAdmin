// Esegue i test di integrazione contro Supabase locale.
// URL e chiavi (locali, effimere) arrivano da `supabase status -o env` oppure, se già presenti,
// dalle variabili SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / MAILPIT_URL (es. in CI).
// Non vengono mai scritte su disco. La service_role è usata SOLO dai test per creare utenti.
import { spawnSync } from 'node:child_process'

/**
 * @param {string[]} args
 * @param {Omit<import('node:child_process').SpawnSyncOptionsWithStringEncoding, 'encoding'>} [options]
 */
const run = (args, options) =>
  spawnSync('pnpm', args, { encoding: 'utf8', shell: true, ...options })

function readStatusEnv() {
  const result = run(['exec', 'supabase', 'status', '-o', 'env'])
  if (result.status !== 0) {
    console.error('Supabase locale non raggiungibile. Avvialo con `pnpm supabase:start`.')
    process.exit(1)
  }
  /** @type {Record<string, string>} */
  const values = {}
  for (const line of result.stdout.split('\n')) {
    const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim())
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2]
  }
  return values
}

const env = { ...process.env }
if (
  !env.SUPABASE_URL ||
  !env.SUPABASE_ANON_KEY ||
  !env.SUPABASE_SERVICE_ROLE_KEY ||
  !env.MAILPIT_URL
) {
  const status = readStatusEnv()
  env.SUPABASE_URL ??= status.API_URL
  env.SUPABASE_ANON_KEY ??= status.ANON_KEY
  env.SUPABASE_SERVICE_ROLE_KEY ??= status.SERVICE_ROLE_KEY
  // Mailpit (email di prova) parte con `pnpm supabase:start`; la CLI lo espone come MAILPIT_URL o INBUCKET_URL.
  env.MAILPIT_URL ??= status.MAILPIT_URL ?? status.INBUCKET_URL
}

const missing = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MAILPIT_URL',
].filter((name) => !env[name])
if (missing.length > 0) {
  console.error(`Variabili mancanti: ${missing.join(', ')}`)
  process.exit(1)
}

const result = run(
  ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts', ...process.argv.slice(2)],
  { stdio: 'inherit', env },
)
process.exit(result.status ?? 1)
