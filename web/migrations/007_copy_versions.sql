-- One version history for everything.
-- A version belongs either to a project (what everyone gets) or to one
-- person's copy of a project (the changes they keep while trying things).
-- Both live in this one table, so there is one history and one way to read it.

alter table versions add column if not exists copy_id uuid references copies(id) on delete cascade;
alter table versions alter column project_id drop not null;

-- When a version only went back to an earlier one: that one's number.
alter table versions add column if not exists restored_from int;

-- Exactly one owner: a project or a copy, never both and never neither.
alter table versions drop constraint if exists versions_one_owner;
alter table versions add constraint versions_one_owner
  check ((project_id is null) <> (copy_id is null));

-- Numbers count up separately inside each copy, as they do inside each project.
create unique index if not exists versions_copy_number_key on versions (copy_id, number);
