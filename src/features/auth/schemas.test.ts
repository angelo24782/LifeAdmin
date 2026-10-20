import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import {
  DISPLAY_NAME_MAX_LENGTH,
  OTP_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from './constants'
import {
  displayNameSchema,
  emailSchema,
  otpSchema,
  passwordSchema,
  privacyConsentSchema,
  registerSchema,
} from './schemas'

/** Messaggi di errore di una validazione (vuoto se l'input è valido). */
function errorsOf(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

const byteLength = (value: string): number => new TextEncoder().encode(value).length

describe('emailSchema', () => {
  it('trims surrounding spaces and lowercases the address', () => {
    expect(emailSchema.parse('  Mario.Rossi@Example.COM  ')).toBe('mario.rossi@example.com')
  })

  it.each([
    '',
    '   ',
    'not-an-email',
    'mario@',
    '@example.com',
    'mario@example',
    'ma rio@example.it',
  ])('rejects %j', (input) => {
    expect(errorsOf(emailSchema, input)).toEqual(['Inserisci un indirizzo email valido.'])
  })

  it('rejects a missing or non-string value', () => {
    expect(errorsOf(emailSchema, undefined)).toEqual(['Inserisci il tuo indirizzo email.'])
    expect(errorsOf(emailSchema, 42)).toEqual(['Inserisci il tuo indirizzo email.'])
  })
})

describe('passwordSchema', () => {
  it('accepts a password of the minimum length', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10)
    expect(errorsOf(passwordSchema, 'a'.repeat(PASSWORD_MIN_LENGTH))).toEqual([])
  })

  it('rejects a password shorter than the minimum', () => {
    expect(errorsOf(passwordSchema, 'a'.repeat(PASSWORD_MIN_LENGTH - 1))).toEqual([
      `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`,
    ])
  })

  it('accepts exactly 72 ASCII bytes and rejects 73', () => {
    expect(PASSWORD_MAX_BYTES).toBe(72)
    expect(errorsOf(passwordSchema, 'a'.repeat(72))).toEqual([])
    expect(errorsOf(passwordSchema, 'a'.repeat(73))).toHaveLength(1)
  })

  it('limits bytes, not characters: 2-byte characters (36 fit, 37 do not)', () => {
    const fits = 'è'.repeat(36)
    const tooLong = 'è'.repeat(37)

    expect(byteLength(fits)).toBe(72)
    expect(errorsOf(passwordSchema, fits)).toEqual([])
    expect(byteLength(tooLong)).toBe(74)
    expect(tooLong.length).toBeLessThan(PASSWORD_MAX_BYTES)
    expect(errorsOf(passwordSchema, tooLong)).toHaveLength(1)
  })

  it('limits bytes, not characters: 3-byte characters (24 fit, 25 do not)', () => {
    expect(errorsOf(passwordSchema, '€'.repeat(24))).toEqual([])
    expect(errorsOf(passwordSchema, '€'.repeat(25))).toHaveLength(1)
  })

  it('counts emoji as 4 bytes (18 fit, 19 do not)', () => {
    expect(byteLength('😀')).toBe(4)
    expect(errorsOf(passwordSchema, '😀'.repeat(18))).toEqual([])
    expect(errorsOf(passwordSchema, '😀'.repeat(19))).toHaveLength(1)
  })

  it('accepts a mixed password that ends exactly on the byte limit and rejects one byte more', () => {
    expect(errorsOf(passwordSchema, `${'a'.repeat(70)}è`)).toEqual([])
    expect(errorsOf(passwordSchema, `${'a'.repeat(71)}è`)).toHaveLength(1)
  })

  it('counts the minimum length in characters, so 5 emoji (10 UTF-16 units) are too short', () => {
    const fiveEmoji = '😀'.repeat(5)

    expect(fiveEmoji.length).toBe(10)
    expect(errorsOf(passwordSchema, fiveEmoji)).toEqual([
      `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`,
    ])
    expect(errorsOf(passwordSchema, '😀'.repeat(10))).toEqual([])
  })

  it('does not alter the password: spaces are part of it', () => {
    expect(passwordSchema.parse('  una password  ')).toBe('  una password  ')
  })

  it('rejects a missing or non-string value', () => {
    expect(errorsOf(passwordSchema, undefined)).toEqual(['Inserisci una password.'])
    expect(errorsOf(passwordSchema, 1234567890)).toEqual(['Inserisci una password.'])
  })
})

