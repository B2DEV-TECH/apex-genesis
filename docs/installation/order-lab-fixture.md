# Isolated Order Lab fixture

The additive fixture is fixed synthetic data for bounded disposable application
evaluations. It has no connection to customer/employer data, existing Genesis
experiments, providers or spending ledgers. Baseline version is `order-lab/1.0`.

On 2026-10-22, migration 007 and the three new packages compiled in the explicitly
authorized `APXGEN_ORDER_LAB` schema/workspace with zero `USER_ERRORS`. The slot
registry and orders table were verified empty. No application was imported during
this installation. Pure genome/fitness integration passed 69 check groups; this
does not establish real browser task success.

## Installation boundary

`database/migrations/007_order_lab_fixture.sql` is deliberately absent from the
default installer and upgrade paths. It refuses existing Genesis LAB/VERIFY and
administrative owners. Before its first DDL it rejects any existing object or
named constraint in its namespace. It never overwrites, drops or automatically
adopts existing objects. A migration failure may leave already committed Oracle
DDL; preserve and inspect those objects rather than rerunning or dropping them.

The local `scripts/application/install-sandbox.ps1` is pinned to the separately
authorized local owner, exact workspace ID and application pool. It reads only
ignored `.local/order-lab` configuration, runs the read-only worker preflight,
and independently checks `USER`, session owner, current schema and workspace
mapping before DDL. Credentials are piped to SQLcl with echo/history disabled
and redacted from the ignored installation log. It does not import applications
or register slots. `-CompileInstalledFixture` is an explicit continuation mode
for the recorded initial installation; it verifies the same empty fixture objects
and compiles packages without rerunning the migration or resetting data.
`-InstallApplicationEvolution` applies only additive migration 008 and the evolution
package after checking the same configured identity. `-InstallImportAttempts`
applies only migration 009 and its import-audit trigger. Neither mode reruns the
fixture migration, registers a slot or changes existing fixture rows. The local
policy's validated integer workspace ID is the authority; the installer confirms
that exact mapping in Oracle before every DDL mode. Sanitized logs retain each
installation attempt separately.

The owner needs the usual table/view/procedure privileges and an explicit execute
grant on `SYS.DBMS_CRYPTO` for fingerprints. Do not install the historical
dashboard engine or create a parallel provider ledger just to satisfy dependencies:
the application genome has its own pure Oracle RNG helper with the same tested
Park-Miller sequence.

## Explicit ownership and registration

`GENESIS_ORDER_LAB_SLOTS` starts empty. Each row must be supplied by a trusted
operator or future durable slot allocator after checking the configured schema,
workspace, unused application allowlist and remaining run materialization budget.
An ID/alias/name pattern, existing privileges or an empty application definition
does not prove ownership. Existing applications 120 and 121 are structurally
excluded by the registry constraint and runtime APIs.

Every slot requires an integer `APPLICATION_ID`, exact `WORKSPACE_ID`, uppercase
approved synthetic `APPROVED_USERNAME`, real provenance `OWNER_RUN_ID` and
`OWNER_ORGANISM_ID`, a fresh 32-character lowercase hexadecimal `LEASE_TOKEN`,
future `LEASE_UNTIL`, and `SLOT_STATE='ACTIVE'`. Ownership IDs are explicit
32-character lowercase hexadecimal identifiers. `FIXTURE_VERSION` is constrained
to `order-lab/1.0`; `RELEASED` slots cannot be read or changed through the API.
No lease or owner is inferred or automatically renewed.

Trusted registration uses a fixed parameterized insert after those checks:

```sql
insert into genesis_order_lab_slots(
  application_id,workspace_id,approved_username,owner_run_id,
  owner_organism_id,lease_token,lease_until,slot_state
) values(
  :application_id,:workspace_id,:approved_username,:owner_run_id,
  :owner_organism_id,:lease_token,:lease_until,'ACTIVE'
);
```

Do not substitute invented provenance IDs merely to make a test pass. Registration
must precede fixture reset/import and be retained with the organism's audit record.
This small registry is a fixture access boundary, not a replacement for the full
durable evolution/slot allocator and its spending or materialization budgets.

## Fixed data and safe reads

`GENESIS_ORDERS` is logically partitioned by the composite primary key
`(APPLICATION_ID,ORDER_ID)`. All 40 orders are scoped to one explicitly registered
application; no physical partition DDL is generated from input. Order IDs repeat
across slots, making application ID mandatory in every mutation and worker query.

For `i` from 1 to 40, the baseline has ID `1000+i`, customer name
`Synthetic Customer ` plus a two-digit `i`, total `100+i*17.25`, and row version
zero. Status follows `mod(i,5)`: 0 `NEW`, 1 `PROCESSING`, 2 `DELAYED`,
3 `SHIPPED`, 4 `COMPLETED`. Order 1002 starts `DELAYED`; filtering that status
returns exactly 1002, 1007, 1012, 1017, 1022, 1027, 1032 and 1037. The initial
total of all orders is 18,145.00.

