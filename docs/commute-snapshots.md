# Commute Snapshots

The app stores route time series data in Supabase. Supabase has a free tier and works well for the small append-only snapshot table this app needs.

## Environment

Add these values to `.env.local`:

```powershell
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key
GOOGLE_MAPS_SERVER_API_KEY=your_google_maps_server_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your_supabase_secret_key
```

`GOOGLE_MAPS_SERVER_API_KEY` should have access to the Directions API. If it is omitted, the API route falls back to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

## Supabase Schema

The schema is tracked in `supabase/migrations/20260709000000_create_commute_snapshots.sql`.

If you need to apply it manually once, run this SQL in the Supabase SQL editor:

```sql
create table if not exists public.commute_snapshots (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  captured_at timestamptz not null,
  listing_id text not null,
  listing_name text not null,
  workplace_key text not null,
  workplace_label text not null,
  direction text not null check (direction in ('to_facility', 'from_facility')),
  origin_address text,
  destination_address text,
  duration_seconds integer,
  distance_meters integer,
  duration_text text,
  distance_text text,
  overview_polyline text,
  status text,
  error text
);

create index if not exists commute_snapshots_listing_time_idx
  on public.commute_snapshots (listing_id, workplace_key, direction, captured_at desc);
```

The app uses the secret key only from the server-side API route. Do not expose it as a `NEXT_PUBLIC_` value. The legacy `SUPABASE_SERVICE_ROLE_KEY` name still works if you already configured it.

## Capture Behavior

When the site loads, the client sends the current saved listings and workplaces to `/api/commute-snapshots`. That starts an in-process scheduler and gives the server the latest state to capture.

While the Next.js server process is running, it captures all listing/workplace routes every 30 minutes. The `Capture latest` button also records the same data immediately.

This is process-local scheduling. It is fine for local use or a continuously running Node server, but serverless hosts can stop idle functions. For production on serverless, move the same POST capture call to a hosted cron job.

## Deploying Migrations From GitHub

The repository includes `.github/workflows/supabase-migrations.yml`. It runs `supabase db push` when files under `supabase/migrations/` are pushed to `main`.

Add these GitHub repository secrets in **GitHub > Settings > Secrets and variables > Actions**:

- `SUPABASE_ACCESS_TOKEN`: create this in Supabase account settings as a personal access token.
- `SUPABASE_PROJECT_ID`: the project ref from your Supabase project URL or settings.
- `SUPABASE_DB_PASSWORD`: the database password for the Supabase project.

After those secrets exist, commit and push migration files to `main`. GitHub Actions will apply pending migrations to the linked Supabase project.
