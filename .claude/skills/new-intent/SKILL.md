---
name: new-intent
description: Start a new change in this repo — a new intent folder (intent, spec, plan as drafts) and its docs PR for the owner's approval. Use when the owner asks for a new feature or behaviour change, or new scope after an intent was approved.
---

# Start an intent (intent 0010, PRO-1)

Any agent can follow this file; it's linked from `AGENTS.md`.

1. **Worktree from `origin/main`.** `git fetch origin`, then
   `git worktree add -b intent/NNNN-short-name <scratch dir> origin/main`.
   Never switch the shared checkout's branch.
2. **Next number.** The highest `intent/NNNN-*` on `origin/main`, plus one.
   Check open PRs too (`gh pr list --search "Intent"`): another session may
   have taken it.
3. **Copy the templates.** `intent/_template/{intent,spec,plan}.md` into
   `intent/NNNN-short-name/`. Every `Status:` line says `draft (<today>)`.
4. **Write them.**
   - intent: the owner's words quoted, the problem, the outcome, the
     constraints, open questions with defaults.
   - spec: requirements with IDs and testable acceptance criteria, the
     design, testing, concerns with recommendations. Read the earlier
     specs it touches and say what changes in them.
   - plan: the owner's steps, spikes, milestones (one PR each, small
     enough to review), done when, Status.

   Match the earlier intents' style: plain words, short tables.

5. **README row.** Add `| NNNN | [Title](NNNN-short-name/) | draft <date> | draft <date> | draft <date> |` to `intent/README.md`.
6. **Docs PR.** Commit, push, `gh pr create` titled `Intent NNNN: <title>`.
   The description starts with `Intent: NNNN`, then a short summary and
   the questions the owner must answer.
7. **Stop.** Tell the owner what to decide. Nothing is built until they
   approve.

On approval: set each `Status:` to `approved (owner, <date>, in chat:
"<their words>")` with any answers, update the README row, push, merge the
docs PR when its checks pass, then build with the `ship` procedure.
