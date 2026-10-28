/**
 * Costanti di autenticazione (SPECIFICA §20 M3, §23.4, §23.12).
 * I valori che esistono anche lato server sono verificati da `tests/architecture/auth-constants.test.ts`.
 */

/**
 * Versione dell'informativa privacy inviata nei metadata di `signUp`. Deve essere una versione
 * supportata dal backend (`private.supported_privacy_versions()`, docs/API_CONTRACT.md): se manca o non
 * è supportata la registrazione è rifiutata in modo atomico.
 */
export const PRIVACY_POLICY_VERSION = '2026-10-01'

/** Cifre del codice di verifica email (`otp_length` in `supabase/config.toml`, SPECIFICA §23.4). */
export const OTP_LENGTH = 8

/** Lunghezza minima della password, in caratteri (`minimum_password_length`, SPECIFICA F1). */
export const PASSWORD_MIN_LENGTH = 10

/** Lunghezza massima della password, in byte UTF-8 (limite di bcrypt, SPECIFICA F1 e §23.12 A). */
export const PASSWORD_MAX_BYTES = 72

/** Lunghezza massima del nome visualizzato, in caratteri (`profiles_display_name_length`). */
export const DISPLAY_NAME_MAX_LENGTH = 80

/** Attesa tra due invii dello stesso codice (SPECIFICA F1 e §23.4: 1 invio ogni 60 s). */
export const RESEND_COOLDOWN_SECONDS = 60
