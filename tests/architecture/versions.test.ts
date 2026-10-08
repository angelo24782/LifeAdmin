import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadConfigFromFile } from 'vite'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>
}

function parseVersion(version: string): { major: number; minor: number } {
  const [major, minor] = version.split('.').map(Number)
  return { major: major ?? NaN, minor: minor ?? NaN }
}

describe('pinned toolchain (SPECIFICA §14, §23.1)', () => {
  it('keeps TypeScript below 6.1 until typescript-eslint supports newer versions', () => {
    const { version } = readJson('node_modules/typescript/package.json') as { version: string }
    const { major, minor } = parseVersion(version)

    expect(major).toBe(6)
    expect(minor).toBe(0)
  })

  it('declares the Node and package manager constraints', () => {
    const pkg = readJson('package.json') as { engines: { node: string }; packageManager: string }

    expect(pkg.engines.node).toContain('24')
    expect(pkg.packageManager).toMatch(/^pnpm@/)
  })

  it('sets an explicit Vite build target (Chrome 111 / Safari 16.4 baseline)', async () => {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      join(root, 'vite.config.ts'),
    )

    expect(loaded?.config.build?.target).toBe('baseline-widely-available')
  })

  it('does not depend on native plugins in the Web bundle yet', () => {
    const pkg = readJson('package.json') as {
      dependencies?: Record<string, string>
    }
    const names = Object.keys(pkg.dependencies ?? {})

    expect(names.filter((name) => name.startsWith('@capacitor'))).toEqual([])
  })
})
