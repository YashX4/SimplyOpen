-- Built apps are bigger than object storage will take on a free plan
-- (a bundled Python plus Electron runs well past 50 MB), so a build can
-- point at the Factory's own artifact instead of a file we copied.
-- The download route then streams it, and the person still needs no account.

alter table builds add column if not exists artifact_id bigint;
