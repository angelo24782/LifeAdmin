<script setup lang="ts">
import { usePlatform } from '@/platform'

const { info } = usePlatform()
const platformLabel = { web: 'Web', ios: 'iOS', android: 'Android' }[info.name]
</script>

<template>
  <main class="pt-safe pb-safe pl-safe pr-safe flex min-h-dvh items-center justify-center p-4">
    <section
      class="bg-surface border-border-subtle shadow-card w-full max-w-md rounded-card border p-6 sm:p-8"
    >
      <p class="text-primary text-sm font-semibold">LifeAdmin</p>
      <h1 class="text-ink mt-2 text-2xl leading-8 font-semibold">
        Le scadenze della tua vita, sotto controllo.
      </h1>
      <p class="text-ink-muted mt-3 text-base">
        Il progetto è pronto per lo sviluppo. Le funzionalità arriveranno nelle prossime milestone.
      </p>
      <p class="text-ink-muted mt-6 text-sm" data-testid="platform-label">
        Piattaforma: {{ platformLabel }}
      </p>
    </section>
  </main>
</template>
