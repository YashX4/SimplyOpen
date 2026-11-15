-- Copying someone else's project, and offering a change back.
-- A copy points at the version it started from, never at the project.

create table if not exists copies (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  owner           uuid not null references users(id) on delete cascade,
  from_version_id uuid not null references versions(id),
  name            text not null default '',
  working_zip_url text,
  created_at      timestamptz not null default now()
);

create index if not exists copies_owner_idx on copies (owner);
create index if not exists copies_project_idx on copies (project_id);

-- An offer, from a copy back to the project it came from.
create table if not exists suggestions (
  id               uuid primary key default gen_random_uuid(),
  copy_id          uuid not null references copies(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  author           uuid not null references users(id) on delete cascade,
  note             text not null default '',
  state            text not null default 'waiting'
                   check (state in ('waiting', 'taken', 'left', 'withdrawn')),
  taken_version_id uuid references versions(id),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);

create index if not exists suggestions_project_state_idx
  on suggestions (project_id, state, created_at desc);

-- The plain words. One row per change, which is what Y2, Y3 and Y4 read.
create table if not exists suggestion_changes (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references suggestions(id) on delete cascade,
  position      int not null,
  title         text not null,
  before_text   text not null default '',
  after_text    text not null default '',
  included      boolean not null default true,
  unique (suggestion_id, position)
);

create table if not exists stars (
  user_id    uuid not null references users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table copies enable row level security;
alter table suggestions enable row level security;
alter table suggestion_changes enable row level security;
alter table stars enable row level security;
