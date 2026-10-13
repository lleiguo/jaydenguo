# Intent: A smaller image registry bill
Status: approved (owner, 2026-10-12, in chat: "do 1 and 2" then "and 3 and 4", choosing the four steps Claude proposed). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"why artifactory is the highest cost, any ways to reduce that?"

## Problem
- Artifact Registry is the project's biggest cost. On 2026-10-12 the
  `hub` repository held 49.7 GB (about $5 a month at $0.10 a GB) and
  was growing: the 30-day cleanup (0001 plan M0.6) hadn't deleted
  anything yet, because the oldest image was 16 days old.
- About 11 deploys a day, and each adds hundreds of MB:
  - the build cache (`cache:web`, `cache:worker`, `mode=max`) is
    stored in the registry, and every push leaves the old copy behind;
  - the worker rebuilds its production `node_modules` on every commit,
    so each image has a new layer of that size;
  - the worker is based on the Playwright image (1.1 GB, three browsers)
    though only Chromium runs;
  - each push adds three versions (an index, the image, a provenance
    attestation).

## Proposed outcome
- **The build cache lives in GitHub Actions**, not the registry (free,
  10 GB, oldest entries evicted).
- **The registry keeps a week**: versions older than 7 days are deleted,
  except the last 10 of each image (a rollback and the running revisions).
- **One version per deploy**: no provenance attestation.
- **A smaller worker image**: Chromium's headless shell and ffmpeg on
  node:22-slim; production dependencies built from the lockfile alone, so
  an ordinary deploy adds only the worker bundle.
- **The old versions go now**: those over 7 days, and the old cache
  image once the new deploy works.
- **Not here.** The web image (105 MB; its standalone build changes each
  commit); a different registry or region.

## Constraints
- Deploys, rollbacks and the running Cloud Run revisions keep working.
- Terraform apply and deletions are the owner's to approve (AGENTS.md);
  approved in chat for this change.

## Open questions (defaults in brackets)
1. How long to keep images? [7 days, and the last 10 of each image.]
