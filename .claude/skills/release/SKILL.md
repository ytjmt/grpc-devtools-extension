---
name: release
description: Start a release by running the Prepare release workflow, which opens a version bump PR.
disable-model-invocation: true
argument-hint: patch | minor | major
allowed-tools: Bash(gh workflow run prepare-release.yml *), Bash(gh run list *), Bash(gh run watch *), Bash(gh pr view release *)
---

Start a release of the version part given in `$ARGUMENTS`.

1. If `$ARGUMENTS` is not exactly `patch`, `minor`, or `major`, ask which one to use and stop.
2. Run `gh workflow run prepare-release.yml --ref main -f bump=$ARGUMENTS`.
3. Find the run with `gh run list --workflow prepare-release.yml --limit 1 --json databaseId,status`. Wait for it with `gh run watch <id> --exit-status`. If it fails, report the failing step and stop.
4. Run `gh pr view release --json url,title,body`.
5. Report the PR's URL and title, and summarize its draft release notes.
6. Tell the user the remaining steps. They approve the PR's workflow runs and merge it once CI passes. CI on `main` then publishes the release.

Do not approve runs, merge the PR, or create tags or releases yourself.
