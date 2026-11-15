-- The home page shelves: picks from the team, and lists made by people.
-- ("New this week" and "Hot" need no tables: they are worked out from
-- projects, stars and copies.)

-- Projects the team chose to show first. Lower position comes first.
create table if not exists picks (
  project_id uuid primary key references projects(id) on delete cascade,
  position   int  not null default 0,
  picked_by  uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- A list somebody made, like "Research helpers".
create table if not exists lists (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists list_items (
  list_id    uuid not null references lists(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, project_id)
);

create index if not exists lists_owner_idx on lists (owner);

alter table picks enable row level security;
alter table lists enable row level security;
alter table list_items enable row level security;
