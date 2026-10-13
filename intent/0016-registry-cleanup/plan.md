# Plan: A smaller image registry bill
Status: approved (owner, 2026-10-12, in chat: "do 1 and 2" then "and 3 and 4", choosing the four steps Claude proposed), with [spec.md](spec.md).

Order: the code and policy in one PR; the deletion after its deploy works.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve Terraform apply of the cleanup policy (`infra/`). | R2 |

## 2. Spikes
None.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| R1 | GitHub Actions cache, no provenance, smaller worker, Images check, 7-day policy in Terraform. | REG-1..4 | (this PR) |
| R2 | Terraform apply; delete old versions and the cache image. | REG-3, REG-5 | none (cloud) |

## 4. Done when
- The repository is a few GB and stays there; a deploy adds two versions.

## 5. Status
Approved 2026-10-12. R1 built.
