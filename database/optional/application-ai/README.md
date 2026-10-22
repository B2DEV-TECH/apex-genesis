# Optional application AI subject prototype

**Not installed in production; paid execution disabled.** These files are source
for a separately reviewed TEST_ONLY experiment, outside the normal migrations
and installers. The two isolated TEST_ONLY owners and their baseline fixtures
were prepared locally, with zero provider calls and zero live-ledger writes.
The first read-only subject preflight refused generated LOB objects; its failure
is retained. The source now checks their exact dictionary relationships, but
subject-migration installation and its full Oracle contract remain unverified
at this paused checkpoint. Local JavaScript tests do not establish Oracle
compilation or transaction behavior. No application AI authorization is active.

The [broker design](../../../docs/architecture/application-ai-budget-broker.md)
describes a future deployment against the existing physical billing authority.
This increment proves only the proposed subject columns, opt-in metadata,
cross-schema identity links and stale-recovery stop hook. It adds no HTTP,
reservation broker, pricing validation, model verification or application worker
mode. Native application workers remain `GA_ONLY` with zero paid requests.

## Fixed isolation boundary

The SQL accepts only direct connections as these two owners:

| Owner | Purpose | Required marker |
| --- | --- | --- |
| `APXGEN_AI_BROKER_TEST` | Synthetic billing contract | `TEST_ONLY_APP_AI_BILLING_V1` |
| `APXGEN_APP_BROKER_TEST` | Synthetic application identities | `TEST_ONLY_APP_AI_APPLICATION_V1` |

The fixtures contain invented `TEST_ONLY` identities. They never copy historical
invocations, credentials, usage or balances. Their invocation table exists only
to exercise the unchanged legacy package in an isolated test. It is not a second
runtime financial authority. The global provider row stays disabled, with no
credential, verified model or reviewed price.

The billing invocation columns, JSON/state checks, legacy foreign keys and
nullable semantics match migrations 001 and 002 before the subject alteration,
including `created_at NOT NULL`. The provider fixture includes the total cap from
005. Synthetic legacy runs and organisms deliberately retain only the columns
read by `APXGEN_BUDGET`; their evolutionary engine, identity generation and
evaluation records are not reproduced. The application fixture likewise models
only the real GUID relationships and the state needed for these boundary tests.
It permits synthetic `GA_HAIKU`/`AI_PROPOSAL` values, without changing the runtime
application schema or worker allowlist.

## Proposed ledger behavior

`ledger-subjects.sql` extends the single fixture invocation table. The legacy
`run_id` foreign key remains, while conditional checks require exactly one shape:
legacy dashboard identifiers or real application GUID identifiers. Application
run, parent and child links use real cross-schema foreign keys. An authorization
row starts disabled and pins one application run, expiry, caps, model and source,
protocol, evaluator and mapping hashes. Identity and authorization provenance
cannot be changed or deleted; stopping an authorization is permanent.

`bind_child` acquires the existing physical provider singleton before the
invocation row. It is non-autonomous and does not commit. The application child
and reciprocal ledger link therefore commit or roll back together. Row triggers
use `NOWAIT` for the same provider row: conflicting direct DML refuses admission
instead of waiting in reverse lock order. No additional transport lock exists.

The application stop hook reads only `:OLD` and `:NEW`; it never queries its
mutating invocation table or starts an autonomous transaction. Thus the unchanged
legacy `recover_stale` can stop the corresponding application authorization when
it marks an application reservation uncertain or records a missing response.
The future contract checks this using committed synthetic rows visible to that
existing autonomous package. These behaviors still require actual Oracle proof.

## Future manual test route

Execution requires a separate review and explicit authorization. None of these
commands creates users or grants system privileges. A future operator must first
provide two empty, isolated TEST_ONLY owners with appropriate APEX visibility,
DDL privileges and the fixed mutual grants. Do not point this route at
`APXGEN_LAB`, `APXGEN_ORDER_LAB` or another runtime owner.

After authorization, the intended order is:

1. Run `test-only-billing-fixture.sql` as `APXGEN_AI_BROKER_TEST`. It includes the
   original `database/packages/apxgen_budget.sql` without changing its bytes.
2. Run `test-only-application-fixture.sql` as `APXGEN_APP_BROKER_TEST`. Its explicit
   cross-schema grants are limited to these synthetic fixture owners.
3. Run the read-only `--preflight` harness below. It rejects changed columns,
   unknown objects, disabled constraints, invalid packages, a mismatched original
   budget source, attached APEX contexts, live reservations/runs, an enabled
   provider/worker or queued/claimed requests. Both owners must match the
   explicitly configured database and container.
4. Run `ledger-subjects.sql` as the billing TEST_ONLY owner. Its own immediate
   preflight repeats column, object, marker and activity checks before DDL. Oracle
   DDL commits; a partial failure is preserved and needs manual review.
5. Run `test-only-child-link.sql` as the application TEST_ONLY owner to add the
   reciprocal child-to-invocation foreign key.
6. Review actual object errors and then invoke `--contract` once.

Use an ignored JSON configuration outside committed source:

```json
{
  "testOnly": true,
  "billing": {
    "user": "APXGEN_AI_BROKER_TEST",
    "password": "<private>",
    "connectString": "<explicit test service>"
  },
  "application": {
    "user": "APXGEN_APP_BROKER_TEST",
    "password": "<private>",
    "connectString": "<explicit test service>"
  },
  "expectedDatabase": {"databaseName": "TESTPDB", "containerName": "TESTPDB"},
  "allowCommittedSyntheticFixtures": true
}
```

The separate environment gate is mandatory:

```powershell
$env:APXGEN_APPLICATION_AI_TEST_CONFIG = '<absolute ignored test config>'
node tests/integration/application-ai-ledger.mjs --preflight
# Only after the separately authorized SQL steps and object review:
node tests/integration/application-ai-ledger.mjs --contract
```

Without the environment gate, either invocation returns SKIP before reading
credentials or opening a connection. `--preflight` is read-only.
`--contract` requires the separate committed-fixture permission, worker disabled,
no active requests/runs/reservations and a fresh invocation history. It checks
legacy compatibility, subject/null boundaries, immutable authorization, real
parent/child references, provider-lock contention, atomic child binding and both
stale recovery paths. It never calls a provider, APEX installation/removal API,
application fixture, runtime worker or business DML.

The contract deliberately commits synthetic rows so the unchanged autonomous
recovery sees them. It leaves that evidence in place, including on partial
failure; it must not be described as rollback-only or automatically retried.
There is no reset/drop/erase helper. Connection acquisition has driver and outer
deadlines. Both clients independently attempt bounded rollback and close on every
exit, including acquisition or test failure.

## Remaining deployment gate

Production adoption needs a distinct migration and maintenance review. It must
identify the existing billing/application owners, prove source and schema
versions, stop workers and reservations, preserve legacy records, authorize real
cross-schema references and definer APIs, and verify all concurrency, recovery,
global lifetime/day/run sums and independent application evaluation boundaries.
Historical dashboard consent cannot enroll an application run. This prototype
does not authorize any paid request or establish current pricing/model freshness.
