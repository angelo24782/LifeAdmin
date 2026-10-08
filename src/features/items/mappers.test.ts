import { describe, expect, it } from 'vitest'

import { ITEM_COLUMNS, toInsertRow, toLifeItem, toUpdateRow, type ItemRow } from './mappers'

describe('life item mappers', () => {
  it('maps a database row to the application model', () => {
    const row: ItemRow = {
      id: 'i1',
      category_id: 'c1',
      title: 'Assicurazione auto',
      due_date: '2026-12-15',
      amount_cents: 65000,
      notes: null,
      reminder_days: [30, 7, 1],
      status: 'active',
      completed_at: null,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
    }

    expect(toLifeItem(row)).toEqual({
      id: 'i1',
      categoryId: 'c1',
      title: 'Assicurazione auto',
      dueDate: '2026-12-15',
      amountCents: 65000,
      notes: null,
      reminderDays: [30, 7, 1],
      status: 'active',
      completedAt: null,
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-10-02T10:00:00Z',
    })
  })

  it('builds an insert row without owner_id or status, omitting unset optional fields', () => {
    const row = toInsertRow({ categoryId: 'c1', title: 'Bollo', dueDate: '2026-11-30' })

    expect(row).toEqual({ category_id: 'c1', title: 'Bollo', due_date: '2026-11-30' })
    expect(row).not.toHaveProperty('owner_id')
    expect(row).not.toHaveProperty('status')
  })

  it('keeps explicit nulls and copies reminder days on insert', () => {
    const reminders = [14, 3]
    const row = toInsertRow({
      id: 'client-id',
      categoryId: 'c1',
      title: 'Bollo',
      dueDate: '2026-11-30',
      amountCents: null,
      notes: null,
      reminderDays: reminders,
    })

    expect(row).toMatchObject({ id: 'client-id', amount_cents: null, notes: null })
    expect(row.reminder_days).toEqual([14, 3])
    expect(row.reminder_days).not.toBe(reminders)
  })

  it('builds a sparse update row with only the provided fields', () => {
    expect(toUpdateRow({ title: 'Nuovo', amountCents: null })).toEqual({
      title: 'Nuovo',
      amount_cents: null,
    })
    expect(toUpdateRow({})).toEqual({})
  })

  it('maps completion fields on update', () => {
    expect(toUpdateRow({ status: 'completed', completedAt: '2027-01-01T00:00:00Z' })).toEqual({
      status: 'completed',
      completed_at: '2027-01-01T00:00:00Z',
    })
  })

  it('selects an explicit list of columns, never a wildcard', () => {
    expect(ITEM_COLUMNS).not.toContain('*')
    expect(ITEM_COLUMNS.split(',').map((c) => c.trim())).toContain('due_date')
  })
})
