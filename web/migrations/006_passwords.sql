-- Signing in with a username and password, beside the emailed link.

-- A username is optional: people who only ever use the emailed link have none.
alter table users add column if not exists username text;
create unique index if not exists users_username_key on users (lower(username));

-- When the person proved the email address is theirs, by opening a link we
-- sent to it. Everyone who exists so far came in by link, so they all have.
alter table users add column if not exists email_verified_at timestamptz;
update users set email_verified_at = created_at where email_verified_at is null;

-- The password lives in its own table, never on the users row, so that
-- "select * from users" can never carry it anywhere.
-- hash is "scrypt$N$r$p$salt$key": the password itself is never stored.
create table if not exists passwords (
  user_id         uuid primary key references users(id) on delete cascade,
  hash            text not null,
  -- Wrong tries in a row, and until when signing in by password is paused.
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  -- The link sent at sign up. Opening it proves the address and keeps the
  -- password; proving the address with any other link removes the password,
  -- because whoever set it may not have been the address's owner.
  confirm_token   text,
  updated_at      timestamptz not null default now()
);

alter table passwords enable row level security;
