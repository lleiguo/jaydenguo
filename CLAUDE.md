@AGENTS.md

# Claude only

- The workflow, commands and rules are in `AGENTS.md` above; they apply to
  Claude like any agent. `.claude/settings.json` hooks enforce some of
  them: Prettier on each edited file, no edits to `db/migrations/`, no
  skipping git hooks or pushing to `main`, and `gh pr merge` only when
  every check has passed.
- Claude's memory holds notes about the owner's Mac, not the workflow. If
  memory and `AGENTS.md` disagree, `AGENTS.md` wins.
