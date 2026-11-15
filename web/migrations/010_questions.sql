-- Questions and answers on a project page.
-- Anyone signed in can ask; the maker answers. A question shows to everyone
-- once it has an answer. Until then only its asker and the maker see it.

create table if not exists questions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  asked_by    uuid not null references users(id) on delete cascade,
  text        text not null,
  answer      text,
  answered_by uuid references users(id),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists questions_project_idx on questions (project_id, created_at);

alter table questions enable row level security;
