# Plan: costs dashboard
Source: [spec.md](spec.md). Status: draft (2026-09-28).

| Task | Description | Spec | Done when |
|---|---|---|---|
| C.1 | `daily_costs` table; `email_messages.cost_usd` (migration 0016; 0015 was taken on main). | COST-1, COST-4 | Migration merged. |
| C.2 | Pure summary: month to date, forecast and range, last month, budgets, infra/AI split (`src/domain/costs.ts`). | COST-2, COST-3 | Unit tests (month edges, short history, no data). |
| C.3 | `costs:sync` job: BigQuery query through the REST API with the worker's identity, upsert. | COST-1, COST-5 | Integration test against a fake BigQuery. |
| C.4 | Settings → Costs page: chart, tables, budgets, AI by feature, freshness, Refresh. | COST-1..5 | e2e test with seeded costs. |
| C.5 | Terraform: `billing_export_table` variable, worker env, IAM (job user; data viewer on the dataset), daily scheduler job; budget amounts on the web service. | COST-1, COST-3 | `terraform validate`; owner applies after turning on the export. |

## Status
| Task | Status |
|---|---|
| C.1–C.5 | built on `costs/dashboard` (2026-09-28), not merged |
