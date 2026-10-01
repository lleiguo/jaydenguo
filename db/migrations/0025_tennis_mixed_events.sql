-- Custom SQL migration file, put your code below! --
-- "Never events with" no longer has "mixed" by default (owner, 2026-10-01):
-- "double" already covers mixed doubles, and it kept him out of U9 singles
-- events for boys and girls together ("U9 Mixed - Orange"). Settings saved
-- with the old default follow; anything the owner wrote himself stays.
UPDATE "sources" SET "config" = jsonb_set("config", '{entry,exclude}', '"girl, women, double"'::jsonb)
WHERE "kind" = 'tennis_tc' AND "config"->'entry'->>'exclude' = 'girl, women, double, mixed';--> statement-breakpoint
-- The venue was read from the "Route" button's label; the next refresh
-- doesn't rewrite entries it already knows.
UPDATE "tennis_entries" SET "venue" = NULL WHERE "venue" = 'Route';
