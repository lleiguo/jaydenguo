-- One-time grants after the first `terraform apply` (plan M0.6).
-- Cloud SQL IAM users start with no privileges. The worker owns the schema
-- (it runs migrations); the web user gets read/write on the tables through
-- the grants the migrate job applies (src/server/db/migrate.ts).
--
-- Run as the built-in postgres user, e.g. in Cloud SQL Studio, replacing the
-- names with `terraform output db_users`:
--   :worker = hub-worker@<project>.iam
--   :web    = hub-web@<project>.iam

GRANT CREATE, CONNECT ON DATABASE hub TO "hub-worker@PROJECT.iam";
GRANT CONNECT ON DATABASE hub TO "hub-web@PROJECT.iam";
GRANT ALL ON SCHEMA public TO "hub-worker@PROJECT.iam";
GRANT USAGE ON SCHEMA public TO "hub-web@PROJECT.iam";
