import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listCategories } from '@/features/categories/service'
import { createItem, deleteItem, getItem, listItems, updateItem } from '@/features/items/service'
import type { LifeItem } from '@/features/items/types'
import { getProfile, updateProfile } from '@/features/profile/service'
import { AppError } from '@/shared/lib/errors'

import {
  createAdminClient,
  createAnonClient,
  createTestUser,
  deleteTestUsers,
  systemCategoryId,
  type TestUser,
} from './support'

// Isolamento tra utenti verificato attraverso il percorso reale: supabase-js → PostgREST → RLS.
describe('isolamento A/B via PostgREST', () => {
  const admin = createAdminClient()
  let a: TestUser
  let b: TestUser
  let autoCategoryId: string
  let bPersonalCategoryId: string
  let itemA: LifeItem
  let itemB: LifeItem
  let itemBWithoutRule: LifeItem

  beforeAll(async () => {
    a = await createTestUser(admin, 'a')
    b = await createTestUser(admin, 'b')
    autoCategoryId = await systemCategoryId(admin, 'auto')

    // Categoria personale di B: nell'MVP nessun client può crearla, quindi la inserisce il setup.
    const category = await admin
      .from('categories')
      .insert({ owner_id: b.id, slug: 'mia', name: 'Categoria di B', icon: 'folder' })
      .select('id')
      .single()
    if (category.error) throw category.error
    bPersonalCategoryId = category.data.id

    itemA = await createItem(a.client, {
      categoryId: autoCategoryId,
      title: 'Bollo di A',
      dueDate: '2026-11-30',
    })
    itemB = await createItem(b.client, {
      categoryId: autoCategoryId,
      title: 'Bollo di B',
      dueDate: '2026-11-30',
    })
    itemBWithoutRule = await createItem(b.client, {
      categoryId: autoCategoryId,
      title: 'Revisione di B',
      dueDate: '2027-02-01',
    })
    const rule = await b.client
      .from('recurrence_rules')
      .insert({ item_id: itemB.id, interval_unit: 'year', anchor_date: '2026-11-30' })
    if (rule.error) throw rule.error
  })

  afterAll(async () => {
    // La cancellazione degli utenti elimina a cascata profili, scadenze, regole e categorie personali.
    await deleteTestUsers(admin, [a, b])
  })

  describe('lettura', () => {
    it('A vede solo le proprie scadenze', async () => {
      const items = await listItems(a.client)

      expect(items.map((i) => i.id)).toEqual([itemA.id])
    })

    it('A non può leggere la scadenza di B, nemmeno conoscendone l’id', async () => {
      expect(await getItem(a.client, itemB.id)).toBeNull()
      expect(await getItem(b.client, itemB.id)).not.toBeNull()
    })

    it('A vede categorie di sistema e proprie, mai la categoria personale di B', async () => {
      const forA = await listCategories(a.client)
      const forB = await listCategories(b.client)

      expect(forA.filter((c) => c.isSystem).map((c) => c.slug)).toEqual([
        'auto',
        'assicurazioni',
        'casa',
        'documenti',
        'abbonamenti',
        'contratti',
        'garanzie',
        'altro',
      ])
      expect(forA.map((c) => c.id)).not.toContain(bPersonalCategoryId)
      expect(forB.map((c) => c.id)).toContain(bPersonalCategoryId)
    })

    it('le regole e i completamenti di B non sono visibili ad A', async () => {
      const rules = await a.client.from('recurrence_rules').select('id')
      const completions = await a.client.from('item_completions').select('id')

      expect(rules.error).toBeNull()
      expect(rules.data).toEqual([])
      expect(completions.error).toBeNull()
      expect(completions.data).toEqual([])
    })
  })

  describe('scrittura sui dati altrui', () => {
    it('A non può modificare la scadenza di B', async () => {
      await expect(updateItem(a.client, itemB.id, { title: 'hacked' })).rejects.toMatchObject({
        code: 'not_found',
      })

      const check = await admin.from('life_items').select('title').eq('id', itemB.id).single()
      expect(check.data?.title).toBe('Bollo di B')
    })

    it('A non può cancellare la scadenza di B', async () => {
      expect(await deleteItem(a.client, itemB.id)).toBe(false)

      const check = await admin.from('life_items').select('id').eq('id', itemB.id)
      expect(check.data).toHaveLength(1)
    })

    it('A non può creare una scadenza a nome di B (owner_id non scrivibile)', async () => {
      const { error } = await a.client
        .from('life_items')
        .insert({ owner_id: b.id, category_id: autoCategoryId, title: 'x', due_date: '2027-01-01' })

      expect(error?.code).toBe('42501')
    })

    it('A non può cedere la propria scadenza a B', async () => {
      const { error } = await a.client
        .from('life_items')
        .update({ owner_id: b.id })
        .eq('id', itemA.id)

      expect(error?.code).toBe('42501')
    })
  })

  describe('categoria personale di B (cross-user)', () => {
    it('A NON può creare una scadenza con la categoria personale di B', async () => {
      const { error } = await a.client.from('life_items').insert({
        category_id: bPersonalCategoryId,
        title: 'Con categoria di B',
        due_date: '2027-01-01',
      })

      expect(error?.code).toBe('42501')
      expect(error?.message).toMatch(/row-level security/i)
    })

    it('lo stesso errore arriva dal service come `forbidden`', async () => {
      await expect(
        createItem(a.client, {
          categoryId: bPersonalCategoryId,
          title: 'x',
          dueDate: '2027-01-01',
        }),
      ).rejects.toMatchObject({ code: 'forbidden' })
    })

    it('A non può spostare una propria scadenza nella categoria di B', async () => {
      await expect(
        updateItem(a.client, itemA.id, { categoryId: bPersonalCategoryId }),
      ).rejects.toMatchObject({ code: 'forbidden' })
    })

    it('A PUÒ usare una categoria di sistema', async () => {
      const created = await createItem(a.client, {
        categoryId: await systemCategoryId(admin, 'casa'),
        title: 'Assicurazione casa',
        dueDate: '2027-05-01',
        amountCents: 45000,
        reminderDays: [30, 7],
      })

      const row = await admin.from('life_items').select('owner_id').eq('id', created.id).single()
      expect(row.data?.owner_id).toBe(a.id)
      expect(created.reminderDays).toEqual([30, 7])
      expect(created.status).toBe('active')
    })

    it('B può usare la propria categoria personale', async () => {
      const created = await createItem(b.client, {
        categoryId: bPersonalCategoryId,
        title: 'Con la mia categoria',
        dueDate: '2027-01-01',
      })

      expect(created.categoryId).toBe(bPersonalCategoryId)
    })
  })

  describe('relazioni tra entità (FK composta)', () => {
    it('A non può creare una regola di ricorrenza sulla scadenza di B', async () => {
      const { error } = await a.client
        .from('recurrence_rules')
        .insert({ item_id: itemBWithoutRule.id, interval_unit: 'month', anchor_date: '2026-12-01' })

      expect(error?.code).toBe('23503')
    })

    it('A non può indicare owner_id di B in una regola', async () => {
      const { error } = await a.client.from('recurrence_rules').insert({
        item_id: itemBWithoutRule.id,
        owner_id: b.id,
        interval_unit: 'month',
        anchor_date: '2026-12-01',
      })

      expect(error?.code).toBe('42501')
    })

    it('A può creare una regola sulla propria scadenza e B non la vede', async () => {
      const created = await a.client
        .from('recurrence_rules')
        .insert({ item_id: itemA.id, interval_unit: 'year', anchor_date: '2026-11-30' })
        .select('id, owner_id')
        .single()
      expect(created.error).toBeNull()
      expect(created.data?.owner_id).toBe(a.id)

      const seenByB = await b.client
        .from('recurrence_rules')
        .select('id')
        .eq('id', created.data?.id ?? '')
      expect(seenByB.data).toEqual([])
    })

    it('i client non possono scrivere completamenti', async () => {
      const { error } = await a.client
        .from('item_completions')
        .insert({ item_id: itemA.id, owner_id: a.id, due_date: '2026-01-01' })

      expect(error?.code).toBe('42501')
    })
  })

  describe('profili', () => {
    it('A legge il proprio profilo, non quello di B', async () => {
      const own = await getProfile(a.client, a.id)

      expect(own?.id).toBe(a.id)
      expect(own?.privacyVersion).toBe('2026-10-01')
      expect(await getProfile(a.client, b.id)).toBeNull()
    })

    it('A aggiorna le proprie preferenze ma non quelle di B', async () => {
      const updated = await updateProfile(a.client, a.id, {
        timezone: 'Europe/Berlin',
        notificationHour: 18,
      })

      expect(updated.timezone).toBe('Europe/Berlin')
      await expect(updateProfile(a.client, b.id, { notificationHour: 3 })).rejects.toMatchObject({
        code: 'not_found',
      })
      const check = await admin.from('profiles').select('notification_hour').eq('id', b.id).single()
      expect(check.data?.notification_hour).toBe(9)
    })

    it('un fuso orario non valido è rifiutato', async () => {
      await expect(
        updateProfile(a.client, a.id, { timezone: 'Mars/Olympus' }),
      ).rejects.toMatchObject({
        code: 'invalid_data',
      })
    })

    it('i campi di consenso non sono modificabili dal client', async () => {
      const { error } = await a.client
        .from('profiles')
        .update({ privacy_version: '2026-10-01' })
        .eq('id', a.id)

      expect(error?.code).toBe('42501')
    })

    it('il client non può creare né cancellare profili', async () => {
      const insert = await a.client.from('profiles').insert({
        id: a.id,
        privacy_accepted_at: new Date().toISOString(),
        privacy_version: '2026-10-01',
      })
      const del = await a.client.from('profiles').delete().eq('id', a.id)

      expect(insert.error?.code).toBe('42501')
      expect(del.error?.code).toBe('42501')
    })
  })

  describe('accesso anonimo', () => {
    it.each([
      'profiles',
      'categories',
      'life_items',
      'recurrence_rules',
      'item_completions',
    ] as const)('anon non può leggere %s', async (table) => {
      const { data, error } = await createAnonClient().from(table).select('*')

      expect(error?.code).toBe('42501')
      expect(data).toBeNull()
    })

    it('anon non può scrivere scadenze', async () => {
      const { error } = await createAnonClient()
        .from('life_items')
        .insert({ category_id: autoCategoryId, title: 'x', due_date: '2027-01-01' })

      expect(error?.code).toBe('42501')
    })
  })

  describe('contratto del service', () => {
    it('crea, legge, modifica ed elimina una propria scadenza', async () => {
      const created = await createItem(a.client, {
        categoryId: autoCategoryId,
        title: 'Revisione',
        dueDate: '2027-03-01',
        notes: 'portare il libretto',
      })
      expect((await getItem(a.client, created.id))?.title).toBe('Revisione')

      const updated = await updateItem(a.client, created.id, {
        status: 'completed',
        completedAt: '2027-03-02T10:00:00Z',
      })
      expect(updated.status).toBe('completed')

      expect(await deleteItem(a.client, created.id)).toBe(true)
      expect(await getItem(a.client, created.id)).toBeNull()
    })

    it('mappa gli errori di dominio in `invalid_data`', async () => {
      const error = await createItem(a.client, {
        categoryId: autoCategoryId,
        title: '   ',
        dueDate: '2027-01-01',
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ code: 'invalid_data' })
    })
  })
})