`GENESIS_ORDERS_SAFE_V` exposes only `ORDER_ID`, `CUSTOMER_NAME`, `STATUS` and
`ORDER_TOTAL`. Its mandatory `APPLICATION_ID=to_number(v('APP_ID'))` predicate is
combined with the active registered principal, current APEX workspace and an
unexpired slot lease. A direct worker session has no `APP_ID` and sees no rows.
Applications use only this fixed view and trusted package calls; genomes/model
proposals never supply SQL, credentials or alternate data sources.

## Parameterized status update

The trusted application process calls:

```sql
begin
  genesis_order_lab.update_status(:order_id,:status);
end;
```

The API derives app ID and user from the current APEX session and verifies the
matching APEX globals, live session identifier and authenticated state. It locks
the registered active slot, checks the approved principal/current workspace and
independently verifies the installed application's actual owner/workspace mapping.
It then locks only the current application's target order and performs a fixed
update with bound parameters. ID must be an integer in 1001..1040; status must be
exactly `NEW`, `PROCESSING`, `DELAYED`, `SHIPPED` or `COMPLETED`.

Each successful call increments `ROW_VERSION` once and records the session actor
and update time. The caller owns the transaction. There is no commit, autonomous
transaction, dynamic SQL, caller-supplied app ID or alternate field name. Slot-first
locking serializes reset and update operations; a busy slot/row rejects through
Oracle's `NOWAIT` lock error rather than silently racing. Invalid runtime requests
use ORA-20131; invalid/expired slot leases use ORA-20130.

APEX authenticates a real browser request before running this process. The fixed
template must retain authorization, session-state protection and checksum controls.
Server-side fixture checks do not replace authentication/browser acceptance tests.

## Trusted reset and fingerprint

Only a direct session logged in as the parsing schema owner, with matching current
schema and no attached APEX app/user/session context, may invoke:

```sql
begin
  genesis_order_lab.reset_fixture(:application_id,:lease_token);
end;
```

The API requires the exact registered active lease token and owner/workspace
mapping, locks that slot, deletes only that application's fixture rows, and inserts
the 40 deterministic baseline records. The caller commits or rolls back. A reset
cannot be exposed through an APEX callback, including one granted to the approved
synthetic principal. A lease that expires after import makes reads/updates
unavailable; keep evaluations bounded and archive their evidence before expiry.

`fixture_hash(:application_id,:lease_token)` has the same trusted-worker and lease
requirements. It hashes fixed-order JSON containing fixture version and ordered
order ID, customer, status, total and row version. Application ID, actor and timestamps
are excluded so independently reset slots produce the same baseline hash. Missing,
extra or altered data changes the hash. Independent row/count/value assertions are
still required; hash equality alone does not establish a successful task.
Invoke this locking helper through a PL/SQL bind-out block, not a SQL SELECT
expression: Oracle rejects its slot-lock operation inside a query with ORA-14551.

The schema owner is trusted and can bypass these package controls with SQL. The
application and worker must never grant arbitrary SQL access or expose credentials,
reset/hash helpers, registry mutation or fixture tokens to a browser/public export.

## One durable import attempt per organism

Migration 009 adds `APXGEN_APP_IMPORT_ATTEMPTS` without foreign keys to run,
organism or slot tables. The guarded importer holds those parent locks while a
separate trusted connection commits a `STARTED` audit row before spawning SQLcl.
Its unique organism ID allows only one import attempt for the organism, including
after a crash, timeout or failed import. A remaining `STARTED` row is consumed
capacity and must never be deleted/reset to permit a retry.

The audit row records only attempt/organism/run IDs, target application ID,
definition hash, state, creation/completion timestamps and a bounded error code.
It contains no credentials, lease tokens, endpoint URLs or raw exception text.
Identity and creation time are immutable. A `STARTED` attempt may be finalized
once as `VERIFIED`, `FAILED` or `UNCERTAIN`; all final states and deletion are
blocked. A verified final state requires no error code, while failed/uncertain
states require an uppercase code such as `IMPORT_FAILED` or `SQLCL_TIMED_OUT`.

The separate connection is necessary: a foreign key or audit update through the
guard's locked parent transaction could deadlock or lose the attempt on rollback.
The importer must confirm that STARTED was committed before spawning SQLcl and
retain an incomplete outcome if finalization fails. An audit state establishes
attempt accounting, not browser functionality or task success.

`tests/integration/application-import-attempts.mjs` passed 13 Oracle checks in the
authorized dedicated owner on 2026-10-22. It held run/organism row locks and the
exclusive slot-table lock on one connection while inserting audit evidence on a
second connection, proving the lack of a parent-lock dependency. It also verified
unique organism attempts, identity/final-state immutability and rollback cleanup.
All records were explicitly TEST-only and rolled back; no application was imported.

## Private archive preparation

`scripts/application/archive-application.mjs` implements archive-only preparation.
It requires the exact policy/schema/workspace/application, durable run/organism
ownership and original definition hash. Both run and candidate must be terminal;
the lease must be inactive, no evaluations may be pending, and the matching import
attempt must have an unambiguous finalized state. Naming conventions do not confer
ownership. The helper fails promptly if another worker holds its required locks.

