import { toAppError } from '@/shared/lib/errors'
import type { AppSupabaseClient } from '@/shared/lib/supabaseClient'
import type { Tables } from '@/shared/types/database'

export interface Profile {
  readonly id: string
  readonly displayName: string | null
  readonly timezone: string
  readonly locale: string
  readonly emailNotificationsEnabled: boolean
  readonly notificationHour: number
  readonly onboardingCompletedAt: string | null
  readonly privacyAcceptedAt: string
  readonly privacyVersion: string
}

/** Preferenze modificabili dall'utente (le altre colonne non hanno privilegio di UPDATE). */
export interface ProfilePatch {
  readonly displayName?: string | null
  readonly timezone?: string
  readonly emailNotificationsEnabled?: boolean
  readonly notificationHour?: number
  readonly onboardingCompletedAt?: string | null
}

const PROFILE_COLUMNS =
  'id, display_name, timezone, locale, email_notifications_enabled, notification_hour, onboarding_completed_at, privacy_accepted_at, privacy_version'

type ProfileRow = Pick<
  Tables<'profiles'>,
  | 'id'
  | 'display_name'
  | 'timezone'
  | 'locale'
  | 'email_notifications_enabled'
  | 'notification_hour'
  | 'onboarding_completed_at'
  | 'privacy_accepted_at'
  | 'privacy_version'
>

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    timezone: row.timezone,
    locale: row.locale,
    emailNotificationsEnabled: row.email_notifications_enabled,
    notificationHour: row.notification_hour,
    onboardingCompletedAt: row.onboarding_completed_at,
    privacyAcceptedAt: row.privacy_accepted_at,
    privacyVersion: row.privacy_version,
  }
}

/** Legge il profilo dell'utente indicato; `null` se non esiste o non è visibile (RLS). */
export async function getProfile(
  client: AppSupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle()

  if (error) throw toAppError(error)
  return data ? toProfile(data) : null
}

/** Aggiorna le preferenze dell'utente. Lancia `not_found` se la riga non è accessibile. */
export async function updateProfile(
  client: AppSupabaseClient,
  userId: string,
  patch: ProfilePatch,
): Promise<Profile> {
  const row = {
    ...(patch.displayName !== undefined && { display_name: patch.displayName }),
    ...(patch.timezone !== undefined && { timezone: patch.timezone }),
    ...(patch.emailNotificationsEnabled !== undefined && {
      email_notifications_enabled: patch.emailNotificationsEnabled,
    }),
    ...(patch.notificationHour !== undefined && { notification_hour: patch.notificationHour }),
    ...(patch.onboardingCompletedAt !== undefined && {
      onboarding_completed_at: patch.onboardingCompletedAt,
    }),
  }

  const { data, error } = await client
    .from('profiles')
    .update(row)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle()

  if (error) throw toAppError(error)
  if (!data) throw toAppError({ code: 'PGRST116', message: 'profile not found' })
  return toProfile(data)
}
