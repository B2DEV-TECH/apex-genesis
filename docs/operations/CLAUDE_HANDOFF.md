# APEX Genesis — operational handoff for Claude

Prepared 2026-10-20 for Geraldo Viana Jr. All project code, documentation, UI and
publication text must remain English. Continue implementing; do not replace real
Oracle experiments with simulated results. Read README, the release report and
the Git status before changing anything. Preserve existing experimental archives.

## Verified handover snapshot

The Haiku comparison is complete and publicly deployed. All 15 runs completed 100
advances plus generation 0 (18,180 organisms). Real Haiku requests 100, approved
proposals 100, rejected cohort attempts 0. All five final Darwin/Haiku scores tied
at 98.95. Cohort usage-derived cost USD 0.0061064; session total including two
integration trials USD 0.0063337. No invoice or superiority claim.

Code 36f5e0e was merged in source PR #4 (main 75164df); website 9de1a4a was merged in
website PR #3 (main ed12cd8). Deployment 823a3519-989f-48a1-b84c-834b9be82546.
All 1,520 live dataset files match manifest SHA-256
9c96edc4493039788e284ee11837be8659340823cff502e9397def2569db1e1c.
Production Edge 10 checks passed, including actual Haiku replay. The exact final
portable SQL export was independently imported as app 121 and passed 10 checks.
See [machine-readable receipt](../releases/publication-receipt.json).

At handover: all cohort run budgets are stopped; no Genesis scheduler job is
enabled, and no continuous Node controller is left running. Historical test jobs
were stopped without deleting their records. Oracle/ORDS remain available.
The provider row is enabled, but new runs default to paid execution disabled and
model/pricing verification expires after one day. Current lab storage 119,341,056
bytes (about 114 MiB), against the dedicated owner's 500 MiB quota. Continuous
operation needs measured storage limits and a retention/archive policy; do not
silently delete evidence, enlarge quotas or reset the spending ledger.

The completed cohort runner is not an always-on service. Do not rerun it merely
to continue activity. Historical recovery expects its archived 54f35e5 source
hashes; later publication changes intentionally differ. Build a new, tested
controller under the next objective below.

## Authorized scope

The owner requested periodic commits, pushes and merges, real Haiku comparisons
in the public exhibition, and a handoff to make operation continuous. Source and
article/site publication are authorized after security and verification checks.
The API key was configured as an APEX Web Credential; it was never written to
project files. The owner explicitly authorized **USD20 aggregate API spending**.
This is a ceiling, not a target and not a daily allowance that renews indefinitely.
Never reset the lifetime ledger or raise its cap automatically. No unrelated
database, APEX application, employer/client material or repository is in scope.

## Locations and access

- Project: `C:\Users\geefa\Documents\B2DEVTECH\apex-genesis`
- Public source: https://github.com/B2DEV-TECH/apex-genesis
- Isolated website checkout: `C:\Users\geefa\Documents\B2DEVTECH\genesis-site`
- Original website checkout: `C:\Users\geefa\Documents\b2dev.tech`; preserve it.
- Branches used: source `develop`, website `feature/apex-genesis`; inspect current
  remote state and use new reviewed PRs where practical.
- Ignored `.local/oracle.json` holds local owner and APEX connection configuration.
  Use the provided helpers. Never print its secret values or put them in shell
  arguments/logs/Git. `.local/verify-oracle.json` is the disposable verification
  owner, not the publication owner.
- Oracle owner/workspace APXGEN_LAB; native app120, alias apex-genesis:
  `http://127.0.0.1:8080/ords/r/apxgen_lab/apex-genesis/genesis-1`
- Disposable APXGEN_VERIFY owner/workspace, native app121. **Mock budget/AI suites
  modify provider settings: run them only with APXGEN_CONFIG pointing here.**
