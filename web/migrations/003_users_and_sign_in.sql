-- People, and the way they sign in.
-- No passwords anywhere: W9 sends a link, and the same link makes the account.

create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  name       text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_key on users (lower(email));

-- A one time link. Dead after it is used, and after an hour.
create table if not exists sign_in_tokens (
  token      text primary key,
  email      text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- A signed in browser. Opaque to the client, looked up on every request.
create table if not exists sessions (
  token      text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sign_in_tokens_email_idx on sign_in_tokens (lower(email));

alter table users enable row level security;
alter table sign_in_tokens enable row level security;
alter table sessions enable row level security;

-- The two stand in people from the seed become real rows, so the
-- owner columns can finally point somewhere.
insert into users (id, email, name) values
  ('22222222-2222-4222-8222-222222222222', 'p.raman@leeds.ac.uk', 'Priya Raman'),
  ('33333333-3333-4333-8333-333333333333', 'tomas.medina@example.ac.uk', 'Tomás Medina')
on conflict (id) do nothing;

alter table projects drop constraint if exists projects_owner_fkey;
alter table projects add constraint projects_owner_fkey
  foreign key (owner) references users(id) on delete cascade;

alter table versions drop constraint if exists versions_created_by_fkey;
alter table versions add constraint versions_created_by_fkey
  foreign key (created_by) references users(id);

alter table versions drop constraint if exists versions_suggested_by_fkey;
alter table versions add constraint versions_suggested_by_fkey
  foreign key (suggested_by) references users(id);
