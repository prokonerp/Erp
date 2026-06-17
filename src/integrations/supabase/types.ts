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
      amc_sequence: {
        Row: {
          id: number
          last_seq: number
        }
        Insert: {
          id?: number
          last_seq?: number
        }
        Update: {
          id?: number
          last_seq?: number
        }
        Relationships: []
      }
      amc_settings: {
        Row: {
          id: number
          prefix: string
          terms_template: string
          updated_at: string
        }
        Insert: {
          id?: number
          prefix?: string
          terms_template?: string
          updated_at?: string
        }
        Update: {
          id?: number
          prefix?: string
          terms_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      amcs: {
        Row: {
          agreement_doc_path: string | null
          agreement_no: string
          amc_value: number | null
          client_address: string | null
          client_company: string | null
          client_gst: string | null
          client_name: string
          contact_no: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          duration_years: number
          email: string | null
          end_date: string
          id: string
          oem_brand: string | null
          oem_call: boolean
          oem_purchase_date: string | null
          oem_ref_id: string | null
          pm_dates: Json
          prev_amc_id: string | null
          remarks: string | null
          start_date: string
          terms: string | null
          units: Json
          updated_at: string
        }
        Insert: {
          agreement_doc_path?: string | null
          agreement_no: string
          amc_value?: number | null
          client_address?: string | null
          client_company?: string | null
          client_gst?: string | null
          client_name: string
          contact_no?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          duration_years?: number
          email?: string | null
          end_date: string
          id?: string
          oem_brand?: string | null
          oem_call?: boolean
          oem_purchase_date?: string | null
          oem_ref_id?: string | null
          pm_dates?: Json
          prev_amc_id?: string | null
          remarks?: string | null
          start_date: string
          terms?: string | null
          units?: Json
          updated_at?: string
        }
        Update: {
          agreement_doc_path?: string | null
          agreement_no?: string
          amc_value?: number | null
          client_address?: string | null
          client_company?: string | null
          client_gst?: string | null
          client_name?: string
          contact_no?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          duration_years?: number
          email?: string | null
          end_date?: string
          id?: string
          oem_brand?: string | null
          oem_call?: boolean
          oem_purchase_date?: string | null
          oem_ref_id?: string | null
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
            foreignKeyName: "amcs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amcs_prev_amc_id_fkey"
            columns: ["prev_amc_id"]
            isOneToOne: false
            referencedRelation: "amcs"
            referencedColumns: ["id"]
          },
        ]
      }
      app_modules: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          supports_import: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          supports_import?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          supports_import?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      app_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          custom_permissions: Json | null
          email: string | null
          must_change_password: boolean
          name: string | null
          password_changed_at: string
          phone: string | null
          role_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_permissions?: Json | null
          email?: string | null
          must_change_password?: boolean
          name?: string | null
          password_changed_at?: string
          phone?: string | null
          role_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_permissions?: Json | null
          email?: string | null
          must_change_password?: boolean
          name?: string | null
          password_changed_at?: string
          phone?: string | null
          role_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "app_roles"
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
      call_type_master: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
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
          billing_city: string | null
          billing_country: string | null
          billing_landmark: string | null
          billing_line1: string | null
          billing_line2: string | null
          billing_pincode: string | null
          billing_state: string | null
          city: string | null
          company: string
          contact_name: string | null
          contacts: Json
          country: string | null
          created_at: string
          created_by: string | null
          customer_type: string
          email: string | null
          first_name: string | null
          gst: string | null
          gst_status: string
          id: string
          last_name: string | null
          pan: string | null
          phone: string | null
          phone_area_code: string | null
          place_of_supply: string | null
          remarks: string | null
          salutation: string | null
          sector: string | null
          shipping_address: string | null
          shipping_city: string | null
          shipping_country: string | null
          shipping_landmark: string | null
          shipping_line1: string | null
          shipping_line2: string | null
          shipping_pincode: string | null
          shipping_state: string | null
          state: string | null
          street: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_landmark?: string | null
          billing_line1?: string | null
          billing_line2?: string | null
          billing_pincode?: string | null
          billing_state?: string | null
          city?: string | null
          company: string
          contact_name?: string | null
          contacts?: Json
          country?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: string
          email?: string | null
          first_name?: string | null
          gst?: string | null
          gst_status?: string
          id?: string
          last_name?: string | null
          pan?: string | null
          phone?: string | null
          phone_area_code?: string | null
          place_of_supply?: string | null
          remarks?: string | null
          salutation?: string | null
          sector?: string | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_country?: string | null
          shipping_landmark?: string | null
          shipping_line1?: string | null
          shipping_line2?: string | null
          shipping_pincode?: string | null
          shipping_state?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_landmark?: string | null
          billing_line1?: string | null
          billing_line2?: string | null
          billing_pincode?: string | null
          billing_state?: string | null
          city?: string | null
          company?: string
          contact_name?: string | null
          contacts?: Json
          country?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: string
          email?: string | null
          first_name?: string | null
          gst?: string | null
          gst_status?: string
          id?: string
          last_name?: string | null
          pan?: string | null
          phone?: string | null
          phone_area_code?: string | null
          place_of_supply?: string | null
          remarks?: string | null
          salutation?: string | null
          sector?: string | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_country?: string | null
          shipping_landmark?: string | null
          shipping_line1?: string | null
          shipping_line2?: string | null
          shipping_pincode?: string | null
          shipping_state?: string | null
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
      indent_sequence: {
        Row: {
          id: number
          last_seq: number
        }
        Insert: {
          id?: number
          last_seq?: number
        }
        Update: {
          id?: number
          last_seq?: number
        }
        Relationships: []
      }
      indents: {
        Row: {
          case_id: string | null
          company: string | null
          created_at: string
          created_by: string | null
          def_model_no: string | null
          def_serial_no: string | null
          engineer_name: string | null
          id: string
          indent_city: string | null
          indent_date: string
          indent_no: string | null
          indent_type: Database["public"]["Enums"]["indent_type"] | null
          material_exchange_model: string | null
          material_exchange_serial_no: string | null
          material_rec_date: string | null
          material_rec_model_no: string | null
          material_rec_serial_no: string | null
          oem_case_id: string | null
          oracles: string | null
          problem_reported: string | null
          product_model: string | null
          product_serial: string | null
          remarks: string | null
          ticket_id: string
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          def_model_no?: string | null
          def_serial_no?: string | null
          engineer_name?: string | null
          id?: string
          indent_city?: string | null
          indent_date?: string
          indent_no?: string | null
          indent_type?: Database["public"]["Enums"]["indent_type"] | null
          material_exchange_model?: string | null
          material_exchange_serial_no?: string | null
          material_rec_date?: string | null
          material_rec_model_no?: string | null
          material_rec_serial_no?: string | null
          oem_case_id?: string | null
          oracles?: string | null
          problem_reported?: string | null
          product_model?: string | null
          product_serial?: string | null
          remarks?: string | null
          ticket_id: string
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          def_model_no?: string | null
          def_serial_no?: string | null
          engineer_name?: string | null
          id?: string
          indent_city?: string | null
          indent_date?: string
          indent_no?: string | null
          indent_type?: Database["public"]["Enums"]["indent_type"] | null
          material_exchange_model?: string | null
          material_exchange_serial_no?: string | null
          material_rec_date?: string | null
          material_rec_model_no?: string | null
          material_rec_serial_no?: string | null
          oem_case_id?: string | null
          oracles?: string | null
          problem_reported?: string | null
          product_model?: string | null
          product_serial?: string | null
          remarks?: string | null
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "indents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
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
          warehouse_id: string | null
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
          warehouse_id?: string | null
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
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
      oem_brand_master: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      password_history: {
        Row: {
          created_at: string
          id: string
          password_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          password_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          password_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      pm_visits: {
        Row: {
          amc_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          oem_brand: string | null
          oem_call: boolean
          oem_purchase_date: string | null
          oem_ref_id: string | null
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
          oem_brand?: string | null
          oem_call?: boolean
          oem_purchase_date?: string | null
          oem_ref_id?: string | null
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
          oem_brand?: string | null
          oem_call?: boolean
          oem_purchase_date?: string | null
          oem_ref_id?: string | null
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
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          brand: string | null
          category: string | null
          central_tax_exempt: boolean
          central_tax_rate: number | null
          created_at: string
          default_price: number | null
          description: string | null
          hsn: string | null
          id: string
          local_tax_exempt: boolean
          local_tax_rate: number | null
          model: string | null
          name: string | null
          serial_format: string | null
          serial_mode: string
          serial_tracking: boolean
          sku: string | null
          tax_rate: number | null
          unit: string
          updated_at: string
          warranty_applicable: boolean
          warranty_duration: number | null
          warranty_manual_override: boolean
          warranty_start_from: string | null
          warranty_type: string | null
          warranty_unit: string | null
        }
        Insert: {
          active?: boolean
          brand?: string | null
          category?: string | null
          central_tax_exempt?: boolean
          central_tax_rate?: number | null
          created_at?: string
          default_price?: number | null
          description?: string | null
          hsn?: string | null
          id?: string
          local_tax_exempt?: boolean
          local_tax_rate?: number | null
          model?: string | null
          name?: string | null
          serial_format?: string | null
          serial_mode?: string
          serial_tracking?: boolean
          sku?: string | null
          tax_rate?: number | null
          unit?: string
          updated_at?: string
          warranty_applicable?: boolean
          warranty_duration?: number | null
          warranty_manual_override?: boolean
          warranty_start_from?: string | null
          warranty_type?: string | null
          warranty_unit?: string | null
        }
        Update: {
          active?: boolean
          brand?: string | null
          category?: string | null
          central_tax_exempt?: boolean
          central_tax_rate?: number | null
          created_at?: string
          default_price?: number | null
          description?: string | null
          hsn?: string | null
          id?: string
          local_tax_exempt?: boolean
          local_tax_rate?: number | null
          model?: string | null
          name?: string | null
          serial_format?: string | null
          serial_mode?: string
          serial_tracking?: boolean
          sku?: string | null
          tax_rate?: number | null
          unit?: string
          updated_at?: string
          warranty_applicable?: boolean
          warranty_duration?: number | null
          warranty_manual_override?: boolean
          warranty_start_from?: string | null
          warranty_type?: string | null
          warranty_unit?: string | null
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
      role_module_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_import: boolean
          can_read: boolean
          created_at: string
          enable_access: boolean
          id: string
          module: string
          role_id: string
          updated_at: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_read?: boolean
          created_at?: string
          enable_access?: boolean
          id?: string
          module: string
          role_id: string
          updated_at?: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_read?: boolean
          created_at?: string
          enable_access?: boolean
          id?: string
          module?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_module_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "app_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      serials: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          installation_date: string | null
          notes: string | null
          product_id: string
          purchase_date: string | null
          purchase_invoice_no: string | null
          sale_invoice_no: string | null
          serial_number: string
          status: string
          supplier_id: string | null
          updated_at: string
          warehouse_id: string | null
          warranty_end_date: string | null
          warranty_start_date: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          installation_date?: string | null
          notes?: string | null
          product_id: string
          purchase_date?: string | null
          purchase_invoice_no?: string | null
          sale_invoice_no?: string | null
          serial_number: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          warehouse_id?: string | null
          warranty_end_date?: string | null
          warranty_start_date?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          installation_date?: string | null
          notes?: string | null
          product_id?: string
          purchase_date?: string | null
          purchase_invoice_no?: string | null
          sale_invoice_no?: string | null
          serial_number?: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          warehouse_id?: string | null
          warranty_end_date?: string | null
          warranty_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "serials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serials_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serials_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_activities: {
        Row: {
          actor: string | null
          created_at: string
          from_status: string | null
          id: string
          kind: string
          notes: string | null
          special_instruction: boolean
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
          special_instruction?: boolean
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
          special_instruction?: boolean
          ticket_id?: string
          to_status?: string | null
        }
        Relationships: []
      }
      ticket_sequence: {
        Row: {
          id: number
          last_seq: number
        }
        Insert: {
          id?: number
          last_seq?: number
        }
        Update: {
          id?: number
          last_seq?: number
        }
        Relationships: []
      }
      ticket_settings: {
        Row: {
          id: number
          prefix: string
          updated_at: string
        }
        Insert: {
          id?: number
          prefix?: string
          updated_at?: string
        }
        Update: {
          id?: number
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          amc_id: string | null
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
          deleted_at: string | null
          id: string
          location: string | null
          oem_brand: string | null
          oem_call: boolean
          oem_purchase_date: string | null
          oem_ref_id: string | null
          parts_details: Json
          parts_used: boolean
          pm_visit_id: string | null
          preferred_visit_datetime: string | null
          priority: string | null
          product: string | null
          quotation_id: string | null
          raised_by_name: string | null
          raised_by_type: string | null
          remarks: string | null
          sector: string | null
          serial_no: string | null
          source: string | null
          special_instruction: string | null
          special_instruction_acknowledged: boolean
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amc_id?: string | null
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
          deleted_at?: string | null
          id?: string
          location?: string | null
          oem_brand?: string | null
          oem_call?: boolean
          oem_purchase_date?: string | null
          oem_ref_id?: string | null
          parts_details?: Json
          parts_used?: boolean
          pm_visit_id?: string | null
          preferred_visit_datetime?: string | null
          priority?: string | null
          product?: string | null
          quotation_id?: string | null
          raised_by_name?: string | null
          raised_by_type?: string | null
          remarks?: string | null
          sector?: string | null
          serial_no?: string | null
          source?: string | null
          special_instruction?: string | null
          special_instruction_acknowledged?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amc_id?: string | null
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
          deleted_at?: string | null
          id?: string
          location?: string | null
          oem_brand?: string | null
          oem_call?: boolean
          oem_purchase_date?: string | null
          oem_ref_id?: string | null
          parts_details?: Json
          parts_used?: boolean
          pm_visit_id?: string | null
          preferred_visit_datetime?: string | null
          priority?: string | null
          product?: string | null
          quotation_id?: string | null
          raised_by_name?: string | null
          raised_by_type?: string | null
          remarks?: string | null
          sector?: string | null
          serial_no?: string | null
          source?: string | null
          special_instruction?: string | null
          special_instruction_acknowledged?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_amc_id_fkey"
            columns: ["amc_id"]
            isOneToOne: false
            referencedRelation: "amcs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_pm_visit_id_fkey"
            columns: ["pm_visit_id"]
            isOneToOne: false
            referencedRelation: "pm_visits"
            referencedColumns: ["id"]
          },
        ]
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
      warehouses: {
        Row: {
          address: string | null
          city: string | null
          code: string
          contact_number: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          pincode: string | null
          remarks: string | null
          state: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          pincode?: string | null
          remarks?: string | null
          state?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          pincode?: string | null
          remarks?: string | null
          state?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_permission: {
        Args: { _action: string; _module: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_amc_seq: { Args: never; Returns: number }
      next_indent_seq: { Args: never; Returns: number }
      next_ticket_seq: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
      indent_type: "rma_advance_exchange" | "rma_exchange" | "rma_service_ship"
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
      indent_type: ["rma_advance_exchange", "rma_exchange", "rma_service_ship"],
    },
  },
} as const