describe('otpSchema', () => {
  it('accepts exactly 8 digits and ignores surrounding spaces', () => {
    expect(OTP_LENGTH).toBe(8)
    expect(otpSchema.parse('12345678')).toBe('12345678')
    expect(otpSchema.parse(' 12345678\n')).toBe('12345678')
    expect(otpSchema.parse('00000000')).toBe('00000000')
  })

  it.each([
    ['too short (7 digits)', '1234567'],
    ['too long (9 digits)', '123456789'],
    ['old 6-digit length', '123456'],
    ['empty', ''],
    ['letters', '1234567a'],
    ['internal space', '1234 5678'],
    ['dash', '1234-5678'],
    ['decimal point', '1234567.'],
    ['Arabic-Indic digits', '١٢٣٤٥٦٧٨'],
    ['full-width digits', '１２３４５６７８'],
  ])('rejects %s', (_label, input) => {
    expect(errorsOf(otpSchema, input)).toEqual([`Il codice è composto da ${OTP_LENGTH} cifre.`])
  })

  it('rejects a number or a missing value', () => {
    expect(errorsOf(otpSchema, 12345678)).toEqual(['Inserisci il codice ricevuto per email.'])
    expect(errorsOf(otpSchema, undefined)).toEqual(['Inserisci il codice ricevuto per email.'])
  })
})

describe('privacyConsentSchema', () => {
  it('accepts only the boolean true', () => {
    expect(privacyConsentSchema.parse(true)).toBe(true)
  })

  it.each([false, undefined, null, 'true', 1, 'on'])('rejects %j', (input) => {
    expect(errorsOf(privacyConsentSchema, input)).toEqual([
      'Per registrarti devi accettare Termini e Privacy.',
    ])
  })
})

describe('displayNameSchema', () => {
  it('treats a missing, empty or blank name as not provided', () => {
    expect(displayNameSchema.parse(undefined)).toBeUndefined()
    expect(displayNameSchema.parse('')).toBeUndefined()
    expect(displayNameSchema.parse('   ')).toBeUndefined()
  })

  it('trims the name', () => {
    expect(displayNameSchema.parse('  Mario Rossi ')).toBe('Mario Rossi')
  })

  it('accepts exactly 80 characters and rejects 81', () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(80)
    expect(errorsOf(displayNameSchema, 'a'.repeat(80))).toEqual([])
    expect(errorsOf(displayNameSchema, 'a'.repeat(81))).toEqual([
      'Il nome può avere al massimo 80 caratteri.',
    ])
  })

  it('applies the 80-character limit after the trim', () => {
    expect(displayNameSchema.parse(`  ${'a'.repeat(80)}  `)).toBe('a'.repeat(80))
    expect(errorsOf(displayNameSchema, `  ${'a'.repeat(81)}  `)).toHaveLength(1)
  })

  it('counts characters like the database (an emoji is 1), not UTF-16 units', () => {
    expect(errorsOf(displayNameSchema, '😀'.repeat(80))).toEqual([])
    expect(errorsOf(displayNameSchema, '😀'.repeat(81))).toHaveLength(1)
  })

  it('rejects a non-string value', () => {
    expect(errorsOf(displayNameSchema, 42)).toHaveLength(1)
    expect(errorsOf(displayNameSchema, null)).toHaveLength(1)
  })
})

describe('registerSchema', () => {
  it('normalizes a complete registration', () => {
    expect(
      registerSchema.parse({
        email: '  Mario@Example.IT ',
        displayName: ' Mario ',
        acceptedPrivacy: true,
      }),
    ).toEqual({ email: 'mario@example.it', displayName: 'Mario', acceptedPrivacy: true })
  })

  it('accepts a registration without a name', () => {
    const result = registerSchema.parse({ email: 'mario@example.it', acceptedPrivacy: true })

    expect(result.displayName).toBeUndefined()
  })

  it('rejects a missing consent and reports it on the right field', () => {
    const result = registerSchema.safeParse({ email: 'mario@example.it' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['acceptedPrivacy'])
  })

  it('reports every invalid field at once', () => {
    const result = registerSchema.safeParse({
      email: 'no',
      displayName: 'a'.repeat(81),
      acceptedPrivacy: false,
    })

    expect(result.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual([
      'acceptedPrivacy',
      'displayName',
      'email',
    ])
  })

  it('does not accept a password at registration: it is dropped from the output', () => {
    const result = registerSchema.parse({
      email: 'mario@example.it',
      acceptedPrivacy: true,
      password: 'una-password-segreta',
    })

    expect(result).not.toHaveProperty('password')
  })
})
