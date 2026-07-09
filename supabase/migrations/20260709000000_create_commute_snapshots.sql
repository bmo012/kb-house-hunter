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

notify pgrst, 'reload schema';
