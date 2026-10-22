# Application AI budget broker: proposed WP6 boundary

Status: design for review. No migration, broker, provider request or application
AI authorization is implemented by this document. The recorded GA_ONLY protocols,
source fingerprints, native applications and public cohorts remain unchanged.

## Intended result

An explicitly authorized application run may request a compact structural
proposal for its evaluated parent. Oracle validates the proposal, creates its
child and independently evaluates that child through the existing compiler,
import, authentication, security, task and fitness gates. The model supplies no
code or fitness. Paid requests share the existing physical financial ledger and
provider limits with dashboard evolution.

The application sandbox must not acquire its own runtime invocation ledger,
copied historical balance, synthetic dashboard run or numeric shadow parent.
Application spending starts disabled. Previous dashboard authorization does not
authorize an application run, credential use, model verification or a paid trial.

## Existing source contracts

| Contract | Source and implication |
| --- | --- |
| Global provider authority | [001_core.sql](../../database/migrations/001_core.sql) defines `APXGEN_PROVIDER_CONFIG(singleton=1)` with `max_concurrency=1`. [apxgen_budget.sql](../../database/packages/apxgen_budget.sql) locks that exact row before reservation, reconciliation and recovery. |
| One financial ledger | `APXGEN_INVOCATIONS` has a VARCHAR2(32) legacy `run_id` FK to `APXGEN_RUNS`, a numeric `organism_id` FK to legacy organisms, reservation/rate/model snapshots and usage. [002_ai_offspring.sql](../../database/migrations/002_ai_offspring.sql) adds numeric `applied_organism`; [005_total_budget.sql](../../database/migrations/005_total_budget.sql) adds the provider lifetime cap. |
| Existing sums | `reserve` counts all RESERVED invocations and sums `NVL(actual_usd,reserved_usd)` for the legacy run, the existing UTC daily window and the entire ledger. No terminal-state filter removes rejected or uncertain attempts from these sums. |
| Legacy recovery | `recover_stale` scans all subjects implicitly: RESERVED rows older than 120 seconds become UNCERTAIN; old RECONCILED rows without proposal/error become `STALE_RESPONSE`. Its current stop updates target only `APXGEN_RUN_BUDGETS`. |
| Existing transport | [apxgen_ai.sql](../../database/packages/apxgen_ai.sql) reserves before token counting and Messages, uses the reserved model/token limits, disables thinking, permits no automatic retry, checks model and uncached usage, reconciles before semantic proposal validation, and expects `end_turn` plus one text block. Its prompt and parent joins are dashboard-specific. |
| Application identities | [008_application_evolution.sql](../../database/migrations/008_application_evolution.sql) uses VARCHAR2(32) run, parent and child IDs. Existing run mode is GA_ONLY; methods are BASELINE/MUTATION. [apxgen_app_evolution.sql](../../database/packages/apxgen_app_evolution.sql) owns creation, phases, materialization counters, evaluation and selection. |
| Application grammar | [apxgen_app_genome.sql](../../database/packages/apxgen_app_genome.sql), `apply_proposal`, accepts strict unique-key JSON of at most 2,048 CLOB characters, containing 1–3 distinct `trait`/`value` operations. It is the application grammar authority. |
| Runtime capability | [build-definition.mjs](../../scripts/application/build-definition.mjs), `VERIFIED_APPLICATION_MAPPINGS`, enables classicReport/page and four binary arrangement traits. IR/modal prototypes have compiler evidence but are not enabled runtime mappings. |
| Native queue | [010_control_queue.sql](../../apex/living-control/sql/010_control_queue.sql) and [control-worker.mjs](../../runtime/application/control-worker.mjs) require GA_ONLY and zero paid requests. WP6 must not silently reinterpret that existing queue contract. |

The authoritative paid objects are currently owned by `APXGEN_LAB`; application
identities are owned by `APXGEN_ORDER_LAB`. This is a real cross-schema boundary,
not two interchangeable connection configurations.

