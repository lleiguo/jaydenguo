# Security review and go-live checklist (M6, 2026-09-28)

Plan M6.1 and M6.2, spec NFR-2, F-9, §9. A manual review of the whole
repository (after M5) plus checks of the live project and site. The
`/security-review` command reviews a branch's pending changes, so it wasn't
the right tool for the whole codebase; each area below was read directly.

## M6.1 Security review

| Area | What was checked | Result |
|---|---|---|
| Auth on every route (AUTH-2) | `src/proxy.ts` gates every path except the short public list in `src/lib/routes.ts`; every `/api/v1` handler also goes through `api()` (checks the session again); every page under `(app)` calls `requirePageSession`; the Google connect routes check the session. The e2e suite builds the route list from Next's manifest and proves anonymous and non-allow-listed requests are refused on all of them, including the M5 routes. Live: an anonymous `GET /api/v1/videos` returns 401. | OK |
| CSP and headers | Per-request nonce, `strict-dynamic`, no `unsafe-inline` or `unsafe-eval` in production, `frame-ancestors 'none'`, `object-src 'none'`. HSTS (2 years, preload), `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `X-Robots-Tag: noindex`. Checked live on `https://jaydenguo.com/login`. | OK |
| CSRF | Every non-GET request must come from the site's own origin (`Origin`, or `Sec-Fetch-Site: same-origin`), on top of `SameSite=Lax`. The OAuth `state` is tied to the signed-in session. | OK |
| Session cookie | `__session`, HttpOnly, Secure, SameSite=Lax, random ID stored hashed; 30 days; "Sign out everywhere". Login is rate limited. | OK |
| Secret redaction (CRED-5) | Field-name redaction plus value redaction of every decrypted secret. **Fixed:** Google access tokens are now registered with the redactor where they're minted (`googleAccessToken`), not only in some callers. Seven days of production logs searched for token, client-secret, refresh-token, password and `Bearer` patterns: none. | Fixed |
| Links from source data | **Fixed:** a URL from a feed or a scraped page (event "Open at the source", draw, meet, tournament and player links) is shown only if it is `http(s)` (`src/lib/external-href.ts`), so a feed can't plant a `javascript:` link. The CSP would already block its script. Video links are checked when saved; Gmail links are built by the site. | Fixed |
| KMS split (CRED-4, §7.3) | Live IAM on `hub/credentials`: `hub-web` has Encrypter only; `hub-worker` has Encrypter and Decrypter. 90-day rotation; `rotate-keys` re-wraps. | OK |
| Buckets | `jaydenguo-backups` and `jaydenguo-tfstate`: public access prevention enforced, uniform access, Toronto. No `allUsers`. | OK |
| Service accounts | `hub-web`: Cloud SQL client and instance user, its secrets, KMS encrypt, starting worker jobs. `hub-worker`: the same for SQL, KMS decrypt, Vertex AI user, the SQL export role, Service Usage consumer (Routes API). No owner or editor roles. | OK |
| Injection | Drizzle parameterises queries; the only `sql.raw` builds check constraints from constants. No `dangerouslySetInnerHTML` or `eval`. React escapes all text. | OK |
| Open redirects | Post-login and post-connect destinations go through `safeReturnTo` (own paths only). | OK |
| Dependencies | `pnpm audit --prod`: no known vulnerabilities (also a CI step). | OK |
| Secrets in the repo | Searched for API keys, private keys, OAuth client secrets and tokens: none. The only personal detail is the owner's email as the default allow-list. | OK |

### Accepted risks (owner to confirm)

1. **The web service allows `allUsers` to invoke it,** and its `run.app`
   address is reachable directly. Firebase Hosting needs this to reach Cloud
   Run. Every route still requires a session, and mutations from the
   `run.app` origin fail the CSRF check.
2. **Owner-entered links are fetched by the worker** (calendar feeds, the
   school's key dates page, the Veracross portal). Only the signed-in owner
   can set them, so there's no outside SSRF path.
3. **Email text goes to Claude** (EML-2) and could try to instruct it. The
   answer can only be suggestions in a fixed schema, a change or
   cancellation can only point at an existing event, and nothing reaches
   the calendar until the owner approves.
4. **ffmpeg reads videos from the owner's own Drive or Photos** in the
   worker container. The videos are the owner's; the job runs in its own
   short-lived container and deletes the files when it ends.
5. **Cloud Logging's `_Required` bucket is global.** It holds Google's
   admin-activity audit logs only (who changed what in the project), not app
   data; it can't be moved. App logs go to `hub-logs` in Toronto, and the
   `_Default` sink is off.

## M6.2 Go-live checklist (spec §9, NFR-1a, NFR-2)

- [x] **Backup restore tested:** the owner ran `infra/bootstrap/restore-test.sh` (M1.13, 2026-09-28).
- [ ] **Allow-list checked:** live `ALLOWED_EMAILS` is `lleiguo@gmail.com` and one more Gmail address. AUTH-1 starts with the owner only; **the owner confirms the second address is intended** (and sets it in `prod.tfvars` so Terraform matches).
- [x] **`noindex`:** `robots.txt` disallows everything; pages send `<meta name="robots" content="noindex, nofollow">` and `X-Robots-Tag: noindex, nofollow, noarchive` (checked live).
- [x] **No secret values in logs:** unit test for redaction (CRED-5), and seven days of production logs searched (above).
- [ ] **2-step verification on the owner's Google account:** owner checks <https://myaccount.google.com/signinoptions/twosv>.
- [ ] **Budgets active:** owner checks Console → Billing → Budgets & alerts shows "hub monthly" and "hub AI monthly" (the Cloud Billing API is off, so this couldn't be read from the project).
- [x] **Logs regional:** app logs go to `hub-logs` in `northamerica-northeast2`; `_Default` sink disabled (see accepted risk 5).
- [x] **Data in Canada:** Cloud SQL, backups, Terraform state, Artifact Registry, KMS, Secret Manager and log bucket are in Toronto (SP-1).

### Owner decisions noted

- **Backup retention isn't locked.** The spec says "retention lock": the
  1-year retention policy is set but not locked. Locking can't be undone,
  and afterwards the bucket can't be deleted for a year. Lock it with
  `gcloud storage buckets update gs://jaydenguo-backups --lock-retention-period`
  if you want the stronger guarantee.
