
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "categories": {
                  Row: {
                    "created_at": string,"icon": string,"id": string,"name": string,"owner_id": string | null,"slug": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"icon": string,"id"?: string,"name": string,"owner_id"?: string | null,"slug": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"icon"?: string,"id"?: string,"name"?: string,"owner_id"?: string | null,"slug"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"item_completions": {
                  Row: {
                    "completed_at": string,"due_date": string,"id": string,"item_id": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string,"due_date": string,"id"?: string,"item_id": string,"owner_id": string
                  }
                  Update: {
                    "completed_at"?: string,"due_date"?: string,"id"?: string,"item_id"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_completions_item_owner_fkey"
      columns: ["item_id","owner_id"]
isOneToOne: false
      referencedRelation: "life_items"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"life_items": {
                  Row: {
                    "amount_cents": number | null,"category_id": string,"completed_at": string | null,"created_at": string,"due_date": string,"id": string,"notes": string | null,"owner_id": string,"reminder_days": (number)[],"status": Database["public"]['Enums']["item_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"category_id": string,"completed_at"?: string | null,"created_at"?: string,"due_date": string,"id"?: string,"notes"?: string | null,"owner_id"?: string,"reminder_days"?: (number)[],"status"?: Database["public"]['Enums']["item_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number | null,"category_id"?: string,"completed_at"?: string | null,"created_at"?: string,"due_date"?: string,"id"?: string,"notes"?: string | null,"owner_id"?: string,"reminder_days"?: (number)[],"status"?: Database["public"]['Enums']["item_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "life_items_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"email_notifications_enabled": boolean,"id": string,"locale": string,"notification_hour": number,"onboarding_completed_at": string | null,"password_setup_pending": boolean,"privacy_accepted_at": string,"privacy_version": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"email_notifications_enabled"?: boolean,"id": string,"locale"?: string,"notification_hour"?: number,"onboarding_completed_at"?: string | null,"password_setup_pending"?: boolean,"privacy_accepted_at": string,"privacy_version": string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"email_notifications_enabled"?: boolean,"id"?: string,"locale"?: string,"notification_hour"?: number,"onboarding_completed_at"?: string | null,"password_setup_pending"?: boolean,"privacy_accepted_at"?: string,"privacy_version"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recurrence_rules": {
                  Row: {
                    "anchor_date": string,"created_at": string,"id": string,"interval_count": number,"interval_unit": Database["public"]['Enums']["recurrence_unit"],"item_id": string,"owner_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "anchor_date": string,"created_at"?: string,"id"?: string,"interval_count"?: number,"interval_unit": Database["public"]['Enums']["recurrence_unit"],"item_id": string,"owner_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "anchor_date"?: string,"created_at"?: string,"id"?: string,"interval_count"?: number,"interval_unit"?: Database["public"]['Enums']["recurrence_unit"],"item_id"?: string,"owner_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurrence_rules_item_owner_fkey"
      columns: ["item_id","owner_id"]
isOneToOne: false
      referencedRelation: "life_items"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "item_status": "active"|"completed","recurrence_unit": "day"|"week"|"month"|"year"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "item_status": ["active", "completed"],"recurrence_unit": ["day", "week", "month", "year"]
          }
        }
} as const
