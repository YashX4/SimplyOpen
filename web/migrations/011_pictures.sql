-- A picture of the app's real window, taken by the build on a Mac and
-- collected by the website when the build finishes. Null until then, and
-- for builds made before pictures existed.
alter table versions add column if not exists picture_url text;
