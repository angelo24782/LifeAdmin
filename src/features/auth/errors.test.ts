import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { AppError, type AppErrorCode } from '@/shared/lib/errors'

import { toAuthAppError } from './errors'

/**
 * Gli errori di Auth sono costruiti con le classi reali di auth-js 2.117.3. I codici "[LR]" sono stati
 * osservati con GoTrue locale reale nei test del repository, "[SIM]" solo con risposte simulate,
 * "[spec]" sono riportati dalla SPECIFICA (§20, §23.12) ma non ancora riprodotti da un test: vanno
 * verificati con GoTrue reale in A4.
 */
const NEW_AUTH_CODES: readonly AppErrorCode[] = [
  'invalid_credentials',
  'email_not_confirmed',
  'invalid_code',
  'weak_password',
  'rate_limited',
  'already_registered',
]

describe('toAuthAppError: codici osservati con GoTrue reale [LR]', () => {
  it.each([
    ['invalid_credentials', 400, 'invalid_credentials'],
    ['email_not_confirmed', 400, 'email_not_confirmed'],
    ['weak_password', 422, 'weak_password'],
    ['refresh_token_not_found', 400, 'unauthenticated'],
    ['refresh_token_already_used', 400, 'unauthenticated'],
    ['user_not_found', 403, 'unauthenticated'],
    ['bad_jwt', 401, 'unauthenticated'],
  ] as const)('maps %s (HTTP %i) to %s', (code, status, expected) => {
    const cause = new AuthApiError('server message', status, code)
    const error = toAuthAppError(cause)

    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe(expected)
    expect(error.cause).toBe(cause)
  })
})

describe('toAuthAppError: codici solo simulati [SIM] o riportati dalla specifica [spec]', () => {
  it.each([
    { code: 'over_request_rate_limit', status: 429, expected: 'rate_limited', evidence: 'SIM' },
    { code: 'otp_expired', status: 403, expected: 'invalid_code', evidence: 'spec' },
    { code: 'over_email_send_rate_limit', status: 429, expected: 'rate_limited', evidence: 'spec' },
    { code: 'user_already_exists', status: 422, expected: 'already_registered', evidence: 'spec' },
  ])('maps $code (HTTP $status) to $expected [$evidence]', ({ code, status, expected }) => {
    expect(toAuthAppError(new AuthApiError('server message', status, code)).code).toBe(expected)
  })
})

describe('toAuthAppError: classi di errore dell’SDK', () => {
  it('treats a fetch failure (status 0) and gateway errors as network errors', () => {
    expect(toAuthAppError(new AuthRetryableFetchError('Failed to fetch', 0)).code).toBe('network')
    expect(toAuthAppError(new AuthRetryableFetchError('Bad gateway', 503)).code).toBe('network')
  })

  it('treats a missing session as unauthenticated', () => {
    const cause = new AuthSessionMissingError()
    const error = toAuthAppError(cause)

    expect(error.code).toBe('unauthenticated')
    expect(error.cause).toBe(cause)
  })

  it('maps the dedicated weak password error, whatever the reasons', () => {
    expect(toAuthAppError(new AuthWeakPasswordError('weak', 422, ['length'])).code).toBe(
      'weak_password',
    )
    expect(toAuthAppError(new AuthWeakPasswordError('weak', 422, ['pwned'])).code).toBe(
      'weak_password',
    )
  })

  it('maps the rate limit codes by code, whatever the HTTP status', () => {
    expect(toAuthAppError(new AuthApiError('x', 400, 'over_request_rate_limit')).code).toBe(
      'rate_limited',
    )
    expect(toAuthAppError(new AuthApiError('x', 400, 'over_email_send_rate_limit')).code).toBe(
      'rate_limited',
    )
  })

  it('maps HTTP 429 to rate_limited even when the code is unknown', () => {
    expect(toAuthAppError(new AuthApiError('slow down', 429, 'brand_new_code')).code).toBe(
      'rate_limited',
    )
    expect(toAuthAppError(new AuthApiError('slow down', 429, undefined)).code).toBe('rate_limited')
  })
})

