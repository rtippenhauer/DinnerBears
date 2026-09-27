Phase $ARGUMENTS is complete. 

0. Confirm the current branch is this phase's branch (`phase-$ARGUMENTS-*`), not `main`. If somehow on `main`, stop and ask Rob before committing anything — all phase work and its doc updates belong on the phase branch; the merge into `main` happens later in this same command (step 8), not before it.

   This command assumes `/phase-testing` has already put the phase on stage and
   Rob has confirmed it looks right. If that hasn't happened, say so and offer to
   run `/phase-testing` first rather than merging untested work — step 8 merges
   into `main`, which is the point of no return.

1. Provide a customer-friendly release note summary of everything completed.
   Append it to `docs/NEXT_RELEASE.md` under a heading for this phase's area
   (create the file from the template below if it doesn't exist yet). Don't
   remove or rewrite existing entries already in the file — only add to it.
   Write copy using the `{{points}}`/`{{locations}}`/`{{events}}` placeholder
   tokens instead of hardcoded DinnerBears wording, since this draft ships to
   every fork (see `docs/RELEASE_NOTE_PIPELINE_SPEC.md`). This step itself is
   still just a draft accumulator — it doesn't touch the `releases` table or
   any production API directly — but the stage image rebuilt in step 9 below
   ships this updated draft, and a boot-time importer
   (`ReleaseNotesImporterService`) automatically publishes it to stage's
   `/updates` page once that container restarts (gated on `IS_STAGE=true` —
   it never surfaces on prod until `/release` finalizes it). No separate
   publish action needed on Rob's part.

   ```
   # Next Release — Draft Notes

   Running draft of unreleased, customer-facing changes. Appended to automatically
   by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
   `/release` uses this file as the starting draft and clears it back to empty
   once that release's draft has been created.
   ```

2. Update CLAUDE.md:
   - Move the current phase to the completed list (collapsed to a single line)
   - Update "Current Development Phase" to the next phase with a one-sentence summary
   - Remove any context specific to the finished phase that won't carry forward
   - Do not touch conventions, stack info, or DB rules

3. Update PHASES.md:
   - Add ✅ Complete to the finished phase header
   - Add ✅ In Progress to the next phase header

4. Update docs/DATABASE_SCHEMA.md:
   - Add any new tables introduced in this phase
   - Update any modified tables (new columns, indexes, enum values)
   - Update the _Last updated_ date at the top
   - Update the Table Index to include new tables

5. Update docs/PORT_TO_COMMUNITYEVENTS.md — the running record of v1 work
   that still has to be re-implemented in CommunityEvents (the v2 rewrite, a
   separate repo). CommunityEvents forked from v1 at Phase 38 and has since
   diverged (Prisma, tenant-scoped data), so v1 code is never copied there; it
   is rebuilt from this document, which Rob brings over when v2 is ready for it.
   Nothing in this step touches the CommunityEvents repo.

   Create the file if it doesn't exist, with a short intro saying what it is,
   plus a summary table (phase, title, v1 PR/tag, database changes yes/no,
   ported yes/no) and a **Database changes** section. Then add or refresh this
   phase's section. Build it from what actually shipped — the phase branch's
   diff, its e2e specs, PHASES.md, and any API docs the phase added (e.g.
   docs/MUSE_API.md) — not from memory:
   - what the phase does and why, in a few sentences
   - every rule and edge case, including the ones its e2e tests pin down
   - API contracts: routes, request/response bodies, auth. Anything an outside
     integration calls (Muse) must keep the **same contract** in v2, so the
     integration only changes its base URL and token.
   - UI changes, briefly
   - **v2 notes**: what has to change under tenancy (tenant columns,
     per-tenant uniqueness and settings), and where it overlaps something v2
     already has — e.g. v2's `users.is_service_account` vs v1's
     `is_automation_account`, or v2's `disabled` role. Check CommunityEvents'
     `V2_PHASES.md` and `CLAUDE.md` read-only for these (it's at
     `..\CommunityEvents`); if it isn't available, say the check wasn't done.
   - v1 references: the phase tag and the branch name (the PR number is filled in
     once step 8 opens the PR).

   In the **Database changes** section, list every table, column, index and
   enum value this phase's migrations added, changed or dropped, with the
   migration file names, and for each say whether the DinnerBears import into
   v2 (CommunityEvents `v2-25`, `docs/REQ-IMPORT-01.md`) must copy that data and
   how — e.g. Facebook account links and ban records must be copied; API tokens
   must not (they're reissued in v2). That section is how the import learns
   about tables added after its spec was written.

6. Commit all five files (CLAUDE.md, PHASES.md, docs/DATABASE_SCHEMA.md,
   docs/NEXT_RELEASE.md, docs/PORT_TO_COMMUNITYEVENTS.md) with message:
   "docs: phase $ARGUMENTS complete"

7. Tag the commit: `git tag -a phase-$ARGUMENTS -m "Phase $ARGUMENTS complete"`.

8. **Merge the phase branch into `main`:**
   - Push the branch: `git push -u origin <branch>`
   - Push the tag: `git push origin phase-$ARGUMENTS`
   - Open a PR into `main`: `gh pr create --title "<branch/phase description>" --body "<short summary of what's in it>"`
   - Write the new PR's number into this phase's entry in
     `docs/PORT_TO_COMMUNITYEVENTS.md`, commit it on the phase branch
     ("docs: port record PR for phase $ARGUMENTS") and push, so it merges
     with everything else — `main` is never committed to directly
   - Merge with a real merge commit — never squash or rebase, so the branch's
     individual commits and the `phase-<N>` tag stay reachable from `main`'s
     history: `gh pr merge --merge --delete-branch`
   - `git checkout main && git pull origin main`, then delete the local
     branch if it wasn't already removed: `git branch -d <branch>`

9. Build and push the stage image: `bash scripts/publish-stage.sh`. This
   updates the `stage` tag on Docker Hub only — never touches
   `rtippenhauer/community-events:latest` (prod), which is exclusively
   `/release`'s job.

   If `/phase-testing` already pushed this phase to stage, this is **not** a
   second deploy of new code — it is a re-stamp. Two things genuinely changed:
   the merge commit is now `main`'s HEAD (and the footer displays the running
   commit, so stage would otherwise report a commit that no longer exists on any
   branch), and step 1's `docs/NEXT_RELEASE.md` entry ships in
   `release-notes/_draft.md` for the first time, which is what surfaces this
   phase on stage's `/updates` page. Tell Rob a container restart is still
   required for either to take effect.

10. Report back a short summary: files updated (including the
   PORT_TO_COMMUNITYEVENTS.md entry and whether it lists database changes),
   commit + tag created, PR merged into `main`, stage image rebuilt and pushed.

When done, run /clear.