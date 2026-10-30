-- Custom SQL migration file, put your code below! --
-- Green ball events count for him (intent 0028, GRN-5, GRN-6). Settings saved
-- with the old defaults follow; anything the owner wrote himself stays.
UPDATE "sources" SET "config" = jsonb_set("config", '{entry,include}', '"orange, green"'::jsonb)
WHERE "kind" = 'tennis_tc' AND "config"->'entry'->>'include' = 'orange';--> statement-breakpoint
UPDATE "sources" SET "config" = jsonb_set("config", '{entry,exclude}', '"girl, women, double, gs, gu1, gu9"'::jsonb)
WHERE "kind" = 'tennis_tc' AND "config"->'entry'->>'exclude' = 'girl, women, double';--> statement-breakpoint
-- Tournaments skipped for having no event for him are never read again: the
-- next refresh finds these ones afresh, and skips any that still have none.
DELETE FROM "tennis_entries"
WHERE "status" = 'skipped' AND "note" LIKE 'No event for him%' AND "start_date" >= CURRENT_DATE;
