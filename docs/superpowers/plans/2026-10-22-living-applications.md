# Living Applications implementation plan

> **For agentic workers:** Use superpowers:executing-plans or focused delegated implementation. Track verified work below.

**Goal:** Extend Genesis with bounded real APEX application evolution while preserving its working experiments.

**Architecture:** Add a versioned genome and Oracle packages, a guarded materialization worker, real browser tasks and evidence-driven replay. Oracle owns genetic decisions and fitness. The existing supervisor and publication backend remain intact.

**Tech Stack:** Oracle PL/SQL, APEX 26.2 APEXlang, SQLcl, Node 22, Playwright, existing static exhibition.

**Spec:** [Living Applications](../../architecture/living-applications.md), plus the user's 0.3 master brief.

## Global constraints

- English; synthetic data only; Apache-2.0 for original code.
- No changes to historical genome/fitness/archive definitions.
- Explicit sandbox allowlist before database writes or imports.
- No new paid run without fresh authorization; no second ledger.
- No claims of real APEX descendants until import, runtime and tasks have evidence.

## Review focus

- Unknown keys and code-shaped mutations must fail closed.
- Existing applications and unowned slots cannot be overwritten or cleaned.
- Missing or contradictory evidence cannot imply a successful test or survivor.
- Untrusted public paths, hashes and lineage must be checked before rendering.
- Existing supervisor and dataset tests must remain passing.

## Tasks

1. [x] Audit repository, history, operation, tooling and baseline tests; verify both historical datasets.
2. [x] Add `application-genome.schema.json`, JS boundary validation and immutable proposal application; test unknown keys, every allele, required tasks and canonical hashes.
3. [x] Add isolated PL/SQL application genome/genetics and versioned fitness; add integration checks without modifying old engine packages. Actual Oracle contract: 69 checks passed.
4. [x] Add sandbox/slot guard and explicit materialization state contract; test unauthorized destinations, stale claims and forbidden transition shortcuts. Actual Oracle lifecycle: 45 checks; import audit: 13 checks.
5. [x] Derive trusted Order Lab APEXlang templates from installed metadata; run compiler validation before enabling mappings. All 16 supported combinations passed SQLcl 26.3; metadata remains 26.2.0+3479.
6. [x] After explicit sandbox configuration, install fixed synthetic fixture API, import one descendant, verify authentication/runtime and three tasks against database records. Real apps 133/130 passed.
7. [x] Persist lineage, evidence hashes and Oracle scores; compare bounded candidates under a frozen protocol; retain failures. Run 61baf73fb822430bb27310d22c0744e8 completed, both 89.675, parent retained on tie.
8. [ ] Integrate model proposals with the existing ledger only after a fresh per-run budget exists; otherwise reject paid application runs.
9. [ ] Add Create/Evolve/Watch control experience and public Living Applications replay backed by genuine evidence; test desktop/mobile, accessibility, integrity and safe empty states.
10. [ ] Integrate bounded autonomous scheduling and existing immutable publication after the private complete loop passes; preserve dashboard operation.
11. [ ] Run paired trials; document actual results and remaining limitations; prepare release/article/video only after acceptance gates pass.

For each implementation task: write a meaningful failing test, observe failure,
implement, rerun its checks, review its boundary and record the actual result.
Run baseline unit/browser/export regressions after integration. Do not install
packages into the active LAB or enable publication merely to exercise code.

## Execution record

- User delegated sandbox selection. A new `APXGEN_ORDER_LAB` owner/workspace was
  created; application pool 130..133 is explicit, with 120/121 protected.
- Initial real import to application 130 succeeded, including destination metadata
  verification. Run `8d429807aa534b7893fca44c11997e6d` then failed before browser
  testing because a locking fixture-hash function was invoked through SELECT.
  Oracle rejected the baseline and retained the failed run. No task result or
  survival claim is attributed to it. The imported application is preserved.
- Corrected direct PL/SQL hash invocation and strengthened task version/audit,
  navigation, request-error, fixture and cross-partition checks before the next
  feasibility run. New source/evaluator hashes distinguish these attempts.
- Import attempts commit an immutable identity through a separate audit connection;
  a unique organism constraint prevents automatic retries after failure or crash.
- Windows checkout exposed a missing HTML LF rule. The existing renderer-byte
  regression failed before adding that rule and passed after canonical regeneration.
- Historical dataset verification remains passing. Paid requests remain zero.
