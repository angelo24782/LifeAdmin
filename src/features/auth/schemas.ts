import { z } from 'zod'

import {
  DISPLAY_NAME_MAX_LENGTH,
  OTP_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from './constants'

/** Caratteri Unicode (code point) di una stringa: un'emoji conta 1, non 2 come `string.length`. */
function codePointLength(value: string): number {
  return Array.from(value).length
}

/** Byte della stringa in UTF-8, cioè ciò che il server riceve e che bcrypt tronca oltre 72. */
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Email normalizzata (trim, minuscole) e validata (SPECIFICA F1). */
export const emailSchema = z
  .string({ error: 'Inserisci il tuo indirizzo email.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Inserisci un indirizzo email valido.' }))

/**
 * Password scelta in `/set-password` (SPECIFICA F1): almeno 10 caratteri e al massimo 72 **byte**
 * UTF-8, quindi i caratteri multibyte e le emoji ne occupano più di uno. Non viene modificata
 * (nessun trim): gli spazi fanno parte della password.
 */
export const passwordSchema = z
  .string({ error: 'Inserisci una password.' })
  .refine((value) => codePointLength(value) >= PASSWORD_MIN_LENGTH, {
    error: `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`,
  })
  .refine((value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES, {
    error: `La password è troppo lunga: accorciala o usa meno emoji e caratteri speciali (limite tecnico di ${PASSWORD_MAX_BYTES} byte).`,
  })

const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`)

/** Codice di verifica email: esattamente `OTP_LENGTH` cifre ASCII (spazi esterni ignorati). */
export const otpSchema = z
  .string({ error: 'Inserisci il codice ricevuto per email.' })
  .trim()
  .regex(OTP_PATTERN, { error: `Il codice è composto da ${OTP_LENGTH} cifre.` })

/** Consenso a Termini e Privacy: obbligatorio, deve essere esattamente `true`. */
export const privacyConsentSchema = z.literal(true, {
  error: 'Per registrarti devi accettare Termini e Privacy.',
})

/**
 * Nome visualizzato opzionale (SPECIFICA F1): trim, al massimo 80 caratteri dopo il trim (come il
 * vincolo del database); una stringa vuota o di soli spazi equivale a "non indicato".
 */
export const displayNameSchema = z
  .string()
  .trim()
  .refine((value) => codePointLength(value) <= DISPLAY_NAME_MAX_LENGTH, {
    error: `Il nome può avere al massimo ${DISPLAY_NAME_MAX_LENGTH} caratteri.`,
  })
  .transform((value) => (value === '' ? undefined : value))
  .optional()

/** Dati del form di registrazione `/register` (SPECIFICA F1): la password si sceglie dopo la conferma. */
export const registerSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  acceptedPrivacy: privacyConsentSchema,
})

export type RegisterInput = z.infer<typeof registerSchema>
