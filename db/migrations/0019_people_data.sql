-- Custom SQL migration file, put your code below! --
-- Owners replace "parent only" attendance (owner, 2026-09-28). The primary
-- person is the one the site is about; the owner adds the others in
-- Settings. Events that were "parent only" become optional, so they still
-- don't clash with his day until the owner gives them to a parent.
INSERT INTO "people" ("name", "is_primary") VALUES ('Jayden', true) ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "events" SET "attendance" = 'optional' WHERE "attendance" = 'parent_only';--> statement-breakpoint
UPDATE "event_series" SET "attendance" = 'optional' WHERE "attendance" = 'parent_only';--> statement-breakpoint
UPDATE "event_overrides" SET "attendance" = 'optional' WHERE "attendance" = 'parent_only';--> statement-breakpoint
-- Title rules that only said "parent only" go; the owner writes
-- "(parent) = Lei" instead.
UPDATE "sources" SET "category_mapping" = jsonb_set(
  "category_mapping",
  '{rules}',
  (
    SELECT coalesce(
      jsonb_agg(
        CASE WHEN r->>'attendance' = 'parent_only' THEN r - 'attendance' ELSE r END ORDER BY i
      ) FILTER (WHERE r ? 'category' OR coalesce(r->>'attendance', '') <> 'parent_only'),
      '[]'::jsonb
    )
    FROM jsonb_array_elements("category_mapping"->'rules') WITH ORDINALITY AS x(r, i)
  )
)
WHERE jsonb_typeof("category_mapping"->'rules') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("category_mapping"->'rules') AS r WHERE r->>'attendance' = 'parent_only'
  );
