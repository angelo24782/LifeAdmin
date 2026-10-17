// Verifica a MUTAZIONE della protezione anti pre-hijacking di M3 (SPECIFICA §20 e §23.12).
// Rompe di proposito, una alla volta, le componenti di `auth_prehijack_guard` nel database LOCALE e controlla che
// la suite (pgTAP e/o integrazione con Supabase Auth reale) FALLISCA. Al termine ripristina ogni componente
// e riesegue la suite per confermare che lo stato originale passa.
//
// Richiede lo stack locale acceso (`pnpm supabase:start`). Le definizioni originali sono lette dalla migration
// (nessuna copia da tenere allineata). Non tocca file né dati tracciati: modifica solo il database locale.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MIGRATION = 'supabase/migrations/20261009150000_auth_prehijack_guard.sql'
const migration = readFileSync(MIGRATION, 'utf8')

const dir = mkdtempSync(join(tmpdir(), 'lifeadmin-mut-'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))

/**
 * Una sola istruzione per chiamata (limite di `supabase db query`).
 * @param {string} statement
 */
function runSql(statement) {
  const file = join(dir, 'q.sql')
  writeFileSync(file, statement, 'utf8')
  const r = spawnSync(`pnpm exec supabase db query --local -f "${file}"`, {
    encoding: 'utf8',
    shell: true,
  })
  if (r.status !== 0) throw new Error(`SQL fallita:\n${statement}\n${r.stdout}${r.stderr}`)
}

/**
 * @param {RegExp} regex
 * @param {string} what
 */
function extract(regex, what) {
  const m = migration.match(regex)
  if (!m) throw new Error(`Non trovo "${what}" nella migration`)
  return m[0].replace(/;\s*$/, '')
}

const WIPE_FN = extract(
  /create or replace function private\.wipe_password_on_first_confirmation\(\)[\s\S]*?\n\$\$;/,
  'funzione wipe',
)
const TRACK_FN = extract(
  /create or replace function private\.track_password_setup\(\)[\s\S]*?\n\$\$;/,
  'funzione flag',
)
const WIPE_TRG = extract(
  /create trigger wipe_password_on_first_confirmation[\s\S]*?;/,
  'trigger wipe',
)
const TRACK_TRG = extract(/create trigger track_password_setup[\s\S]*?;/, 'trigger flag')

const IF_RE =
  /if old\.email_confirmed_at is null\s+and new\.email_confirmed_at is not null\s+and old\.confirmation_sent_at is not null then/
if (!IF_RE.test(WIPE_FN)) throw new Error('Condizione del wipe non riconosciuta nella migration')
/** @param {string} condition */
const wipeWith = (condition) => WIPE_FN.replace(IF_RE, `if ${condition} then`)

const dropWipe = 'drop trigger wipe_password_on_first_confirmation on auth.users'
const dropTrack = 'drop trigger track_password_setup on auth.users'

