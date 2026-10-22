# Order Lab APEXlang definitions

The Order Lab builder emits a bounded native APEX application from trusted local
templates. Oracle owns genome generation, mutation and fitness. JavaScript checks
the genome boundary, writes the selected definition, and invokes the real SQLcl
compiler. Building source does not import an application or prove its runtime.

## Supported mappings and actual compiler evidence

The compiler-checked subset is `report=classicReport`, `edit=page`, with either
value of `filters` (above/beside), `summary` (before/after), `navigation` (side/top)
and `density` (comfortable/compact). All sixteen combinations passed offline
validation with installed SQLcl **26.3.0.260.1620** and the unchanged APEX metadata
version **26.2.0+3479**. The matrix is recorded in
[`apex/order-lab/evidence/mappings/index.json`](../../apex/order-lab/evidence/mappings/index.json).
Each result includes the exact definition and file hashes, compiler executable
and library hashes, version and output hash. The captured `compiler-output.txt` files contain
the real compiler response. These observations attest to source compilation.

`interactiveReport` and `modal` are valid genome alleles whose APEXlang mappings
are currently unsupported by this builder. It rejects them before creating files.
Unknown keys, executable text and changes to the fixed tasks or data source also
fail validation. No SQL or PL/SQL is supplied by the genome.

SQLcl 26.2.2.233.1901 starts but rejects this authentic 26.2 metadata version. Its
recorded diagnostic requests a compatible SQLcl version. It returned exit code
zero despite rejecting the input. The validator therefore requires the explicit
`Validation successful.` response and rejects errors, timeouts, changed source,
missing executables and incompatible versions. It always reports
`runtimeVerified: false` and uses `/nolog`.

## Build and validate

From the repository root, choose an unused local output directory:

```powershell
node scripts/application/build-definition.mjs apex/order-lab/baseline-genome.json .local/order-lab-candidate
node scripts/application/validate-definition.mjs .local/order-lab-candidate/application .local/order-lab-candidate/compiler C:/sqlcl/bin/sql.exe
```

Pass the installed compatible SQLcl executable explicitly. On this workstation,
sandboxed discovery hid `C:/sqlcl/bin/sql.exe`; the host installation is 26.3.
The `sql.exe` found first on PATH is a broken database-home launcher. Neither
the builder nor the validator downloads or installs software.

The build returns `appPath`, `manifestPath`, `definitionHash` and `genomeHash`.
An optional `parentDefinitionHash` passed through the JavaScript API records the
actual parent definition. `parent-source.json` hashes the selected original
files from tracked `apex/application`; the manifest retains that provenance.
Existing output directories are refused to avoid mixing candidate definitions.
Evidence must be outside the application source directory so recording results
cannot change the definition being attested. Revalidate every new definition
and compare its hash before any later import.

## Native pages and fixed fixture contract

The templates retain Universal Theme and Oracle APEX Accounts authentication.
They exclude inherited Genesis callbacks, laboratory JavaScript, supporting
object scripts, credentials and historical experiment data.

Page 1 contains a native classic report over `GENESIS_ORDERS_SAFE_V`, a native
Order ID search field, Status selection and **Apply filters** submit button.
The summary aggregates the same safe view. Report Order ID links use the trusted
`apex_page.get_url` query with `P2_ORDER_ID`; APEX supplies the checksummed target.
Page 2 displays Customer, offers Status and **Save status**, and calls only:

```sql
genesis_order_lab.update_status(
    p_order_id => to_number(:P2_ORDER_ID),
    p_status   => :P2_STATUS
);
```

The fixture must provide `ORDER_ID`, `CUSTOMER_NAME`, `STATUS`, `ORDER_TOTAL` and
scope reads and updates to an owned application slot and authorized synthetic
principal. Both selectors expose NEW, PROCESSING, DELAYED, SHIPPED and COMPLETED.
The definition contains no fixture reset endpoint. A separate guarded worker
owns slot acquisition and reset. Search and edit pages require authentication;
the package remains responsible for server-side authorization and input checks.

