// Hand-written types matching supabase/migrations/0001 + 0002.
// Swap to `supabase gen types typescript` output once the Supabase CLI is installed.

export type UserRole =
  | "super_admin"
  | "designer"
  | "school_admin"
  | "teacher"
  | "decision_maker";

export type RequestStatus =
  | "draft"
  | "pending_admin_approval"
  | "approved"
  | "in_design"
  | "design_pending_approval"
  | "changes_requested"
  | "published"
  | "archived";

export type CalendarItemStatus =
  | "drafted"
  | "admin_approved"
  | "fulfilled"
  | "cancelled";

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "twitter"
  | "youtube"
  | "other";

type Timestamp = string;
type DateOnly = string;

export type Database = {
  public: {
    Tables: {
      schools: {
        Row: {
          id: string;
          name: string;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: UserRole;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
      };
      school_members: {
        Row: {
          id: string;
          school_id: string;
          user_id: string;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          school_id: string;
          user_id: string;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          school_id?: string;
          user_id?: string;
          created_at?: Timestamp;
        };
      };
      requests: {
        Row: {
          id: string;
          school_id: string;
          created_by: string;
          assigned_designer_id: string | null;
          approved_by: string | null;
          title: string;
          description: string | null;
          status: RequestStatus;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          school_id: string;
          created_by: string;
          assigned_designer_id?: string | null;
          approved_by?: string | null;
          title: string;
          description?: string | null;
          status?: RequestStatus;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          school_id?: string;
          created_by?: string;
          assigned_designer_id?: string | null;
          approved_by?: string | null;
          title?: string;
          description?: string | null;
          status?: RequestStatus;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
      };
      request_uploads: {
        Row: {
          id: string;
          request_id: string;
          uploaded_by: string;
          storage_path: string;
          mime_type: string | null;
          file_size: number | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          request_id: string;
          uploaded_by: string;
          storage_path: string;
          mime_type?: string | null;
          file_size?: number | null;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          request_id?: string;
          uploaded_by?: string;
          storage_path?: string;
          mime_type?: string | null;
          file_size?: number | null;
          created_at?: Timestamp;
        };
      };
      designs: {
        Row: {
          id: string;
          request_id: string;
          uploaded_by: string;
          storage_path: string;
          version: number;
          notes: string | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          request_id: string;
          uploaded_by: string;
          storage_path: string;
          version?: number;
          notes?: string | null;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          request_id?: string;
          uploaded_by?: string;
          storage_path?: string;
          version?: number;
          notes?: string | null;
          created_at?: Timestamp;
        };
      };
      calendar_items: {
        Row: {
          id: string;
          school_id: string;
          created_by: string;
          linked_request_id: string | null;
          planned_date: DateOnly;
          title: string;
          description: string | null;
          status: CalendarItemStatus;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          school_id: string;
          created_by: string;
          linked_request_id?: string | null;
          planned_date: DateOnly;
          title: string;
          description?: string | null;
          status?: CalendarItemStatus;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          school_id?: string;
          created_by?: string;
          linked_request_id?: string | null;
          planned_date?: DateOnly;
          title?: string;
          description?: string | null;
          status?: CalendarItemStatus;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
      };
      published_links: {
        Row: {
          id: string;
          request_id: string;
          posted_by: string;
          platform: SocialPlatform;
          url: string;
          posted_at: Timestamp;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          request_id: string;
          posted_by: string;
          platform: SocialPlatform;
          url: string;
          posted_at?: Timestamp;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          request_id?: string;
          posted_by?: string;
          platform?: SocialPlatform;
          url?: string;
          posted_at?: Timestamp;
          created_at?: Timestamp;
        };
      };
    };
    Enums: {
      user_role: UserRole;
      request_status: RequestStatus;
      calendar_item_status: CalendarItemStatus;
      social_platform: SocialPlatform;
    };
  };
};
