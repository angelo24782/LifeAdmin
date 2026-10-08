import type { AppSupabaseClient } from '@/shared/lib/supabaseClient'
import { toAppError } from '@/shared/lib/errors'

export interface Category {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly icon: string
  readonly sortOrder: number
  /** `true` per le categorie di sistema (`owner_id` nullo). */
  readonly isSystem: boolean
}

const CATEGORY_COLUMNS = 'id, owner_id, slug, name, icon, sort_order'

/** Categorie visibili all'utente: quelle di sistema e le proprie (la RLS esclude le altrui). */
export async function listCategories(client: AppSupabaseClient): Promise<Category[]> {
  const { data, error } = await client
    .from('categories')
    .select(CATEGORY_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw toAppError(error)

  return data.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sort_order,
    isSystem: row.owner_id === null,
  }))
}
