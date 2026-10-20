# Context-selection checks

Run from the project root:

```powershell
& '.\Rest Saas\.venv\Scripts\python.exe' docs/benchmarks/run_context_checks.py
```

This runs three original known-answer scenarios (large generic Express,
Django and React modules) and two pinned, MIT-licensed public application
snapshots. Source and notices are in `public_apps/`. Downloaded application
source is **never executed**. Collection omits tests, dependencies, static/vendor
assets, secrets and migrations; the retained source is a bounded snapshot,
not a claim that an entire repository was captured. Sources were redacted by
Contexa's privacy filter. `collect_apps.py` keeps an existing snapshot pinned.

`context_before.json` was recorded before the selector changes;
`context_after.json` uses the same controlled fixture hashes.
`public_contract_report.json` compares a frozen Git revision of Contexa with
the revised selector on identical public snapshots and task requirements.
The baseline splits an equal total budget between its two copied packs.
`--baseline-ref <trusted-Contexa-revision>` re-runs that comparison by executing
the selector from that revision, never the downloaded application code.

At the 10,000 estimated-token ceiling, the revised handoffs contain all **18
checked contracts**: Express uses about 7,766 estimated tokens and Django
about 7,003. The frozen selector finds 4/9 and 6/9 respectively. At a 4,000
ceiling the new handoffs are incomplete and explicitly say so. Increasing a
budget preserves more necessary source; it does not change a provider's limits.

These are **agent-authored contract checks**, based on reading the pinned
source: handlers, validators, auth, ORM models, response helpers and mounting.
They do not establish a complete gold set, semantic precision, all-stack
generalization, or successful code generation. No coding model was called and
no generated code was compiled/tested. The same tasks informed implementation,
so these are regression checks, not an independent blind evaluation.

For a customer trial, hold out new projects/tasks, compare equal total input
budgets on the same coding model, and record compile/test outcomes, missing
context requests and token usage. Provider account/session limits require
measuring on that provider. Do not describe the current reports as evidence
of first-try generated-code success.

`expanded_checks.py` adds the official FastAPI full-stack template and a
Next.js/React Hook Form/Apollo/Prisma application, with 16 additional explicit
contracts and checks excluding unrelated implementations. All 16 markers fit
at the 10,000-token ceiling. FastAPI still reports incomplete analysis for a
newer Python grammar, despite preserving the full original file and imports.
The Next task fits at roughly 3,810 estimated tokens with the larger ceiling;
the 4,000 ceiling's safety reserve omits other selected dependencies, which are
explicitly reported even though our six checked markers happen to fit.
All four fixture licenses and commit pins are retained. These checks informed
the fixes and do not constitute an independent held-out evaluation.
