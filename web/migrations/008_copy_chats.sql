-- Chats that last. A chat is one person changing one thing by talking:
-- the maker on their own project, or anybody on their own copy.
--
-- The chat service only keeps a chat for an hour after it was last used,
-- and loses it on a restart. What is here outlives that: which chat is
-- whose, everything that was said, and the code as the chat last left it.
-- So a chat can be picked up again later, or on another computer.

create table if not exists chats (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references users(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  -- Null when the maker is changing their own project.
  copy_id        uuid references copies(id) on delete cascade,
  -- The project version the chat started from.
  from_version   int  not null,
  -- The chat service's own id for the live session. It changes each time
  -- the chat is picked up again.
  remote         text not null,
  -- The code the chat started from, and the code as it last left it
  -- (null until the first change).
  base_zip_url   text not null,
  working_zip_url text,
  -- The changes made so far, as the chat page lists them, kept so the list
  -- survives the chat service forgetting. version_offset is how many of
  -- them were made before the live session began.
  versions       jsonb not null default '[]',
  version_offset int  not null default 0,
  started_at     timestamptz not null default now()
);

create index if not exists chats_owner_idx on chats (owner, project_id);

-- What was said, in order: only what the person typed and what the AI
-- answered, the same two things the chatbot is allowed to see.
create table if not exists chat_messages (
  seq            bigint generated always as identity primary key,
  chat_id        uuid not null references chats(id) on delete cascade,
  role           text not null check (role in ('you', 'assistant')),
  text           text not null,
  -- For an answer that changed the code: the number of the change it made.
  version_number int,
  created_at     timestamptz not null default now()
);

create index if not exists chat_messages_chat_idx on chat_messages (chat_id, seq);

alter table chats enable row level security;
alter table chat_messages enable row level security;
