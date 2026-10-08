import { describe, expect, it } from 'vitest'

import { AppError, toAppError } from './errors'

describe('toAppError', () => {
  it.each([
    ['42501', 'forbidden'],
    ['PGRST301', 'unauthenticated'],
    ['PGRST303', 'unauthenticated'],
    ['PGRST116', 'not_found'],
    ['23505', 'conflict'],
    ['23503', 'invalid_data'],
    ['23514', 'invalid_data'],
    ['23502', 'invalid_data'],
    ['22P02', 'invalid_data'],
    ['XX000', 'unknown'],
  ] as const)('maps SQLSTATE/PostgREST code %s to %s', (code, expected) => {
    const error = toAppError({ code, message: 'db error' })

    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe(expected)
  })

  it('maps fetch failures to a network error', () => {
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('network')
    expect(toAppError({ code: '', message: 'TypeError: fetch failed' }).code).toBe('network')
  })

  it('maps unrecognised values to unknown', () => {
    expect(toAppError('boom').code).toBe('unknown')
    expect(toAppError(null).code).toBe('unknown')
  })

  it('is idempotent for AppError instances', () => {
    const original = new AppError('conflict')

    expect(toAppError(original)).toBe(original)
  })

  it('keeps the technical cause out of the user message', () => {
    const cause = { code: '23505', message: 'duplicate key value violates unique constraint "x"' }
    const error = toAppError(cause)

    expect(error.message).not.toContain('constraint')
    expect(error.message).toBe('Esiste già un elemento con questi dati.')
    expect(error.cause).toBe(cause)
  })
})
