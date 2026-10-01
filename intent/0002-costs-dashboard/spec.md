# Spec: costs dashboard
Source: [intent.md](intent.md). Status: approved (owner, 2026-09-28: merged in #38).

## Requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| COST-1 | A Costs page (Settings → Costs) shows the project's cost per day for the last 90 days, from Google Cloud billing. | A daily chart, split into infrastructure and AI (Vertex AI), plus a table of the top services this month. Amounts are in the billing account's currency, net of credits. Every value in the chart is also in a table (NFR-9). |
| COST-2 | Month to date, forecast and trend. | Shows month-to-date cost, the forecast for the month's end as an estimate with a range, last month's total, and last month at the same day. The forecast is month to date plus the days left times the recent daily average (last 14 full days), with the range from the lowest and highest 7-day average in those 14 days. Labelled "Estimate". |
| COST-3 | Budgets. | Month to date and forecast against the two budgets (project and AI), with amounts from Terraform. |
| COST-4 | AI cost by feature. | Video reviews, email suggestions and match explanations per day and this month, estimated from each call's recorded tokens and list prices (USD), labelled as an estimate. Works without the billing export. |
| COST-5 | Freshness. | A daily worker job reads the billing export; the page says when it last did and how late billing data is (Google's export lags by up to a day). Without the export, the page says how to turn it on and still shows COST-4. |

## Design

- **Billing data:** Cloud Billing's standard usage cost export to BigQuery,
  turned on by the owner in the Console (only a billing admin can). The
  worker job `costs:sync` (daily, and on "Refresh") queries the last 35
  days (billing data is corrected for a few days) for this project,
  grouped by day in the home time zone and by service, cost plus credits,
  and upserts them into `daily_costs`. Read-only: the worker gets
  BigQuery Job User on the project and Data Viewer on the export dataset
  only. BigQuery's cost for this is negligible.
- **Data residency (NFR-1a):** the export dataset holds billing data only
  (services, SKUs, amounts), no data about Jayden. Choose a Canadian
  location for it if the Console offers one.
- **AI by feature:** from `video_review_rounds.cost_usd`,
  `email_messages.cost_usd` (new column) and `tennis_explanations` tokens
  priced with `src/server/llm/pricing.ts`.
- **Page:** server-rendered SVG chart (no chart library; strict CSP), as the
  swim progression chart.