In this design, **providerSingletonLock** means the existing physical
`APXGEN_LAB.APXGEN_PROVIDER_CONFIG` row with `singleton=1`, acquired FOR UPDATE.
There is no additional transport lock to invent. The application
`owned-worker.lock` coordinates local materialization; it cannot replace the
provider row or financial checks. The provider row is released before HTTP;
global committed RESERVED rows enforce admission across both subjects. This is
not a claim that a timed-out remote request can be forcibly cancelled.

## Chosen extension

Extend the existing invocation table with typed application references and add
one application-run opt-in configuration table in the same billing owner. Add a
narrow application broker and an application-only ledger guard. Keep the legacy
public API signatures, legacy reserve path, supervisor and recovery entrypoint.

A second application invocation table would split lifetime accounting and
concurrency. A shadow `APXGEN_RUNS` row would misrepresent ancestry and inherit
legacy lifecycle semantics. Both are excluded. Replacing the whole legacy AI
engine would increase the active-LAB deployment surface without solving a
necessary application requirement.

One metadata relaxation is unavoidable: the existing invocation `run_id` cannot
remain unconditionally NOT NULL while its legacy FK is retained and shadow runs
are forbidden. Make it nullable **only in combination with the new exact subject
shape constraint**. Do not rename, cast, repurpose or remove its existing FK.
This is an additive protocol extension with one explicitly reviewed nullability
change, not an assertion that every DDL operation is an ADD COLUMN.

## Physical columns and foreign keys

Names below are the proposed contract for a separately reviewed migration.

| Object | Proposed fields and constraints |
| --- | --- |
| Existing `APXGEN_INVOCATIONS` | Add `subject_kind VARCHAR2(12) DEFAULT 'DASHBOARD' NOT NULL`, limited to DASHBOARD/APPLICATION. Existing rows retain the DASHBOARD meaning and all original financial fields. |
| Application identity on that same row | Add nullable `app_run_id VARCHAR2(32)`, `app_parent_id VARCHAR2(32)`, `applied_app_organism_id VARCHAR2(32)` and `app_authorization_id VARCHAR2(32)`. App IDs use the existing lowercase 32-hex grammar. Numeric `organism_id`/`applied_organism` remain legacy-only. |
| Immutable application provenance | Add `app_parent_genome_hash`, `app_protocol_hash`, `app_source_hash`, `app_evaluator_hash`, `app_mapping_hash`, each VARCHAR2(64), plus `credential_static_id VARCHAR2(255)`. Store the reservation's credential reference, not the secret. Add nullable 64-hex `request_hash` and `response_hash`, populated once at the corresponding boundary. No full response log or credentials are required in the public evidence. |
| Application opt-in configuration | New `APXGEN_APP_AI_BUDGETS` in APXGEN_LAB: `app_run_id VARCHAR2(32)` PK; `authorization_id VARCHAR2(32)` UNIQUE NOT NULL; exact application owner/workspace identity; `authorized_by`, server `authorized_at`, explicit `expires_at`; `enabled DEFAULT 0`, `stopped DEFAULT 0`; positive `limit_usd`; integer `max_requests` in 1–100; bounded input/output token limits; exact authorized model ID; protocol/source/evaluator/mapping hashes. Identity, caps and authorization provenance are immutable. Stop is sticky; no automatic reset or grant inheritance. This table stores authorization settings, not a second usage ledger or balance. |
| Real run FK | `APXGEN_APP_AI_BUDGETS.app_run_id` references `APXGEN_ORDER_LAB.APXGEN_APP_RUNS.run_id`. Add UNIQUE `(app_run_id,authorization_id)` on the budget table; the invocation's matching two columns reference that pair. An invocation cannot borrow another run's grant. |
| Real parent/child FKs | Add the redundant but referenceable UNIQUE `(run_id,organism_id)` key to application organisms. Invocation `(app_run_id,app_parent_id)` and `(app_run_id,applied_app_organism_id)` reference that exact application key. NULL applied child means not consumed yet. No VARCHAR2-to-NUMBER conversion or ID-prefix convention is permitted. |
| Child provenance | A future application-mode migration adds nullable `ai_invocation_id VARCHAR2(32)` to application organisms, referencing the same billing-owner invocation PK. AI_PROPOSAL children require it; existing BASELINE/MUTATION rows keep NULL. A unique non-null invocation binding prevents two application children consuming one proposal. |