- Credential static ID APXGEN_HAIKU. Only use it through APEX_WEB_SERVICE.
- Node22.16; Oracle26ai Free23.26.3.0.0; APEX26.2.0; SQLcl26.3 thin:
  `C:\sqlcl\bin\sql.exe -thin -nohistory -noupdates -S /nolog`.
- SQLPlus `C:\app\geefa\product\26ai\dbhomeFree\bin\sqlplus.exe`.
- Browser evaluator: Playwright Chromium141.0.7390.37. Media verification uses
  installed Edge155 because bundled Chromium lacks H.264/AAC codecs.
- ffmpeg/ffprobe: `C:\ffmpeg-8.1.1-essentials_build\bin`.
- GitHub CLI and existing Cloudflare Wrangler OAuth were working. Recheck login
  without printing tokens. No production D1 migration was needed.

## Implemented architecture and operational truth

Oracle owns RNG, genomes, selection, mutation, compatible crossover, elites,
lineage, fitness, run transitions, budgets and events. Node is the trusted real
browser measurement worker. It does not implement the genetic algorithm.
DBMS_SCHEDULER can call APXGEN_EVOLUTION.TICK without an open APEX browser tab.
It cannot measure browser geometry alone. Both Oracle and a worker must remain
available. Each current run stops at its configured generation/time boundary.

The public website is a static, recorded replay. It cannot trigger paid calls or
Oracle execution. Publishing newly completed runs is a separate validated export
and website deployment step. **A persistent service, reboot recovery and automatic
run queue/publication daemon have not been installed.** Do not tell the owner the
current finite experiment runs forever.

The shared renderer has11 bounded genes and real synthetic controls. Genome/schema
validation, hard accessibility/geometry constraints, immutable per-run weights
and deterministic scoring remain independent of model proposals. Full axe audits
are release checks, not a per-candidate measurement. No generated code is executed.

## Current provider controls

Runtime Models API verified `claude-haiku-5-5`, including thinking-disable support.
Reviewed short-prompt rates: USD0.10/input million, USD0.50/output million on
2026-10-20. Recheck official pricing and model availability before a later session;
the DB requires verification and pricing timestamps less than one day old.

The aggregate lifetime and UTC daily limits are20. Per-run cohort limit1;
max20 attempts/run, one per due generation, interval5, input2048, output256,
concurrency1, automatic retries0. Reservations serialize on the provider row and
commit before HTTP. Requests read model/token limits from the reservation snapshot.
Thinking is explicitly disabled; otherwise the initial live trial exhausted256
output tokens before yielding an acceptable proposal.

Returned usage estimates are not verified invoices. Unknown billing retains its
reservation and stops that run's AI. Stop AI prevents new requests; already-sent
HTTP cannot be unsent. Do not clear stopped budgets automatically after an error.
The engine safely falls back to genetic operators. Mock tests remain labeled TEST
and must never appear as actual Haiku research results.

## Research archives and evidence

1. `showcase/datasets/pilot`: immutable engine1.0.0 offline pilot at `be49b9d`,
   five paired GA_ONLY/RANDOM_SEARCH seeds,100 advances plus generation0,
   12,120 candidate records,1,015 manifested files. Mean paired final difference
   1.0230776 points. No API usage. Do not relabel it as the newer engine.
2. `experiments/configurations/haiku-paired.json`: preregistered engine1.1.0
   cohort at source `54f35e538b75722af22efc61dc321fd35134d682`, five seeds,
   GA_ONLY/GA_HAIKU/RANDOM_SEARCH,100 generations,12 population, equal1,212
   slots/condition. Prior pilot saturation at 98.95 was disclosed before running.
   See `experiments/published-results/HAIKU.md` and `haiku-analysis.json` for
   final actual outcomes; never infer them from the condition name.
3. Separate one-generation live validation: `docs/testing/live-haiku.json`.
   Rejected trial cost0.0001615; successful333input/65output trial0.0000658.
   Both outside the main cohort. No invoice verification claimed.

