import type { Tables, TablesInsert, TablesUpdate } from '@/shared/types/database'

import type { LifeItem, LifeItemPatch, NewLifeItem } from './types'

/** Colonne lette dal client: elenco esplicito, mai `select *` (SPECIFICA §23.10, regola 1). */
export const ITEM_COLUMNS =
  'id, category_id, title, due_date, amount_cents, notes, reminder_days, status, completed_at, created_at, updated_at'

export type ItemRow = Pick<
  Tables<'life_items'>,
  | 'id'
  | 'category_id'
  | 'title'
  | 'due_date'
  | 'amount_cents'
  | 'notes'
  | 'reminder_days'
  | 'status'
  | 'completed_at'
  | 'created_at'
  | 'updated_at'
>

export function toLifeItem(row: ItemRow): LifeItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    dueDate: row.due_date,
    amountCents: row.amount_cents,
    notes: row.notes,
    reminderDays: row.reminder_days,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Colonne inseribili dal client: `owner_id` è valorizzato dal database, `status` parte da `active`. */
export function toInsertRow(input: NewLifeItem): TablesInsert<'life_items'> {
  return {
    ...(input.id !== undefined && { id: input.id }),
    category_id: input.categoryId,
    title: input.title,
    due_date: input.dueDate,
    ...(input.amountCents !== undefined && { amount_cents: input.amountCents }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.reminderDays !== undefined && { reminder_days: [...input.reminderDays] }),
  }
}

/** Include solo i campi presenti nella modifica (nessun valore `undefined` viene inviato). */
export function toUpdateRow(patch: LifeItemPatch): TablesUpdate<'life_items'> {
  return {
    ...(patch.categoryId !== undefined && { category_id: patch.categoryId }),
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.dueDate !== undefined && { due_date: patch.dueDate }),
    ...(patch.amountCents !== undefined && { amount_cents: patch.amountCents }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
    ...(patch.reminderDays !== undefined && { reminder_days: [...patch.reminderDays] }),
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.completedAt !== undefined && { completed_at: patch.completedAt }),
  }
}