The exact invocation row-shape CHECK must explicitly use IS NULL/IS NOT NULL:

- DASHBOARD: legacy `run_id` is non-null, all application identity/provenance
  columns are null. Preserve the legacy parent columns' existing nullability;
  do not invalidate historical rows by adding a new parent requirement.
- APPLICATION: legacy `run_id`, numeric `organism_id` and numeric
  `applied_organism` are null; application run, parent, grant, parent genome hash,
  protocol/source/evaluator/mapping hashes and credential reference are non-null.
  Generation is an integer at least zero. Its meaning remains the **parent's**
  generation; the proposed child is generation plus one.

Use an application-only function-based unique index for `(app_run_id,generation)`:
both indexed expressions return NULL for DASHBOARD rows. Do not introduce a plain
composite unique key that could accidentally constrain historical legacy rows
with null application IDs. Enforce uniqueness of a non-null applied application
child as well. Actual Oracle fixtures must verify these null/index semantics.

App-only guards reject deletion or retargeting of invocation identity, parent
hash, authorization/model/rate/token snapshots and approved proposal. Set the
applied child once. Parent/child genome identity is checked against the actual
immutable application rows; a client-supplied hash alone is insufficient.
Legacy row behavior is outside this new trigger's mutation rules.

Cross-schema REFERENCES grants cover only the referenced keys. A narrow definer
application boundary exposes validated run/parent snapshots and pure proposal
application to the billing broker. A separate narrow definer billing boundary
exposes application reservation/transport/status/binding to the approved worker.
Do not grant the application schema general ledger/provider DML, the provider
credential, or unrestricted access to historical experiments. Operator enrollment
is a separate admin capability, not an implicitly callable worker operation.

The opt-in table's exact setting types are `schema_name VARCHAR2(128)`,
`workspace_id NUMBER(16)`, `authorized_by VARCHAR2(255)`, `authorized_at` and
`expires_at TIMESTAMP WITH TIME ZONE`, `enabled`/`stopped NUMBER(1)`,
`limit_usd NUMBER`, `max_requests NUMBER(3)`, `max_input_tokens NUMBER(5)`,
`max_output_tokens NUMBER(4)`, and `model_id VARCHAR2(128)`, all NOT NULL.
Use positive-integer workspace IDs, 0/1 flags, a positive limit at most 100,
1–100 integer requests, 1–8,192 integer input tokens and 1–1,024 integer output
tokens. `expires_at` must be later than `authorized_at` and at most one day
later. Protocol/source/evaluator/mapping fingerprints are NOT NULL VARCHAR2(64)
with lowercase 64-hex checks; run and authorization IDs have lowercase 32-hex
checks. The schema/workspace must match the separately approved deployment and
the actual cross-schema application boundary, never a name supplied by a prompt.
These are structural maxima, not approved spending or token allowances; reserve
still applies the stricter actual provider and per-run settings.

## Fresh opt-in and reservation

Historical GA_ONLY runs, the native GA_ONLY queue and existing public records
cannot be enrolled retrospectively. A future versioned application AI protocol
must explicitly allow a new GA_HAIKU run and AI_PROPOSAL method. Existing
`create_run`, native queue requests and disabled/zero-paid defaults retain their
current behavior. Adding the broker alone does not enable those mode extensions.

For each new AI run, the owner authorizes that exact run, model, monetary/token
caps and evaluator/protocol/mapping hashes after the run exists. Authorization
has an explicit expiry, no longer than 24 hours; it does not outlive the run.
Enabled global provider settings or the historical October authorization are not
application consent. An initial paid validation should permit at most one
proposal; any broader cohort needs its own reviewed per-run limits.

Proposed `APXGEN_APP_AI_BROKER.reserve_application` uses typed VARCHAR2 application
run/parent parameters. Its autonomous reservation transaction:

1. Locks the existing provider singleton, then the exact application opt-in row.
2. Verifies the fixed caller/owner/workspace and a direct worker context without
   an attached APEX browser session. Obtains actual application state through the
   narrow boundary. The run must be RUNNING in the new AI protocol; its parent
   must be its selected eligible incumbent, with completed independent evaluation.
