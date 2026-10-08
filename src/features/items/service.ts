import { toAppError } from '@/shared/lib/errors'
import type { AppSupabaseClient } from '@/shared/lib/supabaseClient'

import { ITEM_COLUMNS, toInsertRow, toLifeItem, toUpdateRow } from './mappers'
import type { LifeItem, LifeItemPatch, NewLifeItem } from './types'

/**
 * Accesso ai dati delle scadenze. Solo CRUD sui campi della tabella: ricorrenza, completamento e
 * avvisi sono logica di milestone successive. L'isolamento tra utenti è garantito dalla RLS: qui non
 * si filtra mai per `owner_id`.
 */

export async function listItems(client: AppSupabaseClient): Promise<LifeItem[]> {
  const { data, error } = await client
    .from('life_items')
    .select(ITEM_COLUMNS)
    .order('due_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw toAppError(error)
  return data.map(toLifeItem)
}

/** `null` se la scadenza non esiste **o non appartiene all'utente** (i due casi sono indistinguibili). */
export async function getItem(client: AppSupabaseClient, id: string): Promise<LifeItem | null> {
  const { data, error } = await client
    .from('life_items')
    .select(ITEM_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) throw toAppError(error)
  return data ? toLifeItem(data) : null
}

export async function createItem(client: AppSupabaseClient, input: NewLifeItem): Promise<LifeItem> {
  const { data, error } = await client
    .from('life_items')
    .insert(toInsertRow(input))
    .select(ITEM_COLUMNS)
    .single()

  if (error) throw toAppError(error)
  return toLifeItem(data)
}

/** Lancia `not_found` se la scadenza non esiste o non appartiene all'utente. */
export async function updateItem(
  client: AppSupabaseClient,
  id: string,
  patch: LifeItemPatch,
): Promise<LifeItem> {
  const { data, error } = await client
    .from('life_items')
    .update(toUpdateRow(patch))
    .eq('id', id)
    .select(ITEM_COLUMNS)
    .maybeSingle()

  if (error) throw toAppError(error)
  if (!data) throw toAppError({ code: 'PGRST116', message: 'life item not found' })
  return toLifeItem(data)
}

/** Restituisce `true` se una riga è stata eliminata, `false` se non c'era (o non è dell'utente). */
export async function deleteItem(client: AppSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client.from('life_items').delete().eq('id', id).select('id')

  if (error) throw toAppError(error)
  return data.length > 0
}
