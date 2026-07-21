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
          deleted_at: string | null
          deleted_by: string | null
          duration_years: number
          email: string | null
          end_date: string
          id: string
          is_deleted: boolean
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
          deleted_at?: string | null
          deleted_by?: string | null
          duration_years?: number
          email?: string | null
          end_date: string
          id?: string
          is_deleted?: boolean
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
          deleted_at?: string | null
          deleted_by?: string | null
          duration_years?: number
          email?: string | null
          end_date?: string
          id?: string
          is_deleted?: boolean
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
          last_activity: string | null
          last_login: string | null
          last_logout: string | null
          login_count: number
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
          last_activity?: string | null
          last_login?: string | null
          last_logout?: string | null
          login_count?: number
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
          last_activity?: string | null
          last_login?: string | null
          last_logout?: string | null
          login_count?: number
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
      battery_catalog: {
        Row: {
          active: boolean
          ah: number
          brand: string | null
          created_at: string
          id: string
          model: string | null
          price: number
          product_id: string | null
          tier: string
          updated_at: string
          voltage: number
        }
        Insert: {
          active?: boolean
          ah: number
          brand?: string | null
          created_at?: string
          id?: string
          model?: string | null
          price?: number
          product_id?: string | null
          tier?: string
          updated_at?: string
          voltage?: number
        }
        Update: {
          active?: boolean
          ah?: number
          brand?: string | null
          created_at?: string
          id?: string
          model?: string | null
          price?: number
          product_id?: string | null
          tier?: string
          updated_at?: string
          voltage?: number
        }
        Relationships: [
          {
            foreignKeyName: "battery_catalog_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          active: boolean
          address: string | null
          bank_account: string | null
          bank_branch: string | null
          bank_ifsc: string | null
          bank_name: string | null
          cin: string | null
          city: string | null
          code: string | null
          company_id: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          invoice_footer: string | null
          is_default: boolean
          logo_url: string | null
          name: string
          pan: string | null
          phone: string | null
          pin_code: string | null
          state_code: string | null
          state_name: string | null
          updated_at: string
          upi_id: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          bank_account?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          cin?: string | null
          city?: string | null
          code?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          invoice_footer?: string | null
          is_default?: boolean
          logo_url?: string | null
          name: string
          pan?: string | null
          phone?: string | null
          pin_code?: string | null
          state_code?: string | null
          state_name?: string | null
          updated_at?: string
          upi_id?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          bank_account?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          cin?: string | null
          city?: string | null
          code?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          invoice_footer?: string | null
          is_default?: boolean
          logo_url?: string | null
          name?: string
          pan?: string | null
          phone?: string | null
          pin_code?: string | null
          state_code?: string | null
          state_name?: string | null
          updated_at?: string
          upi_id?: string | null
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
      charger_ah_limits: {
        Row: {
          active: boolean
          charger_current: number
          created_at: string
          id: string
          max_battery_ah: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          charger_current: number
          created_at?: string
          id?: string
          max_battery_ah: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          charger_current?: number
          created_at?: string
          id?: string
          max_battery_ah?: number
          notes?: string | null
          updated_at?: string
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
      complaint_master: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
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
          state_code: string | null
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
          state_code?: string | null
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
          state_code?: string | null
          street?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      delivery_challans: {
        Row: {
          approved_by: string | null
          branch_id: string | null
          challan_date: string
          challan_no: string
          checked_by: string | null
          city: string | null
          contact_number: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          customer_po_no: string | null
          delivery_address: string | null
          dispatch_date: string | null
          dispatch_remarks: string | null
          doc_type: string
          driver_mobile: string | null
          driver_name: string | null
          email: string | null
          gate_pass_no: string | null
          gstin: string | null
          id: string
          indent_id: string | null
          internal_remarks: string | null
          invoice_no: string | null
          items: Json
          lr_number: string | null
          mode_of_transport: string | null
          num_packages: string | null
          oem_logo_url: string | null
          oem_plant: string | null
          party_code: string | null
          party_name: string | null
          pin_code: string | null
          prepared_by: string | null
          printed_at: string | null
          printed_by: string | null
          quotation_id: string | null
          reference_no: string | null
          sales_order_id: string | null
          sales_order_no: string | null
          state: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          total_weight: string | null
          transporter_name: string | null
          updated_at: string
          vehicle_number: string | null
        }
        Insert: {
          approved_by?: string | null
          branch_id?: string | null
          challan_date?: string
          challan_no: string
          checked_by?: string | null
          city?: string | null
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_po_no?: string | null
          delivery_address?: string | null
          dispatch_date?: string | null
          dispatch_remarks?: string | null
          doc_type: string
          driver_mobile?: string | null
          driver_name?: string | null
          email?: string | null
          gate_pass_no?: string | null
          gstin?: string | null
          id?: string
          indent_id?: string | null
          internal_remarks?: string | null
          invoice_no?: string | null
          items?: Json
          lr_number?: string | null
          mode_of_transport?: string | null
          num_packages?: string | null
          oem_logo_url?: string | null
          oem_plant?: string | null
          party_code?: string | null
          party_name?: string | null
          pin_code?: string | null
          prepared_by?: string | null
          printed_at?: string | null
          printed_by?: string | null
          quotation_id?: string | null
          reference_no?: string | null
          sales_order_id?: string | null
          sales_order_no?: string | null
          state?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_weight?: string | null
          transporter_name?: string | null
          updated_at?: string
          vehicle_number?: string | null
        }
        Update: {
          approved_by?: string | null
          branch_id?: string | null
          challan_date?: string
          challan_no?: string
          checked_by?: string | null
          city?: string | null
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_po_no?: string | null
          delivery_address?: string | null
          dispatch_date?: string | null
          dispatch_remarks?: string | null
          doc_type?: string
          driver_mobile?: string | null
          driver_name?: string | null
          email?: string | null
          gate_pass_no?: string | null
          gstin?: string | null
          id?: string
          indent_id?: string | null
          internal_remarks?: string | null
          invoice_no?: string | null
          items?: Json
          lr_number?: string | null
          mode_of_transport?: string | null
          num_packages?: string | null
          oem_logo_url?: string | null
          oem_plant?: string | null
          party_code?: string | null
          party_name?: string | null
          pin_code?: string | null
          prepared_by?: string | null
          printed_at?: string | null
          printed_by?: string | null
          quotation_id?: string | null
          reference_no?: string | null
          sales_order_id?: string | null
          sales_order_no?: string | null
          state?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_weight?: string | null
          transporter_name?: string | null
          updated_at?: string
          vehicle_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_challans_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challans_indent_id_fkey"
            columns: ["indent_id"]
            isOneToOne: false
            referencedRelation: "indents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challans_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challans_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      document_deletion_audit: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          deleted_by_name: string | null
          document_id: string
          document_no: string
          document_subtype: string | null
          document_type: string
          id: string
          original_created_at: string | null
          original_created_by: string | null
          reason: string
          snapshot: Json | null
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          document_id: string
          document_no: string
          document_subtype?: string | null
          document_type: string
          id?: string
          original_created_at?: string | null
          original_created_by?: string | null
          reason: string
          snapshot?: Json | null
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          document_id?: string
          document_no?: string
          document_subtype?: string | null
          document_type?: string
          id?: string
          original_created_at?: string | null
          original_created_by?: string | null
          reason?: string
          snapshot?: Json | null
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
      eway_bills: {
        Row: {
          created_at: string
          created_by: string | null
          distance_km: number | null
          doc_type: string | null
          error: string | null
          ewb_date: string | null
          ewb_no: string | null
          id: string
          invoice_id: string
          payload: Json | null
          response: Json | null
          status: string
          transport_mode: string | null
          transporter_id: string | null
          transporter_name: string | null
          updated_at: string
          valid_till: string | null
          vehicle_no: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          distance_km?: number | null
          doc_type?: string | null
          error?: string | null
          ewb_date?: string | null
          ewb_no?: string | null
          id?: string
          invoice_id: string
          payload?: Json | null
          response?: Json | null
          status?: string
          transport_mode?: string | null
          transporter_id?: string | null
          transporter_name?: string | null
          updated_at?: string
          valid_till?: string | null
          vehicle_no?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          distance_km?: number | null
          doc_type?: string | null
          error?: string | null
          ewb_date?: string | null
          ewb_no?: string | null
          id?: string
          invoice_id?: string
          payload?: Json | null
          response?: Json | null
          status?: string
          transport_mode?: string | null
          transporter_id?: string | null
          transporter_name?: string | null
          updated_at?: string
          valid_till?: string | null
          vehicle_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eway_bills_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      gatepasses: {
        Row: {
          authorised_by: string | null
          branch_id: string | null
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
          branch_id?: string | null
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
          branch_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "gatepasses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      grns: {
        Row: {
          accepted_qty: number | null
          approved_by: string | null
          attachments: Json | null
          bin_no: string | null
          branch_id: string | null
          category: string
          checked_by: string | null
          created_at: string
          created_by: string | null
          driver_mobile: string | null
          driver_name: string | null
          grn_date: string
          grn_no: string | null
          id: string
          indent_id: string | null
          internal_remarks: string | null
          invoice_date: string | null
          invoice_no: string | null
          items: Json
          lr_number: string | null
          mode_of_transport: string | null
          num_packages: string | null
          oem_logo_url: string | null
          oem_plant: string | null
          po_no: string | null
          printed_at: string | null
          printed_by: string | null
          qc_date: string | null
          qc_inspector: string | null
          qc_remarks: string | null
          qc_status: string | null
          receipt_date: string | null
          receipt_remarks: string | null
          received_by: string | null
          reference_no: string | null
          rejected_qty: number | null
          source_address: string | null
          source_code: string | null
          source_contact_number: string | null
          source_contact_person: string | null
          source_doc_date: string | null
          source_doc_no: string | null
          source_doc_type: string | null
          source_email: string | null
          source_gstin: string | null
          source_name: string | null
          status: string
          stock_category: string | null
          storage_location: string | null
          submitted_at: string | null
          submitted_by: string | null
          ticket_no: string | null
          total_weight: string | null
          transporter_name: string | null
          updated_at: string
          vehicle_number: string | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Insert: {
          accepted_qty?: number | null
          approved_by?: string | null
          attachments?: Json | null
          bin_no?: string | null
          branch_id?: string | null
          category: string
          checked_by?: string | null
          created_at?: string
          created_by?: string | null
          driver_mobile?: string | null
          driver_name?: string | null
          grn_date?: string
          grn_no?: string | null
          id?: string
          indent_id?: string | null
          internal_remarks?: string | null
          invoice_date?: string | null
          invoice_no?: string | null
          items?: Json
          lr_number?: string | null
          mode_of_transport?: string | null
          num_packages?: string | null
          oem_logo_url?: string | null
          oem_plant?: string | null
          po_no?: string | null
          printed_at?: string | null
          printed_by?: string | null
          qc_date?: string | null
          qc_inspector?: string | null
          qc_remarks?: string | null
          qc_status?: string | null
          receipt_date?: string | null
          receipt_remarks?: string | null
          received_by?: string | null
          reference_no?: string | null
          rejected_qty?: number | null
          source_address?: string | null
          source_code?: string | null
          source_contact_number?: string | null
          source_contact_person?: string | null
          source_doc_date?: string | null
          source_doc_no?: string | null
          source_doc_type?: string | null
          source_email?: string | null
          source_gstin?: string | null
          source_name?: string | null
          status?: string
          stock_category?: string | null
          storage_location?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          ticket_no?: string | null
          total_weight?: string | null
          transporter_name?: string | null
          updated_at?: string
          vehicle_number?: string | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Update: {
          accepted_qty?: number | null
          approved_by?: string | null
          attachments?: Json | null
          bin_no?: string | null
          branch_id?: string | null
          category?: string
          checked_by?: string | null
          created_at?: string
          created_by?: string | null
          driver_mobile?: string | null
          driver_name?: string | null
          grn_date?: string
          grn_no?: string | null
          id?: string
          indent_id?: string | null
          internal_remarks?: string | null
          invoice_date?: string | null
          invoice_no?: string | null
          items?: Json
          lr_number?: string | null
          mode_of_transport?: string | null
          num_packages?: string | null
          oem_logo_url?: string | null
          oem_plant?: string | null
          po_no?: string | null
          printed_at?: string | null
          printed_by?: string | null
          qc_date?: string | null
          qc_inspector?: string | null
          qc_remarks?: string | null
          qc_status?: string | null
          receipt_date?: string | null
          receipt_remarks?: string | null
          received_by?: string | null
          reference_no?: string | null
          rejected_qty?: number | null
          source_address?: string | null
          source_code?: string | null
          source_contact_number?: string | null
          source_contact_person?: string | null
          source_doc_date?: string | null
          source_doc_no?: string | null
          source_doc_type?: string | null
          source_email?: string | null
          source_gstin?: string | null
          source_name?: string | null
          status?: string
          stock_category?: string | null
          storage_location?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          ticket_no?: string | null
          total_weight?: string | null
          transporter_name?: string | null
          updated_at?: string
          vehicle_number?: string | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_indent_id_fkey"
            columns: ["indent_id"]
            isOneToOne: false
            referencedRelation: "indents"
            referencedColumns: ["id"]
          },
        ]
      }
      ims_audit_log: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      ims_reservations: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          indent_id: string | null
          notes: string | null
          released_at: string | null
          reserved_at: string
          reserved_by: string | null
          status: Database["public"]["Enums"]["ims_reservation_status"]
          stock_item_id: string
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          indent_id?: string | null
          notes?: string | null
          released_at?: string | null
          reserved_at?: string
          reserved_by?: string | null
          status?: Database["public"]["Enums"]["ims_reservation_status"]
          stock_item_id: string
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          indent_id?: string | null
          notes?: string | null
          released_at?: string | null
          reserved_at?: string
          reserved_by?: string | null
          status?: Database["public"]["Enums"]["ims_reservation_status"]
          stock_item_id?: string
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ims_reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_reservations_indent_id_fkey"
            columns: ["indent_id"]
            isOneToOne: false
            referencedRelation: "indents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_reservations_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "ims_stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_reservations_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ims_stock_items: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          id: string
          indent_id: string | null
          modified_by: string | null
          notes: string | null
          oem: string | null
          oem_case_id: string | null
          opening_stock: boolean
          part_model_no: string | null
          part_name: string
          part_serial_no: string | null
          qty: number
          stock_status: Database["public"]["Enums"]["ims_stock_status"]
          stock_type: Database["public"]["Enums"]["ims_stock_type"]
          ticket_id: string | null
          transaction_ref: string | null
          updated_at: string
          warehouse_id: string | null
          warehouse_type: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          indent_id?: string | null
          modified_by?: string | null
          notes?: string | null
          oem?: string | null
          oem_case_id?: string | null
          opening_stock?: boolean
          part_model_no?: string | null
          part_name: string
          part_serial_no?: string | null
          qty?: number
          stock_status?: Database["public"]["Enums"]["ims_stock_status"]
          stock_type?: Database["public"]["Enums"]["ims_stock_type"]
          ticket_id?: string | null
          transaction_ref?: string | null
          updated_at?: string
          warehouse_id?: string | null
          warehouse_type?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          indent_id?: string | null
          modified_by?: string | null
          notes?: string | null
          oem?: string | null
          oem_case_id?: string | null
          opening_stock?: boolean
          part_model_no?: string | null
          part_name?: string
          part_serial_no?: string | null
          qty?: number
          stock_status?: Database["public"]["Enums"]["ims_stock_status"]
          stock_type?: Database["public"]["Enums"]["ims_stock_type"]
          ticket_id?: string | null
          transaction_ref?: string | null
          updated_at?: string
          warehouse_id?: string | null
          warehouse_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ims_stock_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_stock_items_indent_id_fkey"
            columns: ["indent_id"]
            isOneToOne: false
            referencedRelation: "indents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_stock_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_stock_items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      ims_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          from_party: string | null
          from_warehouse_id: string | null
          id: string
          indent_id: string | null
          notes: string | null
          oem: string | null
          oem_case_id: string | null
          part_model_no: string | null
          part_name: string | null
          part_serial_no: string | null
          qty: number
          reference: string | null
          stock_item_id: string | null
          ticket_id: string | null
          to_party: string | null
          to_warehouse_id: string | null
          transfer_id: string | null
          txn_date: string
          txn_no: string | null
          txn_type: Database["public"]["Enums"]["ims_txn_type"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_party?: string | null
          from_warehouse_id?: string | null
          id?: string
          indent_id?: string | null
          notes?: string | null
          oem?: string | null
          oem_case_id?: string | null
          part_model_no?: string | null
          part_name?: string | null
          part_serial_no?: string | null
          qty?: number
          reference?: string | null
          stock_item_id?: string | null
          ticket_id?: string | null
          to_party?: string | null
          to_warehouse_id?: string | null
          transfer_id?: string | null
          txn_date?: string
          txn_no?: string | null
          txn_type: Database["public"]["Enums"]["ims_txn_type"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_party?: string | null
          from_warehouse_id?: string | null
          id?: string
          indent_id?: string | null
          notes?: string | null
          oem?: string | null
          oem_case_id?: string | null
          part_model_no?: string | null
          part_name?: string | null
          part_serial_no?: string | null
          qty?: number
          reference?: string | null
          stock_item_id?: string | null
          ticket_id?: string | null
          to_party?: string | null
          to_warehouse_id?: string | null
          transfer_id?: string | null
          txn_date?: string
          txn_no?: string | null
          txn_type?: Database["public"]["Enums"]["ims_txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "ims_transactions_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_transactions_indent_id_fkey"
            columns: ["indent_id"]
            isOneToOne: false
            referencedRelation: "indents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_transactions_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "ims_stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_transactions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_transactions_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      ims_transfer_sequence: {
        Row: {
          id: number
          last_seq: number
        }
        Insert: {
          id: number
          last_seq?: number
        }
        Update: {
          id?: number
          last_seq?: number
        }
        Relationships: []
      }
      ims_transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          destination_warehouse_id: string | null
          id: string
          oem: string | null
          part_model_no: string | null
          part_name: string | null
          part_serial_no: string | null
          qty: number
          reason: string | null
          receipt_remarks: string | null
          received_at: string | null
          received_by: string | null
          rejected_reason: string | null
          remarks: string | null
          request_date: string
          requested_by: string | null
          source_warehouse_id: string | null
          status: Database["public"]["Enums"]["ims_transfer_status"]
          stock_item_id: string | null
          stock_type: Database["public"]["Enums"]["ims_stock_type"]
          transfer_no: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          destination_warehouse_id?: string | null
          id?: string
          oem?: string | null
          part_model_no?: string | null
          part_name?: string | null
          part_serial_no?: string | null
          qty?: number
          reason?: string | null
          receipt_remarks?: string | null
          received_at?: string | null
          received_by?: string | null
          rejected_reason?: string | null
          remarks?: string | null
          request_date?: string
          requested_by?: string | null
          source_warehouse_id?: string | null
          status?: Database["public"]["Enums"]["ims_transfer_status"]
          stock_item_id?: string | null
          stock_type?: Database["public"]["Enums"]["ims_stock_type"]
          transfer_no?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          destination_warehouse_id?: string | null
          id?: string
          oem?: string | null
          part_model_no?: string | null
          part_name?: string | null
          part_serial_no?: string | null
          qty?: number
          reason?: string | null
          receipt_remarks?: string | null
          received_at?: string | null
          received_by?: string | null
          rejected_reason?: string | null
          remarks?: string | null
          request_date?: string
          requested_by?: string | null
          source_warehouse_id?: string | null
          status?: Database["public"]["Enums"]["ims_transfer_status"]
          stock_item_id?: string | null
          stock_type?: Database["public"]["Enums"]["ims_stock_type"]
          transfer_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ims_transfers_destination_warehouse_id_fkey"
            columns: ["destination_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_transfers_source_warehouse_id_fkey"
            columns: ["source_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ims_transfers_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "ims_stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ims_txn_sequence: {
        Row: {
          id: number
          last_seq: number
        }
        Insert: {
          id: number
          last_seq?: number
        }
        Update: {
          id?: number
          last_seq?: number
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
      indent_oracle_map: {
        Row: {
          created_at: string
          id: string
          indent_id: string
          oracle_no: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          indent_id: string
          oracle_no: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          indent_id?: string
          oracle_no?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "indent_oracle_map_indent_id_fkey"
            columns: ["indent_id"]
            isOneToOne: false
            referencedRelation: "indents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indent_oracle_map_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
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
          deleted_at: string | null
          deleted_by: string | null
          engineer_name: string | null
          id: string
          indent_city: string | null
          indent_date: string
          indent_no: string | null
          indent_type: Database["public"]["Enums"]["indent_type"] | null
          is_deleted: boolean
          material_exchange_model: string | null
          material_exchange_serial_no: string | null
          material_rec_date: string | null
          material_rec_model_no: string | null
          material_rec_serial_no: string | null
          oem_case_id: string | null
          oracles: string | null
          oracles_data: Json
          problem_reported: string | null
          product_model: string | null
          product_serial: string | null
          remarks: string | null
          status: string
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
          deleted_at?: string | null
          deleted_by?: string | null
          engineer_name?: string | null
          id?: string
          indent_city?: string | null
          indent_date?: string
          indent_no?: string | null
          indent_type?: Database["public"]["Enums"]["indent_type"] | null
          is_deleted?: boolean
          material_exchange_model?: string | null
          material_exchange_serial_no?: string | null
          material_rec_date?: string | null
          material_rec_model_no?: string | null
          material_rec_serial_no?: string | null
          oem_case_id?: string | null
          oracles?: string | null
          oracles_data?: Json
          problem_reported?: string | null
          product_model?: string | null
          product_serial?: string | null
          remarks?: string | null
          status?: string
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
          deleted_at?: string | null
          deleted_by?: string | null
          engineer_name?: string | null
          id?: string
          indent_city?: string | null
          indent_date?: string
          indent_no?: string | null
          indent_type?: Database["public"]["Enums"]["indent_type"] | null
          is_deleted?: boolean
          material_exchange_model?: string | null
          material_exchange_serial_no?: string | null
          material_rec_date?: string | null
          material_rec_model_no?: string | null
          material_rec_serial_no?: string | null
          oem_case_id?: string | null
          oracles?: string | null
          oracles_data?: Json
          problem_reported?: string | null
          product_model?: string | null
          product_serial?: string | null
          remarks?: string | null
          status?: string
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
      invoice_items: {
        Row: {
          cess: number
          cgst: number
          created_at: string
          description: string
          discount_pct: number
          gst_rate: number
          hsn: string | null
          id: string
          igst: number
          invoice_id: string
          line_total: number
          product_id: string | null
          qty: number
          rate: number
          serial_numbers: string[]
          sgst: number
          sr_no: number
          taxable_value: number
          unit: string | null
          warehouse_id: string | null
        }
        Insert: {
          cess?: number
          cgst?: number
          created_at?: string
          description: string
          discount_pct?: number
          gst_rate?: number
          hsn?: string | null
          id?: string
          igst?: number
          invoice_id: string
          line_total?: number
          product_id?: string | null
          qty?: number
          rate?: number
          serial_numbers?: string[]
          sgst?: number
          sr_no?: number
          taxable_value?: number
          unit?: string | null
          warehouse_id?: string | null
        }
        Update: {
          cess?: number
          cgst?: number
          created_at?: string
          description?: string
          discount_pct?: number
          gst_rate?: number
          hsn?: string | null
          id?: string
          igst?: number
          invoice_id?: string
          line_total?: number
          product_id?: string | null
          qty?: number
          rate?: number
          serial_numbers?: string[]
          sgst?: number
          sr_no?: number
          taxable_value?: number
          unit?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_settings: {
        Row: {
          branch_id: string
          company_address: string | null
          company_name: string | null
          copy_label: string
          created_at: string
          current_fy: string | null
          email: string | null
          fy_reset: boolean
          id: string
          next_seq: number
          notes_default: string | null
          phone: string | null
          place_of_supply_default: string | null
          prefix: string
          terms_default: string | null
          theme_color: string
          udyam_no: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          company_address?: string | null
          company_name?: string | null
          copy_label?: string
          created_at?: string
          current_fy?: string | null
          email?: string | null
          fy_reset?: boolean
          id?: string
          next_seq?: number
          notes_default?: string | null
          phone?: string | null
          place_of_supply_default?: string | null
          prefix?: string
          terms_default?: string | null
          theme_color?: string
          udyam_no?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          company_address?: string | null
          company_name?: string | null
          copy_label?: string
          created_at?: string
          current_fy?: string | null
          email?: string | null
          fy_reset?: boolean
          id?: string
          next_seq?: number
          notes_default?: string | null
          phone?: string | null
          place_of_supply_default?: string | null
          prefix?: string
          terms_default?: string | null
          theme_color?: string
          udyam_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          ack_date: string | null
          ack_no: string | null
          billing_address: string | null
          branch_id: string
          buyer_gstin: string | null
          buyer_name: string | null
          buyer_state: string | null
          buyer_state_code: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cess: number
          cgst: number
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          discount: number
          due_date: string | null
          einvoice_error: string | null
          einvoice_status: string | null
          ewaybill_date: string | null
          ewaybill_no: string | null
          ewaybill_valid_till: string | null
          id: string
          igst: number
          invoice_date: string
          invoice_no: string | null
          irn: string | null
          is_deleted: boolean
          is_interstate: boolean
          linked_dc_ids: string[] | null
          linked_quote_id: string | null
          notes: string | null
          payment_terms: string | null
          pdf_url: string | null
          place_of_supply: string | null
          place_of_supply_code: string | null
          po_date: string | null
          po_number: string | null
          qr_payload: string | null
          reverse_charge: boolean
          round_off: number
          sales_order_id: string | null
          seller_address: string | null
          seller_gstin: string | null
          seller_name: string | null
          seller_state: string | null
          seller_state_code: string | null
          sgst: number
          shipping_address: string | null
          status: string
          subtotal: number
          taxable_value: number
          terms: string | null
          total: number
          total_in_words: string | null
          total_paid: number
          updated_at: string
        }
        Insert: {
          ack_date?: string | null
          ack_no?: string | null
          billing_address?: string | null
          branch_id: string
          buyer_gstin?: string | null
          buyer_name?: string | null
          buyer_state?: string | null
          buyer_state_code?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cess?: number
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          discount?: number
          due_date?: string | null
          einvoice_error?: string | null
          einvoice_status?: string | null
          ewaybill_date?: string | null
          ewaybill_no?: string | null
          ewaybill_valid_till?: string | null
          id?: string
          igst?: number
          invoice_date?: string
          invoice_no?: string | null
          irn?: string | null
          is_deleted?: boolean
          is_interstate?: boolean
          linked_dc_ids?: string[] | null
          linked_quote_id?: string | null
          notes?: string | null
          payment_terms?: string | null
          pdf_url?: string | null
          place_of_supply?: string | null
          place_of_supply_code?: string | null
          po_date?: string | null
          po_number?: string | null
          qr_payload?: string | null
          reverse_charge?: boolean
          round_off?: number
          sales_order_id?: string | null
          seller_address?: string | null
          seller_gstin?: string | null
          seller_name?: string | null
          seller_state?: string | null
          seller_state_code?: string | null
          sgst?: number
          shipping_address?: string | null
          status?: string
          subtotal?: number
          taxable_value?: number
          terms?: string | null
          total?: number
          total_in_words?: string | null
          total_paid?: number
          updated_at?: string
        }
        Update: {
          ack_date?: string | null
          ack_no?: string | null
          billing_address?: string | null
          branch_id?: string
          buyer_gstin?: string | null
          buyer_name?: string | null
          buyer_state?: string | null
          buyer_state_code?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cess?: number
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          discount?: number
          due_date?: string | null
          einvoice_error?: string | null
          einvoice_status?: string | null
          ewaybill_date?: string | null
          ewaybill_no?: string | null
          ewaybill_valid_till?: string | null
          id?: string
          igst?: number
          invoice_date?: string
          invoice_no?: string | null
          irn?: string | null
          is_deleted?: boolean
          is_interstate?: boolean
          linked_dc_ids?: string[] | null
          linked_quote_id?: string | null
          notes?: string | null
          payment_terms?: string | null
          pdf_url?: string | null
          place_of_supply?: string | null
          place_of_supply_code?: string | null
          po_date?: string | null
          po_number?: string | null
          qr_payload?: string | null
          reverse_charge?: boolean
          round_off?: number
          sales_order_id?: string | null
          seller_address?: string | null
          seller_gstin?: string | null
          seller_name?: string | null
          seller_state?: string | null
          seller_state_code?: string | null
          sgst?: number
          shipping_address?: string | null
          status?: string
          subtotal?: number
          taxable_value?: number
          terms?: string | null
          total?: number
          total_in_words?: string | null
          total_paid?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_linked_quote_id_fkey"
            columns: ["linked_quote_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
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
      oem_logos: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_path: string
          oem_name: string
          position: string
          size: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path: string
          oem_name: string
          position?: string
          size?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string
          oem_name?: string
          position?: string
          size?: string
          sort_order?: number
          updated_at?: string
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
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments_received"
            referencedColumns: ["id"]
          },
        ]
      }
      payments_received: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          mode: string
          notes: string | null
          payment_date: string
          payment_no: string | null
          reference: string | null
          unallocated: number
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          mode?: string
          notes?: string | null
          payment_date?: string
          payment_no?: string | null
          reference?: string | null
          unallocated?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          mode?: string
          notes?: string | null
          payment_date?: string
          payment_no?: string | null
          reference?: string | null
          unallocated?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_received_customer_id_fkey"
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
      po_settings: {
        Row: {
          branch_id: string
          created_at: string
          current_fy: string | null
          fy_reset: boolean
          id: string
          next_seq: number
          notes_default: string | null
          prefix: string
          terms_default: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          current_fy?: string | null
          fy_reset?: boolean
          id?: string
          next_seq?: number
          notes_default?: string | null
          prefix?: string
          terms_default?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          current_fy?: string | null
          fy_reset?: boolean
          id?: string
          next_seq?: number
          notes_default?: string | null
          prefix?: string
          terms_default?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      product_bundles: {
        Row: {
          child_product_id: string
          created_at: string
          default_qty: number
          editable_qty: boolean
          id: string
          mandatory: boolean
          note: string | null
          parent_product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          child_product_id: string
          created_at?: string
          default_qty?: number
          editable_qty?: boolean
          id?: string
          mandatory?: boolean
          note?: string | null
          parent_product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          child_product_id?: string
          created_at?: string
          default_qty?: number
          editable_qty?: boolean
          id?: string
          mandatory?: boolean
          note?: string | null
          parent_product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_bundles_child_product_id_fkey"
            columns: ["child_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundles_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
      product_spare_parts: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          parent_product_id: string
          spare_part_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          parent_product_id: string
          spare_part_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          parent_product_id?: string
          spare_part_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_spare_parts_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_spare_parts_spare_part_id_fkey"
            columns: ["spare_part_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
          gst_rate: number | null
          hsn: string | null
          id: string
          local_tax_exempt: boolean
          local_tax_rate: number | null
          model: string | null
          name: string | null
          parent_tagging_required: boolean
          serial_format: string | null
          serial_mode: string
          serial_tracking: boolean
          sku: string | null
          tax_rate: number | null
          track_stock_on_invoice: boolean
          unit: string
          updated_at: string
          warranty_applicable: boolean
          warranty_duration: number | null
          warranty_manual_override: boolean
          warranty_start_from: string | null
          warranty_type: string | null
          warranty_unit: string | null
          weight_kg: number | null
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
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          local_tax_exempt?: boolean
          local_tax_rate?: number | null
          model?: string | null
          name?: string | null
          parent_tagging_required?: boolean
          serial_format?: string | null
          serial_mode?: string
          serial_tracking?: boolean
          sku?: string | null
          tax_rate?: number | null
          track_stock_on_invoice?: boolean
          unit?: string
          updated_at?: string
          warranty_applicable?: boolean
          warranty_duration?: number | null
          warranty_manual_override?: boolean
          warranty_start_from?: string | null
          warranty_type?: string | null
          warranty_unit?: string | null
          weight_kg?: number | null
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
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          local_tax_exempt?: boolean
          local_tax_rate?: number | null
          model?: string | null
          name?: string | null
          parent_tagging_required?: boolean
          serial_format?: string | null
          serial_mode?: string
          serial_tracking?: boolean
          sku?: string | null
          tax_rate?: number | null
          track_stock_on_invoice?: boolean
          unit?: string
          updated_at?: string
          warranty_applicable?: boolean
          warranty_duration?: number | null
          warranty_manual_override?: boolean
          warranty_start_from?: string | null
          warranty_type?: string | null
          warranty_unit?: string | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          cess: number
          cgst: number
          created_at: string
          description: string
          discount_pct: number
          gst_rate: number
          hsn: string | null
          id: string
          igst: number
          line_total: number
          po_id: string
          product_id: string | null
          qty: number
          rate: number
          received_qty: number
          sgst: number
          sr_no: number
          taxable_value: number
          unit: string | null
        }
        Insert: {
          cess?: number
          cgst?: number
          created_at?: string
          description: string
          discount_pct?: number
          gst_rate?: number
          hsn?: string | null
          id?: string
          igst?: number
          line_total?: number
          po_id: string
          product_id?: string | null
          qty?: number
          rate?: number
          received_qty?: number
          sgst?: number
          sr_no?: number
          taxable_value?: number
          unit?: string | null
        }
        Update: {
          cess?: number
          cgst?: number
          created_at?: string
          description?: string
          discount_pct?: number
          gst_rate?: number
          hsn?: string | null
          id?: string
          igst?: number
          line_total?: number
          po_id?: string
          product_id?: string | null
          qty?: number
          rate?: number
          received_qty?: number
          sgst?: number
          sr_no?: number
          taxable_value?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          branch_id: string
          buyer_address: string | null
          buyer_gstin: string | null
          buyer_name: string | null
          buyer_state_code: string | null
          buyer_state_name: string | null
          cess: number
          cgst: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          delivery_address: string | null
          delivery_address_type: string
          delivery_date: string | null
          discount: number
          id: string
          igst: number
          is_interstate: boolean
          notes: string | null
          payment_terms: string | null
          po_date: string
          po_no: string | null
          round_off: number
          sgst: number
          status: string
          subtotal: number
          taxable_value: number
          terms: string | null
          total: number
          total_in_words: string | null
          updated_at: string
          vendor_address: string | null
          vendor_contact_name: string | null
          vendor_email: string | null
          vendor_gstin: string | null
          vendor_id: string
          vendor_name: string | null
          vendor_phone: string | null
          vendor_state_code: string | null
          vendor_state_name: string | null
        }
        Insert: {
          branch_id: string
          buyer_address?: string | null
          buyer_gstin?: string | null
          buyer_name?: string | null
          buyer_state_code?: string | null
          buyer_state_name?: string | null
          cess?: number
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          delivery_address?: string | null
          delivery_address_type?: string
          delivery_date?: string | null
          discount?: number
          id?: string
          igst?: number
          is_interstate?: boolean
          notes?: string | null
          payment_terms?: string | null
          po_date?: string
          po_no?: string | null
          round_off?: number
          sgst?: number
          status?: string
          subtotal?: number
          taxable_value?: number
          terms?: string | null
          total?: number
          total_in_words?: string | null
          updated_at?: string
          vendor_address?: string | null
          vendor_contact_name?: string | null
          vendor_email?: string | null
          vendor_gstin?: string | null
          vendor_id: string
          vendor_name?: string | null
          vendor_phone?: string | null
          vendor_state_code?: string | null
          vendor_state_name?: string | null
        }
        Update: {
          branch_id?: string
          buyer_address?: string | null
          buyer_gstin?: string | null
          buyer_name?: string | null
          buyer_state_code?: string | null
          buyer_state_name?: string | null
          cess?: number
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          delivery_address?: string | null
          delivery_address_type?: string
          delivery_date?: string | null
          discount?: number
          id?: string
          igst?: number
          is_interstate?: boolean
          notes?: string | null
          payment_terms?: string | null
          po_date?: string
          po_no?: string | null
          round_off?: number
          sgst?: number
          status?: string
          subtotal?: number
          taxable_value?: number
          terms?: string | null
          total?: number
          total_in_words?: string | null
          updated_at?: string
          vendor_address?: string | null
          vendor_contact_name?: string | null
          vendor_email?: string | null
          vendor_gstin?: string | null
          vendor_id?: string
          vendor_name?: string | null
          vendor_phone?: string | null
          vendor_state_code?: string | null
          vendor_state_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          adjustment: number
          attachments: Json
          billing_address: string | null
          branch_id: string | null
          cgst_amount: number
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          converted_at: string | null
          converted_to_so_id: string | null
          created_at: string
          customer_id: string | null
          customer_notes: string | null
          delivery_timeline: string | null
          discount_amount: number
          expiry_date: string | null
          gst_amount: number
          gst_percent: number
          id: string
          igst_amount: number
          include_oem_logos: boolean
          items: Json
          lead_id: string | null
          owner_id: string
          payment_terms: string | null
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
          branch_id?: string | null
          cgst_amount?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_at?: string | null
          converted_to_so_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          delivery_timeline?: string | null
          discount_amount?: number
          expiry_date?: string | null
          gst_amount?: number
          gst_percent?: number
          id?: string
          igst_amount?: number
          include_oem_logos?: boolean
          items?: Json
          lead_id?: string | null
          owner_id: string
          payment_terms?: string | null
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
          branch_id?: string | null
          cgst_amount?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_at?: string | null
          converted_to_so_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          delivery_timeline?: string | null
          discount_amount?: number
          expiry_date?: string | null
          gst_amount?: number
          gst_percent?: number
          id?: string
          igst_amount?: number
          include_oem_logos?: boolean
          items?: Json
          lead_id?: string | null
          owner_id?: string
          payment_terms?: string | null
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
            foreignKeyName: "quotations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_converted_to_so_id_fkey"
            columns: ["converted_to_so_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
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
      sales_order_settings: {
        Row: {
          branch_id: string | null
          created_at: string
          current_fy: string | null
          fy_reset: boolean
          id: string
          next_seq: number
          prefix: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          current_fy?: string | null
          fy_reset?: boolean
          id?: string
          next_seq?: number
          prefix?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          current_fy?: string | null
          fy_reset?: boolean
          id?: string
          next_seq?: number
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_orders: {
        Row: {
          billing_address: string | null
          branch_id: string | null
          buyer_gstin: string | null
          buyer_name: string | null
          buyer_state: string | null
          buyer_state_code: string | null
          cess: number | null
          cgst: number | null
          contact_email: string | null
          contact_mobile: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivery_timeline: string | null
          discount: number | null
          expected_delivery: string | null
          id: string
          igst: number | null
          is_interstate: boolean | null
          items: Json
          linked_quote_id: string | null
          notes: string | null
          payment_terms: string | null
          place_of_supply: string | null
          place_of_supply_code: string | null
          po_date: string | null
          po_number: string | null
          reverse_charge: boolean | null
          round_off: number | null
          salesperson: string | null
          seller_address: string | null
          seller_gstin: string | null
          seller_name: string | null
          seller_state: string | null
          seller_state_code: string | null
          sgst: number | null
          shipping_address: string | null
          so_date: string
          so_no: string | null
          status: string
          subtotal: number | null
          taxable_value: number | null
          terms: string | null
          total: number | null
          total_in_words: string | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          billing_address?: string | null
          branch_id?: string | null
          buyer_gstin?: string | null
          buyer_name?: string | null
          buyer_state?: string | null
          buyer_state_code?: string | null
          cess?: number | null
          cgst?: number | null
          contact_email?: string | null
          contact_mobile?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_timeline?: string | null
          discount?: number | null
          expected_delivery?: string | null
          id?: string
          igst?: number | null
          is_interstate?: boolean | null
          items?: Json
          linked_quote_id?: string | null
          notes?: string | null
          payment_terms?: string | null
          place_of_supply?: string | null
          place_of_supply_code?: string | null
          po_date?: string | null
          po_number?: string | null
          reverse_charge?: boolean | null
          round_off?: number | null
          salesperson?: string | null
          seller_address?: string | null
          seller_gstin?: string | null
          seller_name?: string | null
          seller_state?: string | null
          seller_state_code?: string | null
          sgst?: number | null
          shipping_address?: string | null
          so_date?: string
          so_no?: string | null
          status?: string
          subtotal?: number | null
          taxable_value?: number | null
          terms?: string | null
          total?: number | null
          total_in_words?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          billing_address?: string | null
          branch_id?: string | null
          buyer_gstin?: string | null
          buyer_name?: string | null
          buyer_state?: string | null
          buyer_state_code?: string | null
          cess?: number | null
          cgst?: number | null
          contact_email?: string | null
          contact_mobile?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_timeline?: string | null
          discount?: number | null
          expected_delivery?: string | null
          id?: string
          igst?: number | null
          is_interstate?: boolean | null
          items?: Json
          linked_quote_id?: string | null
          notes?: string | null
          payment_terms?: string | null
          place_of_supply?: string | null
          place_of_supply_code?: string | null
          po_date?: string | null
          po_number?: string | null
          reverse_charge?: boolean | null
          round_off?: number | null
          salesperson?: string | null
          seller_address?: string | null
          seller_gstin?: string | null
          seller_name?: string | null
          seller_state?: string | null
          seller_state_code?: string | null
          sgst?: number | null
          shipping_address?: string | null
          so_date?: string
          so_no?: string | null
          status?: string
          subtotal?: number | null
          taxable_value?: number | null
          terms?: string | null
          total?: number | null
          total_in_words?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_linked_quote_id_fkey"
            columns: ["linked_quote_id"]
            isOneToOne: false
            referencedRelation: "quotations"
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
          defective_parts_details: Json
          defective_parts_received: boolean
          deleted_at: string | null
          deleted_by: string | null
          good_parts_details: Json
          good_parts_used: boolean
          id: string
          is_deleted: boolean
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
          defective_parts_details?: Json
          defective_parts_received?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          good_parts_details?: Json
          good_parts_used?: boolean
          id?: string
          is_deleted?: boolean
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
          defective_parts_details?: Json
          defective_parts_received?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          good_parts_details?: Json
          good_parts_used?: boolean
          id?: string
          is_deleted?: boolean
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
      ups_bundles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          items: Json
          label: string | null
          parent_product_id: string
          updated_at: string
          ups_load_watts: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          items?: Json
          label?: string | null
          parent_product_id: string
          updated_at?: string
          ups_load_watts?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          items?: Json
          label?: string | null
          parent_product_id?: string
          updated_at?: string
          ups_load_watts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ups_bundles_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: true
            referencedRelation: "products"
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
      whatsapp_launch_logs: {
        Row: {
          created_at: string
          failure_reason: string | null
          id: string
          launch_success: boolean
          module: string
          recipient_label: string | null
          recipient_mobile: string
          record_id: string | null
          record_number: string | null
          user_id: string | null
          whatsapp_url: string
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          launch_success?: boolean
          module: string
          recipient_label?: string | null
          recipient_mobile: string
          record_id?: string | null
          record_number?: string | null
          user_id?: string | null
          whatsapp_url: string
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          launch_success?: boolean
          module?: string
          recipient_label?: string | null
          recipient_mobile?: string
          record_id?: string | null
          record_number?: string | null
          user_id?: string | null
          whatsapp_url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _oracle_block_complete: { Args: { blk: Json }; Returns: boolean }
      _oracle_row_str: { Args: { k: string; v: Json }; Returns: string }
      admin_delete_challan: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      admin_delete_grn: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      admin_edit_grn_reverse: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      admin_reopen_oracle: {
        Args: {
          _indent_id: string
          _oracle_no: string
          _reason: string
          _scope: string
        }
        Returns: undefined
      }
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
      next_ims_transfer_seq: { Args: never; Returns: number }
      next_ims_txn_seq: { Args: never; Returns: number }
      next_indent_seq: { Args: never; Returns: number }
      next_ticket_seq: { Args: never; Returns: number }
      purge_archived_records: {
        Args: never
        Returns: {
          amcs_deleted: number
          indents_deleted: number
          tickets_deleted: number
        }[]
      }
      recalc_indent_status: { Args: { _indent_id: string }; Returns: undefined }
      record_user_activity: { Args: never; Returns: undefined }
      record_user_login: { Args: never; Returns: undefined }
      record_user_logout: { Args: never; Returns: undefined }
      sync_dc_to_ims: { Args: { _dc_id: string }; Returns: number }
      sync_grn_to_ims: { Args: { _grn_id: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
      ims_reservation_status: "reserved" | "issued" | "released"
      ims_stock_status:
        | "available"
        | "reserved"
        | "issued"
        | "in_transit"
        | "returned_to_oem"
        | "scrapped"
      ims_stock_type: "good" | "defective"
      ims_transfer_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "in_transit"
        | "received"
        | "completed"
      ims_txn_type:
        | "good_in"
        | "good_out"
        | "defective_in"
        | "defective_out"
        | "transfer_out"
        | "transfer_in"
        | "oem_return"
        | "oem_replacement_receipt"
        | "stock_adjustment"
        | "scrap_adjustment"
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
      ims_reservation_status: ["reserved", "issued", "released"],
      ims_stock_status: [
        "available",
        "reserved",
        "issued",
        "in_transit",
        "returned_to_oem",
        "scrapped",
      ],
      ims_stock_type: ["good", "defective"],
      ims_transfer_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "in_transit",
        "received",
        "completed",
      ],
      ims_txn_type: [
        "good_in",
        "good_out",
        "defective_in",
        "defective_out",
        "transfer_out",
        "transfer_in",
        "oem_return",
        "oem_replacement_receipt",
        "stock_adjustment",
        "scrap_adjustment",
      ],
      indent_type: ["rma_advance_exchange", "rma_exchange", "rma_service_ship"],
    },
  },
} as const