## Import gate

Import requires a separately verified sandbox configuration and a current owned
slot. Compiler evidence alone grants no import authority. Applications 120 and
121 are excluded from implicit allocation. Verify the exact workspace, schema,
database identity, unused or explicitly owned target ID and remaining budget
before importing. Only a connected, authorized worker should run commands such as:

```text
apex import -input <verified-definition-directory> -workspace <verified-workspace> -schema <verified-schema> -id <owned-slot-id> -alias <unique-slot-alias>
```

`scripts/application/import-definition.mjs` implements the create-only guard for
this initial protocol. Its API requires explicit `configPath`, `appPath`,
`compilerEvidencePath`, `applicationId`, `runId`, `organismId`, `leaseToken`,
`alias`, `expectedDatabase` (databaseName and containerName), and a fresh
`evidenceDir`. The CLI reads these fields from a private JSON request file.
There is no default destination or credential fallback.

The helper requires a RUNNING Oracle run whose materialization count has already
been atomically reserved, and an IMPORT_STARTED organism bound to the exact
definition hash and slot. It locks the dedicated slot table to serialize imports,
then holds the run, organism and exact ACTIVE slot lease while SQLcl imports.
It refuses every existing target, including an owned target. The initial pool
cap supplements the Oracle lifetime reservation; row counting is not presented
as a lifetime budget. The helper performs no registry inserts, updates, deletes,
fixture resets or cleanup. It checks source and compiler executable/library
hashes before and after import, and writes sanitized output and separate import
evidence. Failed or uncertain imports remain recorded for operator inspection.
Before SQLcl starts, a separate connection commits a unique per-organism import
attempt. The durable attempt becomes VERIFIED, FAILED or UNCERTAIN; an interrupted
STARTED attempt also blocks every retry for that organism. A failed process is
never an invitation to reimport into the same application.

After import, query APEX metadata for the exact target, verify authentication and
run all three fixed tasks against the database. Preserve import, runtime and task
evidence separately. `Import successful.` alone does not prove those gates.

## Real feasibility runner

The bounded runner requires an explicit pair of unused allowlisted IDs and a
distinct installed, durably owned, read-only canary application. It verifies the
canary's workspace, schema, ownership, terminal experiment and live fixture lease.
It creates one Oracle baseline and, only if Oracle selects that eligible parent,
one Oracle-mutated challenger. Each import consumes a reserved budget and a
unique durable attempt. Existing targets are refused.

The runner checks the exact deterministic 40-order fixture and reset hash,
authenticated native pages, all three tasks and independent row-version/audit
changes. Security checks include a sentinel present only in the other owned
partition; the current session must neither read nor update it. It restores the
current fixture before task trials and leaves the canary unchanged. Accessibility
and overflow checks cover report and edit pages at three widths. Keyboard focus
observation waits up to 500ms for the real style to settle and records that wait;
native theme focus transitions must not be mistaken for a permanent failure.

Private evidence includes actual Oracle events and decisions, compiler/import
bindings, evaluator/template/package hashes, independent task observations,
three warm-load timings and cropped browser screenshots. Screenshot clips cover
visible task content below the native header, excluding the account menu. No
login recordings, session values, credentials or artistic image edits are saved
with these figures. Failed trials and subsequent evaluator diagnoses remain
distinct; historical fitness is not rewritten.

Official references: [APEXlang command reference](https://docs.oracle.com/en/database/oracle/sql-developer-command-line/26.2/sqcug/apexlang.html),
[APEXlang 26.2 component reference](https://docs.oracle.com/en/database/oracle/apex/26.2/apxln/index.html),
[deployment files](https://docs.oracle.com/en/database/oracle/apex/26.2/apxdc/understanding-apexlang-deployment-files.html).
