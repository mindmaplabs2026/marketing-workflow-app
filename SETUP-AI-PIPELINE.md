# AI Poster Generation — Setup Guide

This document covers everything needed to get the AI poster generation pipeline running. Follow each section in order.

---

## 1. Run the Database Migration

Open your Supabase project dashboard:

1. Go to **SQL Editor** > **New query**
2. Paste the entire contents of `supabase/migrations/0020_ai_generation.sql`
3. Click **Run**

This creates:
- 5 new tables: `school_brand_assets`, `ai_generation_jobs`, `ai_variations`, `ai_chat_messages`
- 3 new enums: `ai_job_status`, `chat_message_role`, `brand_asset_type`
- 2 new notification types: `ai_generation_completed`, `ai_generation_failed`
- 1 new storage bucket: `school-assets`
- RLS policies for all new tables and the storage bucket
- A notification trigger on `ai_generation_jobs` (fires on completion/failure)
- An `ai_generated` boolean column on the existing `requests` table

**Verify it worked**: Run `SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'ai_%';` — you should see 3 tables.

---

## 2. Enable Supabase Realtime

The progress tracker uses Realtime subscriptions to show live generation status.

1. Go to **Database** > **Replication** in the Supabase dashboard
2. Find the `ai_generation_jobs` table
3. Enable Realtime for this table (toggle it on)

Without this, the progress UI will not update live — teachers would need to refresh the page manually.

---

## 3. Set Up Inngest

Inngest orchestrates the multi-step AI pipeline (each step runs as a separate serverless function to stay within Vercel's timeout limits).

### 3a. Create an Inngest account
1. Go to https://www.inngest.com and sign up (free tier is sufficient)
2. Create a new app or use the default one

### 3b. Get your keys
From the Inngest dashboard, grab:
- **Event Key** (used to send events from your app)
- **Signing Key** (used to verify webhook requests from Inngest)

### 3c. Add environment variables to Vercel
In **Vercel** > your project > **Settings** > **Environment Variables**, add:

| Variable | Value | Environments |
|---|---|---|
| `INNGEST_EVENT_KEY` | Your Inngest event key | Production, Preview |
| `INNGEST_SIGNING_KEY` | Your Inngest signing key | Production, Preview |

### 3d. Sync with Inngest
After deploying (step 5), Inngest needs to discover your functions:

1. In the Inngest dashboard, go to **Apps** > **Sync new app**
2. Enter your app's Inngest endpoint URL: `https://your-domain.vercel.app/api/inngest`
3. Click **Sync**

You should see the `ai-poster-pipeline` function appear.

---

## 4. Set Up OpenAI

### 4a. Get an API key
1. Go to https://platform.openai.com/api-keys
2. Create a new API key (or use an existing one)
3. Make sure the key has access to:
   - `gpt-4o-mini` (for Agents 1 and 2 — understanding and creative direction)
   - `gpt-image-1` (for Agent 3 — poster generation and chat edits)

### 4b. Add environment variable to Vercel

| Variable | Value | Environments |
|---|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key | Production, Preview |

### 4c. Cost awareness
Each AI generation run (3 poster variations) will use approximately:
- ~2 `gpt-4o-mini` calls (Agent 1 + Agent 2) — cheap, ~$0.01-0.05
- ~3-5 `gpt-image-1` calls (Agent 3, one per poster/page) — ~$0.04-0.08 each
- Each chat edit round: 1 `gpt-4o-mini` + 1 `gpt-image-1` call

Rough estimate: **$0.20-0.50 per full generation** (3 variations), plus **~$0.10 per chat edit round**.

---

## 5. Deploy

After adding all environment variables:

1. Push any pending changes or trigger a redeploy in Vercel
2. Once deployed, sync with Inngest (step 3d above)
3. Verify the deployment by checking:
   - `https://your-domain.vercel.app/api/inngest` returns a 200 response
   - The Inngest dashboard shows `ai-poster-pipeline` as registered

---

## 6. Upload School Brand Assets

Before teachers can use AI generation effectively, each school needs brand assets:

1. Log in as **super_admin**
2. Go to **Admin** > **Schools** > pick a school
3. Click the **Brand Assets** link at the top
4. Upload at least:
   - **Logo** (required — appears in every generated poster)
   - **Header** and **Footer** (recommended)
   - **Uniform** (needed when AI generates student imagery)
   - **Infrastructure** (optional — school building photos, campus shots)

Each asset type supports multiple uploads (e.g., summer uniform + winter uniform).

---

## 7. Test the Flow

1. Log in as a **teacher**
2. Go to **Requests** > **New request**
3. Fill in a title and description (e.g., "World Environment Day celebration")
4. Check **"Generate with AI"**
5. Choose poster type (single or carousel)
6. Optionally upload some photos
7. Submit

What should happen:
- The request is created with `ai_generated = true`
- An Inngest job starts (check the Inngest dashboard for progress)
- The request detail page shows a live progress indicator
- After ~20-30 minutes, the teacher gets a push notification
- The request detail page shows 3 poster variations
- The teacher can click "Chat & Edit" on any variation to iterate
- The teacher clicks "Accept" on their preferred variation
- The request moves to `design_pending_approval` for the school admin

---

## Environment Variables Summary

All variables that need to be set in Vercel:

| Variable | Purpose | Already exists? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `OPENAI_API_KEY` | OpenAI API access | **NEW — add this** |
| `INNGEST_EVENT_KEY` | Inngest event publishing | **NEW — add this** |
| `INNGEST_SIGNING_KEY` | Inngest webhook verification | **NEW — add this** |

For local development (`.env.local`), add the same three new variables.

---

## Troubleshooting

**"AI generation stuck at Queued"**
- Check the Inngest dashboard for errors
- Verify `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are set correctly
- Make sure you synced the app with Inngest (step 3d)

**"No images generated"**
- Check the Inngest function logs for OpenAI API errors
- Verify `OPENAI_API_KEY` is set and has access to `gpt-image-1`
- Check your OpenAI usage limits / billing

**"Progress bar not updating"**
- Ensure Realtime is enabled on `ai_generation_jobs` table (step 2)
- Check browser console for Supabase Realtime connection errors

**"Brand assets not showing in generation"**
- Verify assets were uploaded via the admin UI (step 6)
- Check that the `school-assets` storage bucket exists in Supabase
- Check RLS policies allow access (the migration handles this)

**"Chat edits fail"**
- Check the browser network tab for `/api/ai/chat` errors
- The 25-round limit is per variation — once reached, no more edits
- Verify OpenAI key has sufficient credits