/** @type {{ name: string, apply: string[], undo: string[] }[]} */
const MUTATIONS = [
  { name: 'M1  trigger BEFORE (wipe) rimosso', apply: [dropWipe], undo: [WIPE_TRG] },
  {
    name: 'M2  condizione invertita (confirmation_sent_at IS NULL)',
    apply: [
      wipeWith(
        'old.email_confirmed_at is null and new.email_confirmed_at is not null and old.confirmation_sent_at is null',
      ),
    ],
    undo: [WIPE_FN],
  },
  {
    name: 'M3  condizione mai vera alla prima conferma',
    apply: [wipeWith('old.email_confirmed_at is not null and new.email_confirmed_at is null')],
    undo: [WIPE_FN],
  },
  {
    name: 'M4  condizione troppo larga (qualunque UPDATE dopo la conferma)',
    apply: [
      wipeWith('old.confirmation_sent_at is not null and new.email_confirmed_at is not null'),
    ],
    undo: [WIPE_FN],
  },
  { name: 'M5  trigger AFTER (flag) rimosso', apply: [dropTrack], undo: [TRACK_TRG] },
  {
    name: 'M6  trigger AFTER con UPDATE OF encrypted_password',
    apply: [
      dropTrack,
      'create trigger track_password_setup after update of encrypted_password on auth.users for each row when (old.encrypted_password is distinct from new.encrypted_password) execute function private.track_password_setup()',
    ],
    undo: [dropTrack, TRACK_TRG],
  },
  {
    name: 'M7  funzione del flag che non fa nulla',
    apply: [
      "create or replace function private.track_password_setup() returns trigger language plpgsql security definer set search_path = '' as $$ begin return null; end; $$",
    ],
    undo: [TRACK_FN],
  },
  {
    name: 'M8  funzione del flag fail-open (inghiotte gli errori)',
    apply: [
      "create or replace function private.track_password_setup() returns trigger language plpgsql security definer set search_path = '' as $$ begin begin update public.profiles set password_setup_pending = (new.encrypted_password is null) where id = new.id; exception when others then null; end; return null; end; $$",
    ],
    undo: [TRACK_FN],
  },
  {
    name: 'M9  il client può scrivere il flag',
    apply: ['grant update (password_setup_pending) on public.profiles to authenticated'],
    undo: ['revoke update (password_setup_pending) on public.profiles from authenticated'],
  },
  {
    name: 'M10 anon può leggere il flag',
    apply: ['grant select (password_setup_pending) on public.profiles to anon'],
    undo: ['revoke select (password_setup_pending) on public.profiles from anon'],
  },
  {
    name: 'M11 EXECUTE restituito a PUBLIC sulla funzione del flag',
    apply: ['grant execute on function private.track_password_setup() to public'],
    undo: ['revoke execute on function private.track_password_setup() from public'],
  },
  {
    name: 'M12 ognuno legge tutti i profili (policy permissiva)',
    apply: [
      'create policy mutation_read_all on public.profiles for select to authenticated using (true)',
    ],
    undo: ['drop policy mutation_read_all on public.profiles'],
  },
]

/** @param {string} command */
const run = (command) => spawnSync(command, { encoding: 'utf8', shell: true })
const SUITES = [
  {
    name: 'pgTAP',
    command: 'pnpm exec supabase test db supabase/tests/database/50_auth_prehijack.test.sql',
  },
  {
    name: 'integrazione',
    command: 'pnpm test:integration tests/integration/auth-prehijack.int.test.ts',
  },
]

function runSuites() {
  return SUITES.map((suite) => ({ suite: suite.name, passed: run(suite.command).status === 0 }))
}

const only = process.argv.slice(2)
const selected = only.length
  ? MUTATIONS.filter((m) => only.some((id) => m.name.startsWith(id)))
  : MUTATIONS

console.log('Baseline (nessuna mutazione): le suite devono PASSARE')
const baseline = runSuites()
for (const b of baseline) console.log(`  ${b.suite}: ${b.passed ? 'PASS' : 'FAIL'}`)
if (baseline.some((b) => !b.passed)) {
  console.error('La baseline non passa: impossibile valutare le mutazioni.')
  process.exit(1)
}

let undetected = 0
let restoreFailed = false
for (const mutation of selected) {
  /** @type {{ suite: string, passed: boolean }[]} */
  let results
  try {
    for (const statement of mutation.apply) runSql(statement)
    results = runSuites()
  } finally {
    try {
      for (const statement of mutation.undo) runSql(statement)
    } catch (error) {
      restoreFailed = true
      const message = error instanceof Error ? error.message : String(error)
      console.error(`RIPRISTINO FALLITO per ${mutation.name}: ${message}`)
      console.error('Eseguire `pnpm db:reset` per ripristinare il database locale.')
    }
  }
  const detectedBy = results.filter((r) => !r.passed).map((r) => r.suite)
  const ok = detectedBy.length > 0
  if (!ok) undetected += 1
  console.log(
    `${ok ? 'RILEVATA ' : 'NON RILEVATA'}  ${mutation.name}  → suite che falliscono: ${detectedBy.join(', ') || 'nessuna'}`,
  )
  if (restoreFailed) break
}

if (!restoreFailed) {
  console.log('Ripristino: le suite devono tornare a PASSARE')
  const after = runSuites()
  for (const a of after) console.log(`  ${a.suite}: ${a.passed ? 'PASS' : 'FAIL'}`)
  if (after.some((a) => !a.passed)) restoreFailed = true
}

if (restoreFailed || undetected > 0) {
  console.error(
    `Esito: FALLITO (mutazioni non rilevate: ${undetected}, ripristino fallito: ${restoreFailed}).`,
  )
  process.exit(1)
}
console.log(`Esito: OK — ${selected.length} mutazioni su ${selected.length} rilevate.`)
