import { z } from 'zod'

/** Stringhe vuote (variabili definite ma senza valore) equivalgono a "non impostato". */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()))

const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(1),
  VITE_APP_URL: z.url(),
  VITE_APP_ENV: z.enum(['development', 'staging', 'production']),
  VITE_TURNSTILE_SITE_KEY: optionalString,
  VITE_SENTRY_DSN: optionalString,
})

export type AppEnv = z.infer<typeof envSchema>

export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Configurazione non valida:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
    this.name = 'EnvValidationError'
  }
}

/**
 * Valida le variabili d'ambiente esposte al browser. Funzione pura (testabile): riceve l'oggetto
 * grezzo, restituisce la configurazione tipizzata o lancia `EnvValidationError`.
 */
export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    )
  }
  return result.data
}

let cached: AppEnv | undefined

/** Configurazione dell'app, validata una sola volta all'avvio. */
export function getEnv(): AppEnv {
  cached ??= parseEnv(import.meta.env)
  return cached
}