3. Verifies fresh explicit opt-in, matching immutable hashes, supported mapping,
   no stopped flag and no prior invocation for that application parent generation.
   Requires the existing fresh verified-model/reviewed-price checks. No model,
   balance, pricing or account-access freshness is claimed by this design.
4. Counts RESERVED rows across **all** invocation subjects. It calculates request
   count and spent amount for `subject_kind=APPLICATION AND app_run_id=...`, but
   daily and lifetime sums use the complete physical table, with the existing
   `NVL(actual_usd,reserved_usd)` rule and UTC daily-window semantics.
5. Uses the stricter run/provider token and request limits. Reserves the maximum
   cost using the provider's actual configured rate snapshot, checks run/daily/
   lifetime caps, inserts one APPLICATION row and commits before external work.

No outer application transaction may hold run/parent/budget locks when invoking
an autonomous financial operation. The worker commits its prior phase first.
All new budget administration follows provider-first locking; it cannot lock an
opt-in row and then wait for the provider row in the opposite order.

There is no new allowance independent of the existing global cap. A rejected,
failed or uncertain proposal consumes its recorded cost/reservation and request
slot. Exhaustion stops this application grant; starting a fresh run cannot erase
the physical lifetime sum. No local JSON counter is financial authority.

## Proposal and child boundary

Do not call unchanged `APXGEN_AI.propose(run, NUMBER parent)` with an application
GUID, or reuse its dashboard prompt/parser. Keep its legacy callers intact.
The new application adapter uses the same fixed provider transport and existing
APEX Web Credential boundary, with exact reviewed billing-workspace context.
Cross-schema current-user/session-user and credential context are deployment
tests, not assumptions about which schema a definer call selects automatically.

The prompt contains only canonical parent traits, fixed task names and the
allowed compact response shape. It sends no fixture/customer data, SQL, APEXlang,
credentials, sessions, internal URLs or private logs. Allowed operations are:

```json
{"operations":[{"trait":"filters","value":"beside"}]}
```

Only `filters`, `summary`, `navigation` and `density` are enabled for this first
broker capability. Require 1–3 distinct operations whose values change the
parent; reject unknown fields, repeated traits, no-op output, explanations,
markup, URLs or executable text. The pure application grammar also recognizes
report/edit changes, so the broker must enforce the narrower runtime capability
**before and after** `APXGEN_APP_GENOME.apply_proposal`. The resulting genome must
still be classicReport/page. IR/modal prototype compilation does not enable them.

Transport uses the committed model/credential/token snapshot, disabled thinking,
the existing bounded count/messages timeouts and zero automatic paid retries.
Require the reserved model, valid integer usage, zero cached-token usage,
`end_turn` and exactly one text block. Bound the response envelope before JSON
parsing; its proposal text must satisfy the existing 2,048-character limit.
Record a request/response digest and raw approved compact operations in the same
invocation row. Reconcile known usage before semantic validation. Bad operations
after known usage remain a charged failed proposal, not a refunded/free retry;
unknown billing retains the reservation and stops the application grant.

After acceptance, a new application Oracle constructor replays those operations
against the recorded parent, checks the canonical result/hash and inserts one
GUID child with method AI_PROPOSAL. It never accepts a model's full genome or
predicted score. Bind the child's `ai_invocation_id` and the invocation's
`applied_app_organism_id` atomically in the **same non-autonomous transaction** as
the application child/event insertion. The child exists within that transaction
when the cross-schema FK is checked. An autonomous bind would not see the
uncommitted child and is forbidden. The narrow bind procedure must not commit.

A crash after a reconciled approved proposal may resume its exact recorded
application-child binding; it cannot request the provider again. A bound
invocation returns its existing child rather than creating another. Compiler,
guarded import/materialization budget, actual browser tasks and Oracle
`evaluate`/`decide` remain independent gates. Scores and old decisions are never
rewritten to make an AI proposal succeed.

## Subject-aware recovery without breaking legacy callers

