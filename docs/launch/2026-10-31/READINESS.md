# Launch-readiness pass — 31 October 2026

**Decision: HOLD the LinkedIn beta announcement until the deployment and browser
gates below are closed.** This is a public-beta assessment, not a certification
for an unrestricted production service.

## Verified results

| Area | Result | Evidence |
| --- | --- | --- |
| Backend, after security patches | 140 tests passed | [test output](backend-tests.txt), [JUnit](backend-tests.xml) |
| Frontend | 107 tests passed across 22 files | [test output](frontend-tests.txt), [JSON](frontend-tests.json) |
| Production frontend build | Passed with the deployed HTTPS API origin | [build output](frontend-build.txt) |
| Backend dependency audit | Zero known vulnerabilities in 30 resolved packages after updates | [current audit](backend-audit.json) |
| Frontend dependency audit | Zero known vulnerabilities, including development dependencies | [audit](frontend-audit.json) |
| Ingestion runtime dependency audit | Zero known vulnerabilities | [audit](engine-audit.json) |
| Django checks and migration drift | System check passed; no missing migrations found | Commands recorded below |
| Pinned application contract fixtures | Required contracts retained at the release budget; tight budgets can remain incomplete | [public fixtures](public_contract_report.json), [expanded fixtures](expanded_contract_report.json) |
| Live services | Liveness/readiness 200; database and Redis healthy | [service checks](public-service-checks.json) |
| Live authenticated API acceptance | 37 of 38 checks passed; the cache-policy failure is fixed in source and awaits deployment | [acceptance report](live-acceptance.json) |
| Ten simultaneous lightweight authenticated reads | All 200; median 2.586 s, maximum 2.750 s | [bounded capacity check](concurrent-reads.json) |
| Two simultaneous small context preparations | Both admitted and completed | [acceptance report](live-acceptance.json) |
| Application backup and isolated recovery | Encrypted backup restored; every application record and model count matched; scratch database removed | [recovery drill](restore-drill.json) |

The live synthetic flow exercised registration, login, token revocation,
profile/library reads, folder import, credential-file rejection, preparation,
follow-up with task preservation, exact saved-handoff restore, signed Claude
prefill retrieval, link revocation, and cross-account read/delete/prepare/list
denial. Its own snapshot was deleted and sessions were revoked. No customer
project was modified and no prompt was sent to an AI provider. The two empty
synthetic accounts were removed by a guarded cleanup requiring the exact
generated identities, creation window, no sessions, and no project/connection
data. [Cleanup evidence](synthetic-account-cleanup.json).

Ten profile reads are not ten simultaneous large imports, semantic indexing,
or a stress test. API acceptance does not verify a rendered ERD, OAuth callback,
Claude login, browser clipboard behavior, or AI-generated-code correctness.

## Fixes made

Commit **bee9fc1**:

- Default private API responses to `Cache-Control: no-store, private` and vary
  them by Authorization. Existing explicit no-store policies remain intact.
  The live snapshot endpoint had no explicit cache policy. This was a missing
  privacy control; the test did not establish that a cache exposed customer data.
- Update Django REST Framework **3.17.2 → 3.18.2**, dnspython **2.8.0 → 2.9.0**,
  and PyMongo **4.18.2 → 4.18.3**. The prior audit found five published issues in
  these packages; the patched requirements resolve to a clean audit.
- Isolate unit-test caches from real Redis, so a unit run cannot clear or consume
  counters from a developer/production cache.

Primary security references:
[DRF](https://github.com/encode/django-rest-framework/security/advisories/GHSA-33wh-fxxf-88vv),
[dnspython](https://github.com/rthalley/dnspython/security/advisories/GHSA-45c3-73f7-pv4m),
[PyMongo](https://github.com/mongodb/mongo-python-driver/security/advisories/GHSA-98qm-wvgf-w4cf).
The complete prior findings are retained in [the pre-update audit](backend-audit-before.json).

## Remaining release gates

1. **Deploy the security commit.** The attempted push did not authenticate:
   Git's credential dialog did not complete and terminal prompts were disabled.
   Nothing in this pass proves the fixes are deployed. Push normally, require
   green CI, wait for Render to finish, then repeat the live acceptance check.
2. **Complete actual browser acceptance.** Browser discovery still reports
   `The browser access host is unavailable`. Follow the desktop/mobile checklist
   in [the rollout handoff](../BETA_ROLLOUT.md). Automated component tests do not
   replace this check.
3. **Verify ongoing recovery and operations.** Check the final restore-drill
   result (passed). Confirm scheduled/off-site backup retention, encryption-key recovery,
   alert delivery, and an account-support contact/process. An encrypted local
   backup and a successful one-off drill do not establish ongoing automation.

There is currently no self-service password-reset or account-deletion endpoint.
Social sign-in start URLs return 200, but provider callbacks were not completed
in a real browser in this pass. Do not advertise unverified recovery features.

The database inspected here is the configured external PostgreSQL database,
not a local SQLite file. The recovery tool creates a uniquely named scratch DB;
it never restores into production. Backups contain private application data and
are encrypted under `tmp/launch-backups/`, which Git ignores. The encryption key
is read from the existing local production env file and is not in any report.
Redis queue state and full Postgres/PITR are outside the application fixture drill.
All records in the encrypted fixture matched the restored application export.
The scratch database was removed after terminating only its idle pooled
connections. Production was never a restore target. This proves one application
recovery from this backup; it does not establish an off-site schedule or alerting.

Render's free web services can sleep after inactivity and have resource limits.
Keep the beta expectations explicit; do not promise always-on production
availability. [Render's documented free-instance limits](https://render.com/docs/free)
apply to the relevant service plan, not automatically to the external database.

## Reproduction

From `Rest Saas`:

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip_audit -r requirements.txt
```

From `Rest Saas Frontend`:

```powershell
npm test
npm audit
npm run check:deployment -- --frontend https://contexa.tech --api https://context-engine-z4s8.onrender.com
```

From the repository root, with the backend environment and fast mode:

```powershell
$env:CONTEXA_SEMANTIC='0'
& 'Rest Saas/.venv/Scripts/python.exe' docs/benchmarks/run_context_checks.py --output-dir docs/launch/2026-10-31
& 'Rest Saas/.venv/Scripts/python.exe' docs/benchmarks/expanded_checks.py --output-dir docs/launch/2026-10-31
```

Operational scripts require explicit flags for creating test accounts or a
scratch restore database. They report no credentials. The owner should run them
only against the intended service; review the target before doing so.

## Public-beta handoff

- [Operator checklist, participant quick start, and 10-person feedback tracker](../BETA_ROLLOUT.md)
- [LinkedIn draft for the owner to publish after the gates pass](../LINKEDIN_DRAFT.md)

No LinkedIn post or invitation was sent. The beta has not been declared launched.