The source preserves the original APEXlang definition and manifest, exports the
actual installed app through SQLcl and `APEX_EXPORT.GET_APPLICATION`, and verifies
copied/exported hashes before writing the final manifest into a new private
directory. It has no removal path and rejects disposal modes. Actual export was
exercised for the explicitly authorized first failed application 130 on 2026-10-22:
its 33,006-byte SQL export and original definition passed independent hash checks.
Keep private SQL exports separate from sanitized public exhibition artifacts.

The separate `dispose-application.mjs` helper uses the workspace-scoped
[APEX_APPLICATION_INSTALL.REMOVE_APPLICATION API](https://docs.oracle.com/en/database/oracle/apex/26.1/aeapi/APEX_APPLICATION_INSTALL.REMOVE_APPLICATION-Procedure.html)
only after independently checking a complete owned archive and current inactivity.
It requires an additional explicit authorization bound to application 130 and its
old run, organism, workspace and definition hash. Applications 120, 121, 131, 132
and 133 cannot be removed by that helper. Authority follows the full recorded
ownership, never the reused numeric slot or an alias.

Preparation saves the complete fixture, registry, CLOB genome, run, events, import
audit and canary snapshots into an exclusive new private directory before releasing
the exact old lease. Timestamp evidence includes full fractional precision. The
preserved registry includes its lease token privately and must never be published.
Archive verification rehashes all files, actual SQL export and original/copied DNA.

Cleanup appends permanent `ARCHIVED` and `CLEANUP_STARTED` events before invoking
the public workspace API, which may commit internally. It retains the old released
registry until application absence is confirmed. It then deletes only the exact old
fixture and registry row and appends `DISPOSED`. An incomplete attempt records
`CLEANUP_UNCERTAIN`; automatic retries are prohibited. Terminal organism records,
lineage, scores, import attempts and prior events remain immutable. No filesystem
evidence is deleted or overwritten.

The explicitly approved first cleanup of failed pre-runtime application 130
completed on 2026-10-22. Independent queries confirmed the application, 40 old
fixture rows and single old registry row absent. Applications 131 and 132 and their
full fixture/audit snapshots were unchanged. The original failed run/organism and
verified import attempt remained present. The now-free numeric slot requires fresh
ownership, lease and materialization budget before a later organism can use it.

## Integration check and remaining acceptance

`tests/integration/order-lab-fixture.mjs` opens no connection unless
`APXGEN_APPLICATION_TEST_CONFIG` explicitly identifies the authorized owner,
workspace name/ID, an application pool excluding 120/121 and
`sandbox.fixtureWritesAuthorized=true`. Its additional private `fixture` object
requires `applicationId`, `leaseToken`, `otherApplicationId`, `otherLeaseToken`,
and the registered `approvedUsername`. Both exact active owned leases must already
exist; the test does not invent provenance, register leases or import apps.

The test resets two explicitly authorized partitions, asserts all 40 exact rows,
checks baseline hash agreement, token/protected-ID rejection, no-session read/update
rejection, per-application hash isolation and deterministic reset. It rolls back
all test changes and performs no APEX session creation. Its output explicitly says
`runtimeUpdateVerified:false` and `browserTasksVerified:false`.

This standalone fixture integration script has not been run separately. The real
feasibility runner has since imported two applications, authenticated through their
actual APEX login, completed all three browser tasks and independently verified
the intended database update, row version, principal and unchanged other records.
Its denial probes also checked direct-owner execution, an unapproved APEX
principal and another owned partition. These are distinct recorded checks; they
do not establish every concurrent-session or CSRF scenario.
See the [actual verification record](../testing/living-applications-progress.md).
The supported session APIs for server-side diagnostic checks are described in
[Oracle's APEX_SESSION reference](https://docs.oracle.com/en/database/oracle/apex/26.1/aeapi/APEX_SESSION.html);
such diagnostics must not be relabeled as browser authentication or task evidence.

## Bounded terminal-run recycling

`scripts/application/recycle-application.mjs` extends preservation to an explicitly
approved terminal non-incumbent in the four-slot development pool. It requires
separate migration 011, the exact schema/workspace/database and immutable
run/organism/genome/definition identity. The earlier one-target cleanup helper
and its historical authorization remain unchanged.

Preparation preserves every original candidate file and full fixture, registry,
history, import and canary snapshots before releasing the exact old lease. The
disposal phase performs a genuine SQL export and verifies all preservation bytes
again. Its unique permanent cleanup attempt commits before the workspace removal
API; a crash or uncertain outcome blocks automatic retries. The current executor
refuses every RUNNING owner run and pins the incumbent even in a completed run.
Active-run slot reuse for longer experiments remains a separate acceptance gate.

The native worker and recycler share a cooperative lock derived from the canonical
sandbox worker configuration location: `owned-worker.lock` in the same directory
as `worker.json`. Keep one canonical private worker configuration. Contention
refuses admission; no process reclaims a stale-looking marker automatically.
Uncertain work or resource closure retains it for operator investigation. This
local coordinator complements Oracle's import/ownership guards and is not a
distributed lock across development machines.
