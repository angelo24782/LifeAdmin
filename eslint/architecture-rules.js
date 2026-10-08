// Regole di architettura multipiattaforma (SPECIFICA §14, regole 2–3).
// I plugin nativi si importano SOLO in `src/platform/native/**`, così il bundle Web non li contiene
// e il resto dell'app dipende unicamente dalle porte di `@/platform`.
// Il modulo è condiviso con tests/architecture/eslint-rules.test.ts.

const NATIVE_PLUGIN_PATTERNS = [
  '@capacitor/*',
  '@capacitor-community/*',
  '@capacitor-firebase/*',
  '@capawesome/*',
  '@aparajita/*',
]

/** @type {import('eslint').Linter.Config[]} */
export const architectureConfig = [
  {
    files: ['src/**/*.{ts,vue,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: NATIVE_PLUGIN_PATTERNS,
              message:
                'Import dei plugin nativi consentito solo in src/platform/native/**. Usa le porte di "@/platform".',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/platform/native/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]
