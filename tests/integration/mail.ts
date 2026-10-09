/**
 * Lettura delle email di prova da Mailpit (stack locale). Solo per i test di integrazione.
 * `MAILPIT_URL` arriva da `scripts/run-integration.mjs` (ricavata da `supabase status`).
 */

export interface TestMail {
  readonly subject: string
  readonly created: string
  /** Codice a 8 cifre (`OTP_LENGTH`), se presente nel testo. */
  readonly code: string | null
  /** `token_hash` e `type` del link, se presente. */
  readonly tokenHash: string | null
  readonly type: string | null
}

export const SUBJECT_CONFIRMATION = /Conferma il tuo account/
export const SUBJECT_RECOVERY = /Reimposta la password/

function mailpitUrl(): string {
  const value = process.env.MAILPIT_URL
  if (!value) {
    throw new Error(
      'MAILPIT_URL non impostata: avviare Supabase con `pnpm supabase:start` e usare `pnpm test:integration`.',
    )
  }
  return value
}

interface MailpitSummary {
  ID: string
  Subject: string
  Created: string
  To: { Address: string }[]
}

async function listFor(to: string): Promise<MailpitSummary[]> {
  const response = await fetch(`${mailpitUrl()}/api/v1/messages?limit=500`)
  const body = (await response.json()) as { messages?: MailpitSummary[] }
  return (body.messages ?? []).filter((m) => m.To.some((t) => t.Address === to))
}

export async function mailCount(to: string, subject: RegExp): Promise<number> {
  return (await listFor(to)).filter((m) => subject.test(m.Subject)).length
}

/** Attende che arrivino almeno `count` email con l'oggetto indicato e restituisce la PIÙ RECENTE. */
export async function waitForMail(
  to: string,
  subject: RegExp,
  { count = 1, timeoutMs = 15_000 }: { count?: number; timeoutMs?: number } = {},
): Promise<TestMail> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const matches = (await listFor(to))
      .filter((m) => subject.test(m.Subject))
      .sort((a, b) => b.Created.localeCompare(a.Created))
    const latest = matches[0]
    if (latest && matches.length >= count) {
      const detail = (await (
        await fetch(`${mailpitUrl()}/api/v1/message/${latest.ID}`)
      ).json()) as {
        Text?: string
        HTML?: string
      }
      const href = /href="([^"]+)"/.exec(detail.HTML ?? '')?.[1]?.replaceAll('&amp;', '&')
      const url = href ? new URL(href) : null
      return {
        subject: latest.Subject,
        created: latest.Created,
        code: /\b(\d{8})\b/.exec(detail.Text ?? '')?.[1] ?? null,
        tokenHash: url?.searchParams.get('token_hash') ?? null,
        type: url?.searchParams.get('type') ?? null,
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Email "${subject.source}" per ${to} non arrivata (attese ${count}, trovate ${matches.length}).`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