The finite cohort runner checkpoints `.local/haiku-suite.json`. If interrupted,
inspect run/ledger state first; `node scripts/run-haiku-suite.mjs --authorized`
checks the recorded source hashes and resumes the same cohort. It is not an
infinite service, and must not be reused to silently create another paid cohort.

## Useful commands

```powershell
Set-Location C:\Users\geefa\Documents\B2DEVTECH\apex-genesis
git status --short
npm test
$env:APXGEN_CONFIG='.local/verify-oracle.json'
node tests/integration/database.mjs
node tests/integration/budget.mjs
node tests/integration/ai-boundary.mjs
node tests/integration/ai-fallback.mjs
node tests/integration/provider-contract.mjs
Remove-Item Env:APXGEN_CONFIG
node scripts/verify-export.mjs showcase/datasets/haiku-paired
node scripts/analyze-haiku.mjs
node tests/browser/showcase.mjs
node scripts/audit-source.mjs
```

For a **new finite offline run**, no key is needed:

```powershell
node scripts/run-experiment.mjs --mode=GA_ONLY --seed=42 --size=12 --generations=5
```

Do not use routine tests to send real model requests. `verify-provider.mjs` performs
an authenticated model lookup, with explicit reviewed price/ceiling arguments;
`live-haiku-test.mjs --authorized` sends a paid trial. The owner ceiling persists,
but do not rerun validation merely to demonstrate activity.

## Deployment

`node scripts/prepare-site.mjs ../genesis-site` copies the verified static replay,
article and captions into the isolated website checkout. Stop a local Wrangler
preview before building on Windows, otherwise its open handles can cause EBUSY.
Run existing site typechecks/tests/lint/build, create a scoped site PR, then use its
existing `wrangler deploy` workflow. No new permanent backend is needed for replay.
Verify the actual public article, iframe interaction, mobile, preview CSP and
every file in the public manifest; `tests/browser/publication.mjs` and
`scripts/verify-public.mjs` provide checks. Never deploy an incomplete dataset.

Public article: https://b2dev.tech/blog/apex-genesis-evolving-interfaces-plsql-claude
Exhibition: https://b2dev.tech/genesis/index.html
Original real offline video: https://b2dev.tech/media/videos/apex-genesis/v0.1.0-alpha.1/apex-genesis-demo.mp4
Its hash, real run and synthetic English narration disclosure are in
`media/video/evidence.json`. Preserve immutable media URLs; the original video
does not demonstrate the later Haiku cohort.

## Next engineering objective: continuous supervised operation

Implement a bounded autonomous controller, not an unbounded while-loop of paid
requests. Read actual run/budget state; recover stale workers and leases; keep one
owned worker instance; queue finite seed-controlled runs; honor pause/stop and
resource limits. Use a documented Windows service or Task Scheduler task with
hidden background processes, clean shutdown, restart/backoff, heartbeat and a
single-instance lock. Keep secrets in APEX/ignored configuration.

Define a policy that continues offline when the aggregate paid budget is exhausted
or provider verification expires. Never automatically renew the20USD authorization.
Version changed algorithms/objectives and preregister a new cohort before comparing
them. Keep model invocations bounded and do not silently change the research score
to make Haiku look better. Add recovery, duplicate-controller, cancellation, full
disk/storage and budget tests before installing the persistent controller.

Automatic publication should export only completed runs, verify source provenance,
genome/metric/manifest integrity and sanitization, then update the existing static
site through its established workflow. Keep prior datasets addressable. Expose
recorded timestamps and distinguish a running private experiment from public replay.
Persist real evidence and leave periodic reviewable commits/PR merges for the owner.

Current alpha limitations: no human task study, Pareto/rank selection, adaptive AI
policy, alternate model adapter, full process-level hardware profiling or broad
Oracle version support. Automatic fitness is a proxy; the winning layout can be a
long single-column page. Do not claim general UI beauty, usability or significance.

The final release report identifies the last deployed source/site revisions and
validated results. Reconcile it with Git and the database before further work.
