-- Custom SQL migration file, put your code below! --
-- U12 orange and green events count for him (intent 0029, UGR-5). Tournaments
-- skipped for having no event for him are never read again: the next refresh
-- finds these ones afresh, and skips any that still have none.
DELETE FROM "tennis_entries"
WHERE "status" = 'skipped' AND "note" LIKE 'No event for him%' AND "start_date" >= CURRENT_DATE;
