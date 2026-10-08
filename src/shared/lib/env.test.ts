import { describe, expect, it } from 'vitest'

import { EnvValidationError, parseEnv } from './env'

const validEnv = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_APP_URL: 'http://localhost:5173',
  VITE_APP_ENV: 'development',
}

describe('parseEnv', () => {
  it('accepts a valid configuration and treats optional values as undefined', () => {
    const env = parseEnv({ ...validEnv, VITE_TURNSTILE_SITE_KEY: '', VITE_SENTRY_DSN: '  ' })

    expect(env.VITE_APP_ENV).toBe('development')
    expect(env.VITE_TURNSTILE_SITE_KEY).toBeUndefined()
    expect(env.VITE_SENTRY_DSN).toBeUndefined()
  })

  it('keeps optional values when provided', () => {
    const env = parseEnv({ ...validEnv, VITE_SENTRY_DSN: ' https://dsn.example/1 ' })

    expect(env.VITE_SENTRY_DSN).toBe('https://dsn.example/1')
  })

  it('reports every missing required variable with a clear message', () => {
    expect.assertions(4)
    try {
      parseEnv({})
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const message = (error as EnvValidationError).message
      expect(message).toContain('VITE_SUPABASE_URL')
      expect(message).toContain('VITE_SUPABASE_ANON_KEY')
      expect(message).toContain('VITE_APP_ENV')
    }
  })

  it('rejects invalid URLs and unknown environments', () => {
    expect(() => parseEnv({ ...validEnv, VITE_APP_URL: 'not-a-url', VITE_APP_ENV: 'qa' })).toThrow(
      EnvValidationError,
    )
  })

  it('rejects a blank anon key', () => {
    expect(() => parseEnv({ ...validEnv, VITE_SUPABASE_ANON_KEY: '   ' })).toThrow(
      EnvValidationError,
    )
  })
})
