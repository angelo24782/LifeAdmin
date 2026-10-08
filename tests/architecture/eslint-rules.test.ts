import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

import { architectureConfig } from '../../eslint/architecture-rules.js'

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: architectureConfig })

async function restrictedImportErrors(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath })
  return result?.messages.filter((m) => m.ruleId === 'no-restricted-imports').length ?? 0
}

describe('native plugin import boundary (SPECIFICA §14 regola 3)', () => {
  const capacitorImport = "import { Capacitor } from '@capacitor/core'\nexport { Capacitor }\n"

  it('forbids @capacitor/* outside src/platform/native', async () => {
    expect(await restrictedImportErrors(capacitorImport, 'src/features/items/service.ts')).toBe(1)
    expect(await restrictedImportErrors(capacitorImport, 'src/platform/web/index.ts')).toBe(1)
    expect(await restrictedImportErrors(capacitorImport, 'src/app/main.ts')).toBe(1)
  })

  it('forbids community and third-party native plugins outside src/platform/native', async () => {
    for (const source of [
      '@capacitor-firebase/messaging',
      '@capacitor-community/sqlite',
      '@capawesome/capacitor-background-task',
      '@aparajita/capacitor-secure-storage',
    ]) {
      const code = `import plugin from '${source}'\nexport default plugin\n`
      expect(await restrictedImportErrors(code, 'src/features/auth/store.ts')).toBe(1)
    }
  })

  it('allows native plugins inside src/platform/native', async () => {
    expect(await restrictedImportErrors(capacitorImport, 'src/platform/native/push.ts')).toBe(0)
  })

  it('allows the platform ports everywhere', async () => {
    const code = "import { usePlatform } from '@/platform'\nexport { usePlatform }\n"

    expect(await restrictedImportErrors(code, 'src/features/documents/upload.ts')).toBe(0)
  })
})
