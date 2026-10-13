# Spec: A smaller image registry bill
Status: approved (owner, 2026-10-12, in chat: "do 1 and 2" then "and 3 and 4", choosing the four steps Claude proposed). Written by Claude from [intent.md](intent.md).

Read with 0001 (plan M0.6, M0.7). IDs here: REG (registry).

## 1. What changes in earlier specs
- **0001 plan M0.6** The registry's cleanup keeps 7 days, not 30; the
  last 10 versions of each image are still kept.
- **0001 plan M0.7** Deploy caches layers in GitHub Actions, not in a
  `cache` image in the registry, and pushes images without provenance.
  The worker image is node:22-slim with Chromium's headless shell and
  ffmpeg, not the Playwright image.

## 2. Requirements
| ID | Requirement | Acceptance criteria |
|---|---|---|
| REG-1 | No cache in the registry. | Deploy uses `type=gha` cache; nothing new is pushed to `hub/cache`. A deploy with an unchanged lockfile reuses the install layers. |
| REG-2 | One version per deploy. | After a deploy, `web` and `worker` each gain one version (an image manifest, not an index). |
| REG-3 | A week of images. | The cleanup policy deletes versions over 7 days old and keeps the 10 newest of each image. |
| REG-4 | A smaller worker that still works. | The worker image starts Chromium (headless shell, Playwright 1.63.0) and runs ffmpeg; the Images check proves both on the PR; the migrate step and a Chromium sync work on production. Its production `node_modules` layer is reused when the lockfile doesn't change. |
| REG-5 | Old versions removed. | After the first deploy with REG-1/2: `web` and `worker` versions over 7 days old (other than the deployed ones) and the `cache` image are deleted. |

## 3. Design
- `infra/artifact_registry.tf`: `delete-old` older than 604800 s.
- `.github/workflows/deploy.yml`: `crazy-max/ghaction-github-runtime`
  exposes the cache token to the build step; `--provenance=false`;
  `--cache-from/--cache-to type=gha,scope=<image>`.
- `docker/worker.Dockerfile`: stages `base`, `build`, `prod-deps`
  (lockfile only), `runtime` (node:22-slim, ffmpeg,
  `playwright-core install --with-deps --only-shell chromium`,
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, user `node`).
- `.github/workflows/images.yml`: on PRs touching images, builds both
  without pushing, launches Chromium and runs ffmpeg in the worker.

## 4. Testing
- The Images check on the PR (REG-4).
- After deploy: the version count (REG-2), the migrate step, one sync
  that uses Chromium (Commit Swimming or Veracross) on production.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| G-1 | A rollback to an image over a week old isn't possible. | Fine: the last 10 deploys are always kept. |
| G-2 | The GitHub Actions cache is shared with CI's (10 GB); evicted layers rebuild. | Fine: a slower deploy now and then. |