describe('toAuthAppError: fallback sicuro per ciò che non è verificato', () => {
  it.each([
    // Codici esistenti in auth-js ma mai osservati nel repository: non si indovina il significato.
    ['session_expired', 403],
    ['session_not_found', 403],
    ['email_exists', 422],
    ['validation_failed', 400],
    ['captcha_failed', 400],
    ['signup_disabled', 422],
    ['same_password', 422],
    ['brand_new_code', 400],
  ])('maps the unverified code %s (HTTP %i) to unknown', (code, status) => {
    expect(toAuthAppError(new AuthApiError('server message', status, code)).code).toBe('unknown')
  })

  it('maps an API error without a code to unknown, ignoring its message text', () => {
    const error = toAuthAppError(new AuthApiError('Invalid login credentials', 400, undefined))

    expect(error.code).toBe('unknown')
  })

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'does not resolve the hostile code %j through the prototype chain',
    (code) => {
      expect(toAuthAppError(new AuthApiError('x', 400, code)).code).toBe('unknown')
    },
  )

  it('maps uncharacterized SDK errors to unknown and keeps the cause', () => {
    const cause = new AuthUnknownError('unexpected', new Error('inner'))
    const error = toAuthAppError(cause)

    expect(error.code).toBe('unknown')
    expect(error.cause).toBe(cause)
  })
})

describe('toAuthAppError: errori che non sono di Auth', () => {
  it('delegates PostgREST errors to toAppError', () => {
    expect(toAuthAppError({ code: '42501', message: 'permission denied' }).code).toBe('forbidden')
    expect(toAuthAppError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe(
      'unauthenticated',
    )
  })

  it('delegates fetch failures and unrecognised values to toAppError', () => {
    expect(toAuthAppError(new TypeError('Failed to fetch')).code).toBe('network')
    expect(toAuthAppError('boom').code).toBe('unknown')
    expect(toAuthAppError(null).code).toBe('unknown')
    expect(toAuthAppError(undefined).code).toBe('unknown')
  })

  it('is idempotent for AppError instances', () => {
    const original = new AppError('invalid_code')

    expect(toAuthAppError(original)).toBe(original)
    expect(
      toAuthAppError(toAuthAppError(new AuthApiError('x', 400, 'invalid_credentials'))).code,
    ).toBe('invalid_credentials')
  })
})

describe('toAuthAppError: nessun dettaglio tecnico né rivelazione dell’account', () => {
  const secrets = 'mario.rossi@example.it token=abc123DEF456 Invalid login credentials 500 GoTrue'

  it.each([
    ['invalid_credentials', 400],
    ['email_not_confirmed', 400],
    ['otp_expired', 403],
    ['user_already_exists', 422],
    ['over_email_send_rate_limit', 429],
    ['brand_new_code', 400],
  ] as const)('keeps the raw server message of %s out of the user message', (code, status) => {
    const cause = new AuthApiError(secrets, status, code)
    const error = toAuthAppError(cause)

    expect(error.message).not.toContain('mario.rossi')
    expect(error.message).not.toContain('abc123')
    expect(error.message).not.toContain('GoTrue')
    expect(error.message).not.toContain(code)
    expect(error.cause).toBe(cause)
  })

  it('answers a duplicate registration with the same text as a successful one', () => {
    const error = toAuthAppError(
      new AuthApiError('User already registered', 422, 'user_already_exists'),
    )

    expect(error.code).toBe('already_registered')
    expect(error.message).toBe(new AppError('already_registered').message)
    expect(error.message).not.toMatch(/già|esist|registrat|account/i)
  })

  it('has a plain Italian message for every authentication code', () => {
    for (const code of NEW_AUTH_CODES) {
      const { message } = new AppError(code)

      expect(message.length).toBeGreaterThan(10)
      expect(message).not.toMatch(/[a-z]+_[a-z_]+|supabase|gotrue|jwt|token|http|\b\d{3}\b/i)
    }
  })
})