Keep `APXGEN_BUDGET.reserve/reconcile/uncertain/stop_ai/recover_stale` signatures,
the legacy numeric-parent path, `APXGEN_EVOLUTION.tick` and the supervisor intact.
Legacy run-scoped queries naturally exclude APPLICATION rows because their
legacy `run_id` is null; global counts/sums deliberately include them.

The application broker has typed reconcile/uncertain/stop/recover operations.
It must not assume legacy `reconcile` or `uncertain` stops an application opt-in:
their current stop statements update only legacy run budgets.

Recommend an application-only invocation guard/helper in the billing owner that
also catches transitions made by the unchanged global `recover_stale`. In the
same transaction, it stops the exact application's opt-in when an APPLICATION
invocation becomes UNCERTAIN, acquires an error (including STALE_RESPONSE), or
records usage/cost above its reservation. It preserves the full reserved amount
when actual usage is unknown. It never stops a dashboard budget by matching an
application GUID string. Provider-first financial/admin locking makes its local
stop update compatible with legacy recovery's provider-first lock.

The trigger is not autonomous and does not query its own mutating invocation
table. It dispatches from OLD/NEW typed identity into the one local opt-in row.
The new broker performs subject-specific validation itself; the hook exists so
an existing scheduler's broad recovery cannot leave an application grant enabled.
Its legacy branch performs no new DML. Test both stale loops through the actual
unchanged legacy entrypoint, not merely a newly added app recovery procedure.

Stop prevents new reservations/messages that have not been sent. An already sent
request may complete and be billed; preserve its known result and usage without
another paid call. Unknown outcomes remain explicit and require owner review.
Computed usage cost is an estimate from reserved rates, not a verified invoice.

## Implementation and deployment gates

Implementation needs written design approval and a separate plan. This proposal
does not authorize paid execution, enable a native worker, refresh model/pricing
timestamps, change rates/caps, grant credentials, or install into the active LAB.

1. Build additive migrations/packages against disposable **TEST_ONLY** billing
   and application schemas. Their fixtures contain newly created synthetic
   legacy/application identities and zero real invocation history. No runtime
   ledger, balance or credential is copied into a sandbox or used as a second
   financial authority. Fake transport responses remain visibly TEST_ONLY.
2. Verify real cross-schema REFERENCES/EXECUTE grants, exact typed FKs, row shapes,
   case-based uniqueness, direct worker/browser-context rejection, immutable
   provenance and non-autonomous atomic child binding with actual Oracle tests.
3. Exercise legacy and application reservations concurrently against the same
   test provider row. Test shared RESERVED admission, lifetime/daily sums, all
   opt-in/expiry/stop/cap failures, usage overrun, invalid compact output and zero
   automatic retry. Prove an equal GUID in both namespaces cannot redirect cost
   or ancestry. Inspect both old stale-recovery loops with both subject types.
4. Run unchanged legacy reserve/propose/apply/evolution contracts with synthetic
   transport only, plus existing application grammar, compiler/import/task and
   native GA_ONLY/zero-paid tests. Historical rows and GA_ONLY behavior must be
   identical. No unit test result is paid-provider or runtime-fitness evidence.
5. Before any production DDL, independently review the exact migration and
   rollback/compatibility strategy. Plan an authorized maintenance window with
   the active LAB supervisor, scheduled AI ticks and application workers safely
   quiescent. Snapshot actual legacy objects/history/provider caps/reservations
   and application identities read-only. Inventory FK/index dependencies and
   compile checks. Stop on unexpected objects, active reservations, errors or
   stale context; never replace/drop/reinstall the active LAB to make it pass.
6. A separate deployment authorization is required for the single physical
   APXGEN_LAB ledger extension and narrow grants. Validate old APIs and recovery
   without resetting ledger totals or enabling spending. Application AI stays
   disabled after installation. A later explicitly approved new run, fresh
   model/pricing/access verification and per-run grant are prerequisites for
   one bounded real provider trial and its independent application evaluation.

The first real AI cohort needs a new immutable protocol/source/evaluator identity
and its own recorded limitations. Existing first-feasibility and native queue
protocols, public packages and their evidence remain historical observations.
