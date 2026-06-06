export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts_ledger: {
        Row: {
          created_at: string
          gst: string | null
          id: string
          name: string
          notes: string | null
          opening_balance: number
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gst?: string | null
          id?: string
          name: string
          notes?: string | null
          opening_balance?: number
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gst?: string | null
          id?: string
          name?: string
          notes?: string | null
          opening_balance?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      amc_settings: {
        Row: {
          id: number
          terms_template: string
          updated_at: string
        }
        Insert: {
          id?: number
          terms_template?: string
          updated_at?: string
        }
        Update: {
          id?: number
          terms_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      amcs: {
        Row: {
          agreement_no: string
          amc_value: number | null
          client_address: string | null
          client_company: string | null
          client_gst: string | null
          client_name: string
          contact_no: string | null
          created_at: string
          created_by: string | null
          duration_years: number
          email: string | null
          end_date: string
          id: string
          pm_dates: Json
          prev_amc_id: string | null
          remarks: string | null
          start_date: string
          terms: string | null
          units: Json
          updated_at: string
        }
        Insert: {
          agreement_no: string
          amc_value?: number | null
          client_address?: string | null
          client_company?: string | null
          client_gst?: string | null
          client_name: string
          contact_no?: string | null
          created_at?: string
          created_by?: string | null
          duration_years?: number
          email?: string | null
          end_date: string
          id?: string
          pm_dates?: Json
          prev_amc_id?: string | null
          remarks?: string | null
          start_date: string
          terms?: string | null
          units?: Json
          updated_at?: string
        }
        Update: {
          agreement_no?: string
          amc_value?: number | null
          client_address?: string | null
          client_company?: string | null
          client_gst?: string | null
          client_name?: string
          contact_no?: string | null
          created_at?: string
          created_by?: string | null
          duration_years?: number
          email?: string | null
          end_date?: string
          id?: string
          pm_dates?: Json
          prev_amc_id?: string | null
          remarks?: string | null
          start_date?: string
          terms?: string | null
          units?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "amcs_prev_amc_id_fkey"
            columns: ["prev_amc_id"]
            isOneToOne: false
            referencedRelation: "amcs"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          company_id: string | null
          created_at: string
          gstin: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      crm_settings: {
        Row: {
          business_gstin: string | null
          business_state: string
          default_customer_notes: string
          default_terms: string
          id: number
          updated_at: string
        }
        Insert: {
          business_gstin?: string | null
          business_state?: string
          default_customer_notes?: string
          default_terms?: string
          id?: number
          updated_at?: string
        }
        Update: {
          business_gstin?: string | null
          business_state?: string
          default_customer_notes?: string
          default_terms?: string
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          billing_address: string | null
          city: string | null
          company: string
          contact_name: string | null
          contacts: Json
          country: string | null
          created_at: string
          created_by: string | null
          email: string | null
          gst: string | null
          gst_status: string
          id: string
          phone: string | null
          remarks: string | null
          shipping_address: string | null
          state: string | null
          street: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          billing_address?: string | null
          city?: string | null
          company: string
          contact_name?: string | null
          contacts?: Json
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst?: string | null
          gst_status?: string
          id?: string
          phone?: string | null
          remarks?: string | null
          shipping_address?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          billing_address?: string | null
          city?: string | null
          company?: string
          contact_name?: string | null
          contacts?: Json
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst?: string | null
          gst_status?: string
          id?: string
          phone?: string | null
          remarks?: string | null
          shipping_address?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          active: boolean
          created_at: string
          department: string | null
          email: string | null
          id: string
          joining_date: string | null
          name: string
          notes: string | null
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department?: string | null
          email?: string | null
          id?: string
          joining_date?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: string | null
          email?: string | null
          id?: string
          joining_date?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gatepasses: {
        Row: {
          authorised_by: string | null
          challan_no: string
          contact_no: string | null
          created_at: string
          created_by: string | null
          destination: string | null
          gatepass_date: string
          gatepass_time: string
          id: string
          items: Json
          person_company: string | null
          person_name: string
          prepared_by: string | null
          purpose: string | null
          remarks: string | null
          return_type: string
          vehicle_no: string | null
        }
        Insert: {
          authorised_by?: string | null
          challan_no: string
          contact_no?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          gatepass_date?: string
          gatepass_time?: string
          id?: string
          items?: Json
          person_company?: string | null
          person_name: string
          prepared_by?: string | null
          purpose?: string | null
          remarks?: string | null
          return_type?: string
          vehicle_no?: string | null
        }
        Update: {
          authorised_by?: string | null
          challan_no?: string
          contact_no?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          gatepass_date?: string
          gatepass_time?: string
          id?: string
          items?: Json
          person_company?: string | null
          person_name?: string
          prepared_by?: string | null
          purpose?: string | null
          remarks?: string | null
          return_type?: string
          vehicle_no?: string | null
        }
        Relationships: []
      }
      incentive_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          max_value: number | null
          min_value: number
          percent: number
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          max_value?: number | null
          min_value?: number
          percent?: number
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          max_value?: number | null
          min_value?: number
          percent?: number
          sort_order?: number
        }
        Relationships: []
      }
      incentives: {
        Row: {
          applied_percent: number
          closed_value: number
          created_at: string
          id: string
          lead_id: string | null
          notes: string | null
          owner_id: string
          paid_at: string | null
          payout: number
          period: string | null
          status: string
        }
        Insert: {
          applied_percent?: number
          closed_value?: number
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          owner_id: string
          paid_at?: string | null
          payout?: number
          period?: string | null
          status?: string
        }
        Update: {
          applied_percent?: number
          closed_value?: number
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          owner_id?: string
          paid_at?: string | null
          payout?: number
          period?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "incentives_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          created_at: string
          id: string
          location: string | null
          notes: string | null
          product_id: string | null
          product_name: string | null
          quantity: number
          serial_no: string | null
          updated_at: string
          warehouse: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          notes?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          serial_no?: string | null
          updated_at?: string
          warehouse?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          notes?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          serial_no?: string | null
          updated_at?: string
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          activity_date: string
          created_at: string
          id: string
          kind: string
          lead_id: string
          next_followup: string | null
          notes: string | null
          owner_id: string
        }
        Insert: {
          activity_date?: string
          created_at?: string
          id?: string
          kind?: string
          lead_id: string
          next_followup?: string | null
          notes?: string | null
          owner_id: string
        }
        Update: {
          activity_date?: string
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string
          next_followup?: string | null
          notes?: string | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          closed_at: string | null
          closed_value: number | null
          created_at: string
          customer_id: string
          expected_value: number | null
          id: string
          next_followup: string | null
          owner_id: string
          remarks: string | null
          source: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_value?: number | null
          created_at?: string
          customer_id: string
          expected_value?: number | null
          id?: string
          next_followup?: string | null
          owner_id: string
          remarks?: string | null
          source?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_value?: number | null
          created_at?: string
          customer_id?: string
          expected_value?: number | null
          id?: string
          next_followup?: string | null
          owner_id?: string
          remarks?: string | null
          source?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_visits: {
        Row: {
          amc_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          scheduled_date: string
          updated_at: string
        }
        Insert: {
          amc_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          scheduled_date: string
          updated_at?: string
        }
        Update: {
          amc_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          scheduled_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_visits_amc_id_fkey"
            columns: ["amc_id"]
            isOneToOne: false
            referencedRelation: "amcs"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          id: string
          name: string
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          unit?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          unit?: string
        }
        Relationships: []
      }
      quotations: {
        Row: {
          adjustment: number
          attachments: Json
          billing_address: string | null
          cgst_amount: number
          created_at: string
          customer_id: string | null
          customer_notes: string | null
          discount_amount: number
          expiry_date: string | null
          gst_amount: number
          gst_percent: number
          id: string
          igst_amount: number
          items: Json
          lead_id: string | null
          owner_id: string
          place_of_supply: string | null
          project_name: string | null
          quote_date: string
          quote_no: string
          reference_no: string | null
          remarks: string | null
          round_off: number
          salesperson: string | null
          sgst_amount: number
          shipping_address: string | null
          shipping_charges: number
          status: string
          subject: string | null
          subtotal: number
          tcs_amount: number
          tcs_percent: number
          terms: string | null
          total: number
          updated_at: string
          validity_days: number
        }
        Insert: {
          adjustment?: number
          attachments?: Json
          billing_address?: string | null
          cgst_amount?: number
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          discount_amount?: number
          expiry_date?: string | null
          gst_amount?: number
          gst_percent?: number
          id?: string
          igst_amount?: number
          items?: Json
          lead_id?: string | null
          owner_id: string
          place_of_supply?: string | null
          project_name?: string | null
          quote_date?: string
          quote_no: string
          reference_no?: string | null
          remarks?: string | null
          round_off?: number
          salesperson?: string | null
          sgst_amount?: number
          shipping_address?: string | null
          shipping_charges?: number
          status?: string
          subject?: string | null
          subtotal?: number
          tcs_amount?: number
          tcs_percent?: number
          terms?: string | null
          total?: number
          updated_at?: string
          validity_days?: number
        }
        Update: {
          adjustment?: number
          attachments?: Json
          billing_address?: string | null
          cgst_amount?: number
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          discount_amount?: number
          expiry_date?: string | null
          gst_amount?: number
          gst_percent?: number
          id?: string
          igst_amount?: number
          items?: Json
          lead_id?: string | null
          owner_id?: string
          place_of_supply?: string | null
          project_name?: string | null
          quote_date?: string
          quote_no?: string
          reference_no?: string | null
          remarks?: string | null
          round_off?: number
          salesperson?: string | null
          sgst_amount?: number
          shipping_address?: string | null
          shipping_charges?: number
          status?: string
          subject?: string | null
          subtotal?: number
          tcs_amount?: number
          tcs_percent?: number
          terms?: string | null
          total?: number
          updated_at?: string
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_terms_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      ticket_activities: {
        Row: {
          actor: string | null
          created_at: string
          from_status: string | null
          id: string
          kind: string
          notes: string | null
          ticket_id: string
          to_status: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          kind?: string
          notes?: string | null
          ticket_id: string
          to_status?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          kind?: string
          notes?: string | null
          ticket_id?: string
          to_status?: string | null
        }
        Relationships: []
      }
      tickets: {
        Row: {
          assigned_at: string | null
          assigned_engineer_name: string | null
          assigned_engineer_phone: string | null
          attachments: Json
          call_type: string
          case_id: string
          closed_at: string | null
          complaint: string | null
          created_at: string
          created_by: string | null
          customer_address: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          id: string
          location: string | null
          parts_details: Json
          parts_used: boolean
          product: string | null
          quotation_id: string | null
          remarks: string | null
          serial_no: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_engineer_name?: string | null
          assigned_engineer_phone?: string | null
          attachments?: Json
          call_type?: string
          case_id: string
          closed_at?: string | null
          complaint?: string | null
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          id?: string
          location?: string | null
          parts_details?: Json
          parts_used?: boolean
          product?: string | null
          quotation_id?: string | null
          remarks?: string | null
          serial_no?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_engineer_name?: string | null
          assigned_engineer_phone?: string | null
          attachments?: Json
          call_type?: string
          case_id?: string
          closed_at?: string | null
          complaint?: string | null
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          id?: string
          location?: string | null
          parts_details?: Json
          parts_used?: boolean
          product?: string | null
          quotation_id?: string | null
          remarks?: string | null
          serial_no?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wa_templates: {
        Row: {
          body: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          body?: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
