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

export type RequestType =
  | "social_post"
  | "poster"
  | "newsletter"
  | "video"
  | "other";

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "twitter"
  | "youtube"
  | "other";

export type NotificationType =
  | "request_submitted_for_approval"
  | "request_approved"
  | "request_sent_back_to_draft"
  | "design_uploaded_for_review"
  | "design_approved"
  | "design_changes_requested"
  | "request_published"
  | "calendar_item_approved"
  | "user_added_to_school"
  | "ai_generation_completed"
  | "ai_generation_failed";

export type AiJobStatus =
  | "queued"
  | "understanding"
  | "creative"
  | "generating"
  | "completed"
  | "failed";

export type ChatMessageRole = "user" | "assistant" | "system";

export type BrandAssetType =
  | "logo"
  | "header"
  | "footer"
  | "uniform"
  | "infrastructure"
  | "sample";

export type NotificationEmailPref = "off" | "daily" | "immediate";

type Timestamp = string;
type DateOnly = string;

export type Database = {
  public: {
    Tables: {
      schools: {
        Row: {
          id: string;
          name: string;
          ai_guidelines: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          name: string;
          ai_guidelines?: string | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          name?: string;
          ai_guidelines?: string | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          role: UserRole;
          email_pref: NotificationEmailPref;
          password_set: boolean;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email?: string | null;
          role?: UserRole;
          email_pref?: NotificationEmailPref;
          password_set?: boolean;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          email?: string | null;
          role?: UserRole;
          email_pref?: NotificationEmailPref;
          password_set?: boolean;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Relationships: [];
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
        Relationships: [];
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
          request_type: RequestType | null;
          due_date: DateOnly | null;
          change_feedback: string | null;
          ai_generated: boolean;
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
          request_type?: RequestType | null;
          due_date?: DateOnly | null;
          change_feedback?: string | null;
          ai_generated?: boolean;
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
          request_type?: RequestType | null;
          due_date?: DateOnly | null;
          change_feedback?: string | null;
          ai_generated?: boolean;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
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
          feedback: string | null;
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
          feedback?: string | null;
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
          feedback?: string | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Relationships: [];
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
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          recipient_id: string;
          actor_id: string | null;
          type: NotificationType;
          request_id: string | null;
          calendar_item_id: string | null;
          body: string;
          feedback: string | null;
          read_at: Timestamp | null;
          pushed_at: Timestamp | null;
          emailed_at: Timestamp | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          recipient_id: string;
          actor_id?: string | null;
          type: NotificationType;
          request_id?: string | null;
          calendar_item_id?: string | null;
          body: string;
          feedback?: string | null;
          read_at?: Timestamp | null;
          pushed_at?: Timestamp | null;
          emailed_at?: Timestamp | null;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          recipient_id?: string;
          actor_id?: string | null;
          type?: NotificationType;
          request_id?: string | null;
          calendar_item_id?: string | null;
          body?: string;
          feedback?: string | null;
          read_at?: Timestamp | null;
          pushed_at?: Timestamp | null;
          emailed_at?: Timestamp | null;
          created_at?: Timestamp;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: Timestamp;
          last_seen_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: Timestamp;
          last_seen_at?: Timestamp;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: Timestamp;
          last_seen_at?: Timestamp;
        };
        Relationships: [];
      };
      fcm_tokens: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          platform: string;
          user_agent: string | null;
          created_at: Timestamp;
          last_seen_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          token: string;
          platform?: string;
          user_agent?: string | null;
          created_at?: Timestamp;
          last_seen_at?: Timestamp;
        };
        Update: {
          id?: string;
          user_id?: string;
          token?: string;
          platform?: string;
          user_agent?: string | null;
          created_at?: Timestamp;
          last_seen_at?: Timestamp;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          id: string;
          request_id: string;
          author_id: string;
          body: string;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          request_id: string;
          author_id: string;
          body: string;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          request_id?: string;
          author_id?: string;
          body?: string;
          created_at?: Timestamp;
        };
        Relationships: [];
      };
      asset_downloads: {
        Row: {
          id: string;
          user_id: string;
          request_id: string;
          asset_kind: "upload" | "design" | "mixed";
          file_count: number;
          paths: string[];
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          request_id: string;
          asset_kind: "upload" | "design" | "mixed";
          file_count: number;
          paths: string[];
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          user_id?: string;
          request_id?: string;
          asset_kind?: "upload" | "design" | "mixed";
          file_count?: number;
          paths?: string[];
          created_at?: Timestamp;
        };
        Relationships: [];
      };
      school_brand_assets: {
        Row: {
          id: string;
          school_id: string;
          asset_type: BrandAssetType;
          storage_path: string;
          mime_type: string | null;
          file_size: number | null;
          label: string | null;
          uploaded_by: string;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          school_id: string;
          asset_type: BrandAssetType;
          storage_path: string;
          mime_type?: string | null;
          file_size?: number | null;
          label?: string | null;
          uploaded_by: string;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          school_id?: string;
          asset_type?: BrandAssetType;
          storage_path?: string;
          mime_type?: string | null;
          file_size?: number | null;
          label?: string | null;
          uploaded_by?: string;
          created_at?: Timestamp;
        };
        Relationships: [];
      };
      ai_generation_jobs: {
        Row: {
          id: string;
          request_id: string;
          status: AiJobStatus;
          inngest_run_id: string | null;
          agent1_output: Record<string, unknown> | null;
          agent2_output: Record<string, unknown> | null;
          error_message: string | null;
          started_at: Timestamp | null;
          completed_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          request_id: string;
          status?: AiJobStatus;
          inngest_run_id?: string | null;
          agent1_output?: Record<string, unknown> | null;
          agent2_output?: Record<string, unknown> | null;
          error_message?: string | null;
          started_at?: Timestamp | null;
          completed_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          request_id?: string;
          status?: AiJobStatus;
          inngest_run_id?: string | null;
          agent1_output?: Record<string, unknown> | null;
          agent2_output?: Record<string, unknown> | null;
          error_message?: string | null;
          started_at?: Timestamp | null;
          completed_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Relationships: [];
      };
      ai_variations: {
        Row: {
          id: string;
          job_id: string;
          request_id: string;
          variation_index: number;
          creative_brief: Record<string, unknown>;
          storage_paths: string[];
          poster_type: "single" | "carousel";
          is_accepted: boolean;
          chat_rounds_used: number;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          job_id: string;
          request_id: string;
          variation_index: number;
          creative_brief: Record<string, unknown>;
          storage_paths?: string[];
          poster_type: "single" | "carousel";
          is_accepted?: boolean;
          chat_rounds_used?: number;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          id?: string;
          job_id?: string;
          request_id?: string;
          variation_index?: number;
          creative_brief?: Record<string, unknown>;
          storage_paths?: string[];
          poster_type?: "single" | "carousel";
          is_accepted?: boolean;
          chat_rounds_used?: number;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Relationships: [];
      };
      ai_chat_messages: {
        Row: {
          id: string;
          variation_id: string;
          role: ChatMessageRole;
          content: string;
          image_paths: string[];
          metadata: Record<string, unknown> | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          variation_id: string;
          role: ChatMessageRole;
          content: string;
          image_paths?: string[];
          metadata?: Record<string, unknown> | null;
          created_at?: Timestamp;
        };
        Update: {
          id?: string;
          variation_id?: string;
          role?: ChatMessageRole;
          content?: string;
          image_paths?: string[];
          metadata?: Record<string, unknown> | null;
          created_at?: Timestamp;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Enums: {
      user_role: UserRole;
      request_status: RequestStatus;
      calendar_item_status: CalendarItemStatus;
      social_platform: SocialPlatform;
      notification_type: NotificationType;
      notification_email_pref: NotificationEmailPref;
      ai_job_status: AiJobStatus;
      chat_message_role: ChatMessageRole;
      brand_asset_type: BrandAssetType;
    };
  };
};
