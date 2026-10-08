export type ItemStatus = 'active' | 'completed'

/** Scadenza (Life Item) come la vede l'applicazione. Le date sono stringhe `YYYY-MM-DD` senza fuso. */
export interface LifeItem {
  readonly id: string
  readonly categoryId: string
  readonly title: string
  readonly dueDate: string
  /** Importo in centesimi di euro; la conversione in euro appartiene a `domain/money` (M5). */
  readonly amountCents: number | null
  readonly notes: string | null
  readonly reminderDays: readonly number[]
  readonly status: ItemStatus
  readonly completedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NewLifeItem {
  /** Opzionale: id generato dal client per l'idempotenza (SPECIFICA F4). */
  readonly id?: string
  readonly categoryId: string
  readonly title: string
  readonly dueDate: string
  readonly amountCents?: number | null
  readonly notes?: string | null
  readonly reminderDays?: readonly number[]
}

export interface LifeItemPatch {
  readonly categoryId?: string
  readonly title?: string
  readonly dueDate?: string
  readonly amountCents?: number | null
  readonly notes?: string | null
  readonly reminderDays?: readonly number[]
  readonly status?: ItemStatus
  readonly completedAt?: string | null
}
