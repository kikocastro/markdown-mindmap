---
description: Adversarial pre-merge review swarm. Four narrow-charter subagents in parallel against a PR diff, deduped into one consolidated gh pr review, then fix agents for HIGH findings only.
argument-hint: "[PR number, or empty for every open PR]"
---

# review-swarm

Adversarial review of a pull request. Four reviewers run **in parallel**, each with a narrow
charter and no permission to wander outside it. The orchestrator (you) merges their output,
throws away anything that cannot be cited, posts one review, and fixes only the HIGH findings.

The point is not coverage. It is that each of these charters corresponds to a class of bug that
has actually shipped past a normal review here.

## Arguments

`$ARGUMENTS` is a PR number. If empty, run the whole procedure once per PR in
`gh pr list --state open --json number`, sequentially. Skip PRs authored by `dependabot[bot]`
or `renovate[bot]` unless the number was passed explicitly.

## Step 0 — orchestrator setup (do this before spawning anything)

```bash
gh pr view <PR> --json number,title,body,headRefName,baseRefName,author,files
gh pr diff <PR> > /tmp/review-swarm-<PR>.diff
BASE=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
git fetch origin
git merge-base origin/$BASE origin/<headRefName>   # the real base, never a remembered sha
```

Note the linked issue: `Closes #N` / `Fixes #N` in the PR body, or the branch name. Fetch it with
`gh issue view N --json title,body` and pass its acceptance criteria to reviewer 3 verbatim.
If there is no linked issue, say so and let reviewer 3 fall back to the PR description.

Pass to every subagent: the PR number, the diff path, the merge-base sha, the repo root.

## Step 1 — spawn all four in one message

They are independent. One message, four Agent calls, or they run serially and cost four times
the wall clock. Every one of them gets these standing instructions:

- Findings only. No praise, no summary of what the PR does, no scope creep.
- Every finding carries a `file:line` from the current tree. A finding you cannot cite is not
  a finding; drop it yourself rather than making the orchestrator do it.
- Read the surrounding file, not only the diff hunk. Most of these bugs are in the interaction
  between the new lines and the old ones.
- If a check is impossible (no test runner, no linked issue), say so explicitly. Do not
  substitute a different check and report it as if it were the one asked for.

### Reviewer 1 — STATE MACHINE HUNTER

Charter: what the code shows or does before it knows anything.

- Initial, empty, loading and error states. What renders at t=0 with no data?
- Values presented as real before real data arrives. **Precedent: a green "IN ZONE" was shipped
  and displayed before the first heartbeat ever arrived.** Any status derived from a default,
  a zero, or a nullable treated as present is the same bug.
- Race conditions: concurrent writers, callbacks landing after teardown, order-dependent init.
- Stale cached state that survives longer than it should — anything a user could only clear by
  force-closing the app or hard-reloading.
- Lifecycle: background/foreground, rotation, process death, reconnect and retry paths.
  Does reconnect resume, or restart, or silently do neither?

### Reviewer 2 — TEST AUDITOR

Charter: prove the new tests execute. Assertion, not assumption.

Required evidence in the report, all three:

1. Exact paths of every test file added or changed in this PR.
2. The runner's **collected-test count before vs after** the PR's test files, from a real run
   (`npm test`, `./gradlew test`, `pytest --collect-only -q`, whatever this repo uses). Two
   numbers, and the command that produced them.
3. One deliberately broken assertion: flip an expected value, re-run, **show the suite failing**,
   then revert. A test file that cannot be made to fail is not running.

**Precedent: a test suite was written into a stray `android/android/` path and silently never
executed.** Nothing about the file's contents revealed it. Only the count did.

Also flag: assertions that restate the implementation, mocks so complete the test exercises only
the mock, `assertTrue(true)`-grade filler, and tests skipped or filtered out by config.

If the runner cannot be invoked in this environment, report that as a blocking UNVERIFIED — never
infer that tests run from the fact that they exist.

### Reviewer 3 — SPEC DIVERGENCE CHECKER

Charter: does the implementation do what the ticket asked for?

- Compute the merge base first: `git merge-base origin/<default> HEAD`. Never diff against a
  remembered or assumed commit.
- Read the linked issue's acceptance criteria. Walk them one at a time against the code.
- Report three buckets: **missing** (criterion has no implementation), **divergent**
  (implemented differently than specified), **unasked** (shipped and nobody requested it).
- Every one cited with `file:line`. A criterion you believe is unmet but cannot point at is
  reported as "could not verify", not as a divergence.

### Reviewer 4 — EDGE CASE PROBER

Charter: the inputs nobody typed into the happy path.

- Zero, negative, null, missing, empty-string, absent-key. What does each do to the new code?
- **Data crossing a serialization or sync boundary that is written but never parsed on the far
  side. Precedent: speed fields were shipped into the sync payload in `Sync.kt` and never read
  back out.** Check both directions of every new field: written, transmitted, parsed, used.
- Time: timezones, DST, midnight and week/month boundaries, clock skew, monotonic vs wall clock,
  duration math that assumes a day is 86400s.
- Audio focus, interruptions, notifications, permission revocation mid-session (mobile).
- Migrations: is there proof the migration was applied, and does the code behave correctly on a
  database where it was not? Check the applied-vs-declared path, not just the DDL.

## Step 2 — orchestrator merge

Each subagent returns a list of:

```
SEVERITY  HIGH | MEDIUM | LOW
WHERE     path/to/file.kt:123
WHY       what is wrong, in one or two sentences
FIX       the concrete change
```

Then you:

1. **Dedupe.** Same file:line and same root cause from two reviewers is one finding, at the
   higher severity.
2. **Drop everything uncited.** No `file:line` from the current tree, no entry. Do not soften an
   uncitable finding into a "consideration" and keep it. Delete it.
3. **Verify each HIGH yourself** by reading the cited lines before it goes in the review. A
   subagent asserting a bug is not evidence a bug exists.
4. Severity floor: HIGH means wrong output, a crash, data loss, or a shipped-and-visible lie to
   the user. Everything else is MEDIUM or LOW.

## Step 3 — post one review

One `gh pr review`, never four. Body ordered HIGH → MEDIUM → LOW, each finding as
`file:line — why — fix`. Include the test auditor's before/after counts and the broken-assertion
result verbatim; they are the evidence, not commentary.

```bash
gh pr review <PR> --request-changes --body-file /tmp/review-<PR>.md   # any HIGH
gh pr review <PR> --comment          --body-file /tmp/review-<PR>.md  # otherwise
```

Posting a review is outward-facing. Show the body and confirm before the first post of a session.

## Step 4 — fix agents, HIGH only

For each HIGH finding, dispatch one fix subagent. MEDIUM and LOW stay in the review as comments
for the human; do not fix them, do not "while I was in there" them.

Each fix agent gets: the finding, the cited lines, and these standing instructions —

- Commit to `scratch/<pr>-<short-slug>` as soon as there is a compiling increment, and keep
  committing. A usage limit kills agents mid-run; uncommitted work is work done twice.
- Write the task list to a file before starting, so a fresh session resumes from the branch and
  the list rather than re-deriving the analysis.
- Add a regression test that fails before the fix and passes after. Show both runs.
- Fix the cited finding and nothing else.

Serialize fix agents whose findings touch the same file. Parallelize the rest.

## Report

At the end, per PR:

- Findings posted, by severity.
- HIGH findings fixed, with branch and commit sha for each.
- Anything the swarm could not check, named as UNVERIFIED with the reason. A silent omission is
  the failure this command exists to prevent.
