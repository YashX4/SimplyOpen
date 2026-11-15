-- The chat about a copy, kept so its owner can come back to it.
-- A copy belongs to one person, so this is each person's own conversation
-- about each of their copies.

-- What was said, in order. Only what the person typed and what the AI
-- answered: the same two things the chatbot is allowed to see.
create table if not exists chat_messages (
  seq            bigint generated always as identity primary key,
  copy_id        uuid not null references copies(id) on delete cascade,
  role           text not null check (role in ('you', 'assistant')),
  text           text not null,
  -- For an answer that changed the code: the copy version it made.
  version_number int,
  created_at     timestamptz not null default now()
);

create index if not exists chat_messages_copy_idx on chat_messages (copy_id, seq);

-- The chat service's live session for a copy, if it has one. Sessions there
-- are temporary; when one is gone, a new one is started from the copy's
-- newest code and the messages above.
create table if not exists chat_sessions (
  copy_id    uuid primary key references copies(id) on delete cascade,
  session_id text not null,
  -- The copy version the session's files match.
  at_version int  not null,
  updated_at timestamptz not null default now()
);

alter table chat_messages enable row level security;
alter table chat_sessions enable row level security;
