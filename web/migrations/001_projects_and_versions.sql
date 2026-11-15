-- SimplyOpen, step one: the spine.
-- A project holds what stays. A version holds everything that changes.
-- Run against Supabase. Row Level Security is on, so only the service role
-- key can read these. Your Fastify server uses that key; the browser never
-- talks to Supabase directly.

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null,
  slug        text unique not null,
  name        text not null,
  description text not null default '',
  visibility  text not null default 'private'
              check (visibility in ('private', 'link', 'public')),
  created_at  timestamptz not null default now()
);

create table if not exists versions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  number         int  not null,
  note           text not null default '',
  source_zip_url text,
  created_by     uuid not null,
  suggested_by   uuid,
  created_at     timestamptz not null default now(),
  unique (project_id, number)
);

create index if not exists versions_project_number_idx
  on versions (project_id, number desc);

alter table projects enable row level security;
alter table versions enable row level security;

-- Seed: the demo project and its five versions.
-- Two stand in people until the users table exists.
insert into projects (id, owner, slug, name, description, visibility)
values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'zoom-transcripts-to-nvivo',
  'Zoom transcripts to NVivo',
  'Turns Zoom transcripts into files NVivo opens.',
  'public')
on conflict (slug) do nothing;

insert into versions (project_id, number, note, created_by, suggested_by, created_at)
values
  ('11111111-1111-4111-8111-111111111111', 1,
   'First version.',
   '22222222-2222-4222-8222-222222222222', null, '2026-10-28 10:00+00'),
  ('11111111-1111-4111-8111-111111111111', 2,
   'Makes one file per interview instead of one big file.',
   '22222222-2222-4222-8222-222222222222', null, '2026-11-02 11:00+00'),
  ('11111111-1111-4111-8111-111111111111', 3,
   'Keeps the speaker names when you ask it to.',
   '22222222-2222-4222-8222-222222222222', null, '2026-11-14 09:00+00'),
  ('11111111-1111-4111-8111-111111111111', 4,
   'Also saves a plain spreadsheet next to the NVivo file, which you can open in Excel. You can turn it off in the window.',
   '22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-333333333333', '2026-11-14 14:00+00'),
  ('11111111-1111-4111-8111-111111111111', 5,
   'The finished files go into a folder you choose, instead of landing next to your transcripts. It remembers the folder for next time.',
   '22222222-2222-4222-8222-222222222222', null, '2026-11-14 17:30+00')
on conflict (project_id, number) do nothing;
