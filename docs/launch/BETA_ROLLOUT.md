# Contexa public beta: operator and participant handoff

## Release decision

Read [the dated readiness report](2026-10-31/READINESS.md) before posting. A public
LinkedIn link is not an admission limit: 5–10 is the target cohort, not a signup
cap. Keep the early-beta description in the post. No invitations or posts have
been sent by the agent.

## Operator go-live steps

1. Deploy the audited backend commit and require green CI. Verify the private
   cache policy on the live site after deployment. Keep the previous deployed
   commit available for rollback; do not roll database data back with the code.
2. Complete the browser acceptance pass below using a synthetic/public project.
3. Verify the database's scheduled backup/retention settings and an independent
   copy of the field-encryption key. A one-time recovery drill is not a schedule.
4. Confirm how you will receive error alerts and feedback. For the first cohort,
   check Render logs and `/readyz` during onboarding and ask for feedback in the
   LinkedIn post. Do not describe this manual watch as automatic monitoring.
5. Start with two testers. If both complete a handoff without a critical failure,
   invite feedback from the next three, then expand toward ten. A public post may
   bring more visitors; watch capacity and stop promoting the link if needed.

Useful commands:

```powershell
git -c http.version=HTTP/1.1 push origin main
cd 'Rest Saas Frontend'
npm run check:deployment -- --frontend https://contexa.tech --api https://context-engine-z4s8.onrender.com
```

After the backend deploy, run the authenticated smoke script once. It creates
two synthetic accounts, uploads only its own small fixture, deletes its own
snapshots and logs out. It is not a production stress test:

```powershell
& 'Rest Saas/.venv/Scripts/python.exe' scripts/launch_readiness_smoke.py --api https://context-engine-z4s8.onrender.com --output docs/launch/post-deploy-acceptance.json --allow-create-test-accounts
```

The codebase does not currently provide self-service password reset or account
deletion. Do not advertise those workflows as available. Choose an account
support process before inviting people who will rely on long-term saved data.

## Browser acceptance: desktop and phone

Record browser, viewport, release commit, and pass/fail for each row. Check light
and dark themes. Use a second account only with its own disposable test project.

| Journey | Required result | Result |
| --- | --- | --- |
| Register, logout, login | Account created; old token rejected; project stays private | Pending visual check |
| Import a small source folder | Preview/exclusions clear; import completes; no silent file truncation | Pending visual check |
| Prepare one task | Progress resolves; reload resumes; exported task and selected source match | Pending visual check |
| ERD on a relational snapshot | All tables fit; search finds a field; zoom/pan and inspector work | Pending visual check |
| Empty/no-DB snapshot | Useful empty state; no application-wide crash | Pending visual check |
| Claude handoff | Exact handoff copied; prefill/fallback is clear; review and Send stay with user | Pending visual check |
| Save, restore, follow up | Original task preserved; saved output restored exactly | Pending visual check |
| Delete the test snapshot | Removed from library; related temporary handoffs no longer accessible | Pending visual check |
| Cold start / network failure | Clear waiting/error status; retry works without duplicate actions | Pending visual check |

Claude account sign-in, provider OAuth callbacks, and actual browser paste must
be checked in an authorized browser session. API checks do not establish these.

## Participant quick start

1. Visit **https://contexa.tech** and create an account.
2. Start with a sample/public project or a small folder you are allowed to upload.
   Source is uploaded to Contexa for context preparation. Review excluded files;
   do not use credentials or sensitive client data for your first beta exercise.
3. Describe one small change and how you will know it works. Use fast preparation
   for the first exercise. Review selected source, omissions and any gaps.
4. Explore the architecture and, when a relational database was captured, the
   ERD. Search for a table or field and open its explanation.
5. Open Claude, then paste if the composer is empty. The handoff button copies
   the AI handoff; copying is not proof of insertion. Claude Code needs an
   eligible account. Contexa does not buy or grant a Claude subscription.
6. Review/apply the AI's proposed changes locally and run your project's checks.
   Paste a source request or relevant test error into the follow-up field if
   needed. Reimport after changing the underlying project.
7. Export any handoff you want to keep and delete your test snapshot afterwards.

Free web hosting can take roughly a minute to wake after inactivity. The beta
does not promise always-on availability or generated-code correctness. Source
snapshots represent the captured version, not a live view of your repository.

## Feedback to request

Ask for browser/device, step attempted, expected versus observed result,
approximate waiting time, and whether the handoff helped complete the task.
Screenshots should omit source, tokens, credentials and private project details.
Do not ask testers to put private source or compiler logs in public comments.

| Tester alias | Browser/device | Import completed | First handoff completed | ERD understandable | Task outcome | Main friction | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |

Pause promotion for any cross-account data access, lost saved data, repeated
server failures, stranded preparations, or private data exposed in a response.
Reproduce with a synthetic project, fix, and repeat the affected acceptance
checks before resuming. Do not ask affected users to retry destructive actions.
