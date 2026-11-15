-- SimplyOpen, step two: what the Factory did, and what the Analyzer found.

-- One workflow run builds all three systems at once, so the handle that
-- finds it again on GitHub belongs to the version, not to a platform.
-- The run is titled "Build <build_id>".
alter table versions add column if not exists build_id text;

-- What actually happened, per system. Three rows per version, at most.
create table if not exists builds (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references versions(id) on delete cascade,
  platform     text not null check (platform in ('mac', 'windows', 'linux')),
  status       text not null default 'waiting'
               check (status in ('waiting', 'building', 'ready', 'failed', 'cannot')),
  message      text not null default '',
  download_url text,
  size_bytes   bigint,
  created_at   timestamptz not null default now(),
  unique (version_id, platform)
);

-- What the Analyzer found. One row per version.
-- status matches their CheckResult type exactly: passed, failed, unavailable.
create table if not exists checks (
  id                uuid primary key default gen_random_uuid(),
  version_id        uuid not null unique references versions(id) on delete cascade,
  status            text not null check (status in ('passed', 'failed', 'unavailable')),
  summary           text not null default '',
  manifest          jsonb,
  network_access    boolean not null default false,
  operating_systems text[] not null default '{}',
  confidence        text check (confidence in ('high', 'medium', 'low')),
  created_at        timestamptz not null default now()
);

create index if not exists builds_version_idx on builds (version_id);

alter table builds enable row level security;
alter table checks enable row level security;

-- Seed: three builds per version, all ready.
-- The download_url is a placeholder until storage is wired up.
insert into builds (version_id, platform, status, download_url, size_bytes)
select v.id,
       p.platform,
       'ready',
       'https://storage.not-wired-yet.invalid/' || v.number || '/' || p.platform || '.zip',
       25165824
from versions v
join projects pr on pr.id = v.project_id
cross join (values ('mac'), ('windows'), ('linux')) as p(platform)
where pr.slug = 'zoom-transcripts-to-nvivo'
on conflict (version_id, platform) do nothing;

-- Seed: one check per version.
insert into checks (version_id, status, summary, network_access, operating_systems, confidence)
select v.id,
       'passed',
       'No keys or passwords found. Does not reach the internet. Built and ran on all three systems.',
       false,
       array['macos', 'windows', 'linux'],
       'high'
from versions v
join projects pr on pr.id = v.project_id
where pr.slug = 'zoom-transcripts-to-nvivo'
on conflict (version_id) do nothing;
