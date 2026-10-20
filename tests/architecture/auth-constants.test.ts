import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DISPLAY_NAME_MAX_LENGTH,
  OTP_LENGTH,
  PASSWORD_MIN_LENGTH,
  PRIVACY_POLICY_VERSION,
} from '@/features/auth/constants'

const root = process.cwd()

/** Valore di `key` nella sezione `[section]` di `supabase/config.toml` (commenti esclusi). */
function configValue(section: string, key: string): string | undefined {
  const lines = readFileSync(join(root, 'supabase/config.toml'), 'utf8').split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `[${section}]`)
  if (start === -1) return undefined
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) return undefined
    const match = new RegExp(`^\\s*${key}\\s*=\\s*([^#\\s]+)`).exec(line)
    if (match) return match[1]
  }
  return undefined
}

/** Prima corrispondenza di `pattern` nell'ULTIMA migration (per nome) che la contiene. */
function latestMigrationMatch(pattern: RegExp): RegExpExecArray | undefined {
  const dir = join(root, 'supabase/migrations')
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .reverse()
  for (const file of files) {
    const match = pattern.exec(readFileSync(join(dir, file), 'utf8'))
    if (match) return match
  }
  return undefined
}

describe('auth constants match the backend (SPECIFICA §20 M3, docs/API_CONTRACT.md)', () => {
  it('uses a privacy version supported by private.supported_privacy_versions()', () => {
    const match = latestMigrationMatch(
      /create or replace function private\.supported_privacy_versions\(\)[\s\S]*?array\[([^\]]*)\]/i,
    )
    const supported = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((item) => item[1])

    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(supported.length).toBeGreaterThan(0)
    expect(supported).toContain(PRIVACY_POLICY_VERSION)
  })

  it('uses the OTP length configured for email codes', () => {
    expect(configValue('auth.email', 'otp_length')).toBe(String(OTP_LENGTH))
  })

  it('uses the minimum password length configured in Auth', () => {
    expect(configValue('auth', 'minimum_password_length')).toBe(String(PASSWORD_MIN_LENGTH))
  })

  it('uses the display name limit enforced by the database', () => {
    const match = latestMigrationMatch(/char_length\(display_name\)\s*<=\s*(\d+)/)

    expect(match?.[1]).toBe(String(DISPLAY_NAME_MAX_LENGTH))
  })
})
