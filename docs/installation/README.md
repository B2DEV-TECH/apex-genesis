# Install and reproduce APEX Genesis

Tested: Oracle AI Database 26ai Free 23.26.3.0.0, APEX 26.2.0, SQL*Plus 23.26.3,
SQLcl 26.3.0.260.1620, Node 22.16 and Playwright Chromium 141.0.7390.37 on Windows.
Other database/APEX releases are unverified. Generated APEXlang targets 26.2.0+3479.
Use a dedicated schema and workspace with synthetic data. Do not install into a
customer application or assume another local schema is disposable.

## Prerequisites

- Existing Oracle Database/APEX installation with a working APEX web endpoint.
- A dedicated owner with CREATE SESSION, CREATE TABLE, CREATE SEQUENCE,
  CREATE PROCEDURE and CREATE TRIGGER. CREATE JOB is needed for background scheduling.
- Direct EXECUTE on SYS.DBMS_CRYPTO for the owner. A DBA grants these explicitly;
  the portable installer does not issue privileged grants.
- Map only the intended owner into a dedicated APEX workspace.
- Node 22+ and development dependencies for browser measurement and publication.
  Recorded public playback itself needs only a static web server.

No network ACL, Anthropic credential or paid service is required for offline runs.
The engine uses APEX public APIs for authentication/context and therefore assumes
APEX is installed even when AI is disabled.

## Install database objects

Connect directly as the dedicated owner. **Change directory to `installer` before
running `@install.sql` in SQL*Plus.** The tested SQL*Plus client resolves nested
relative includes from the working directory. Do not infer success from process
exit alone: the installer checks required objects and compiler errors.

```sql
@install.sql
select object_name, object_type, status
  from user_objects
 where object_name like 'APXGEN%'
 order by object_type, object_name;
select name, line, text from user_errors where name like 'APXGEN%';
```

The schema starts with no principals, no enabled provider and no opted-in run.
An independent clean installation in a second dedicated owner produced zero
invalid objects and passed the core database suite. DDL commits are not atomic;
read [maintenance](maintenance.md) if an installation stops partway through.

## Import the native APEX application

Use compatible SQLcl in thin mode. The tested older SQLcl 26.2.2 could not compile
the installed APEXlang 26.2 grammar; SQLcl 26.3 worked. On this Windows machine,
thin mode also avoids a mismatched JDBC/OCI library from the Oracle home.

```text
sql -thin /nolog
connect YOUR_OWNER/"YOUR_PASSWORD"@YOUR_SERVICE
apex import -input apex/application -workspace YOUR_WORKSPACE -schema YOUR_OWNER
```

Do not put real passwords in checked-in scripts or shell arguments. The local
helpers read ignored configuration and send connection text through standard input.
The app source has an empty portable deployment context. Override the destination
workspace/schema, and choose an unused destination app ID when required. Reimporting
an existing ID replaces that application's definition; use only your Genesis app.

The actual SQL export is supplied under `apex/export`. Its source ID identifies the
artifact, not a requirement for the destination. APEX Accounts authentication and
an owner-maintained Genesis principal are both required. Use the database owner
to bind the intended APEX account:

```sql
insert into apxgen_principals(username, principal_role)
values (upper(:genesis_apex_username), 'OWNER');
commit;
```

OWNER, OPERATOR and READER are application roles. A page being hidden does not
grant authority: mutation callbacks require OPERATOR, reads require READER. Direct
schema owners/DBAs can change the code and data and are outside this application
boundary. Public visitors use the exported exhibition, not the admin application.

## Browser worker configuration

Create `.local/oracle.json` locally; it is ignored by Git:

```json
{
  "user": "YOUR_OWNER",
  "password": "YOUR_LOCAL_SECRET",
  "connectString": "YOUR_HOST:YOUR_PORT/YOUR_SERVICE"
}
```

`APXGEN_CONFIG` can select a different local JSON file. Do not publish that file.
Native browser tests additionally need local `workspace`, `apexUser` and
`apexPassword` entries. Those are development test settings, not installer defaults.
`bootstrap-local.ps1` is a narrowly scoped original-lab helper; it is not the portable
community installer and refuses to replace its existing credential configuration.

```powershell
npm ci
npx playwright install chromium
node scripts/build-renderer.mjs
node scripts/run-experiment.mjs --mode=GA_ONLY --seed=42 --size=12 --generations=5
```

Oracle owns the run and operators. The Node process renders queued genomes,
measures three viewports, submits token-bound observations and calls generation
advancement. It can run with no open browser tab. `--run=RUN_ID` resumes evaluation
for a RUNNING experiment created in APEX. Resume a PAUSED run through the APEX
control before starting its worker. STOPPED/FAILED histories remain recorded.

The APEX Create action schedules a ten-second database job. That job still needs
the browser worker to supply observations. A due/in-flight AI boundary prevents it
from advancing past a provider result. Completed/stopped/failed jobs disable their
future schedule. `--generation-delay-ms` is a documented demonstration throttle,
not a performance setting; defaults to zero and is capped at five seconds.

## Reproduce the paired offline protocol

Inspect `experiments/configurations/offline-paired.json` before running:

```powershell
node scripts/run-suite.mjs
node scripts/export.mjs
node scripts/verify-export.mjs
node scripts/analyze.mjs
```

The suite uses five paired seeds and 100 generations per condition, including
generation zero as an additional recorded boundary. It captures source hashes and
the checkout commit before execution. Export refuses to replace missing provenance
with the current implementation. Keep the referenced source commit and any
uncommitted-source disclosure with a new experiment.

Original published offline runs used engine 1.0.0 at `be49b9d`; engine 1.0.1 added
safety fixes and engine 1.1.0 adds immutable configuration and bounded controls.
New evaluator fingerprints include the executed preview bundle.
Do not mix evaluation contexts or claim bit-identical results across changed engines,
database versions, browsers or fonts. Exact stored historical replay requires no
fresh model call.

## Explore recorded results immediately

```powershell
node scripts/verify-export.mjs
npm run serve
```

Open `http://127.0.0.1:4173`. This serves the actual committed Oracle dataset and
does not connect to Oracle or Anthropic. Detailed generations load lazily and are
verified against the manifest. Serve over HTTPS outside localhost so Web Crypto
is available. The public website mirrors these assets inside the article.

## Optional Haiku

Read [AI setup and spending](haiku.md). Paid requests stay disabled until the owner
configures credentials, verifies the available model and prices, and explicitly
opts a particular run into a capped budget. Routine tests never call the provider.

## Verification

```powershell
npm test
node tests/integration/database.mjs
node tests/integration/evolution.mjs
node tests/integration/fitness.mjs
node tests/integration/controls.mjs
node tests/integration/budget.mjs
node tests/integration/ai-boundary.mjs
node tests/integration/ai-fallback.mjs
node tests/browser/renderer.mjs
node tests/browser/showcase.mjs
```

Database integration tests create clearly labeled synthetic test runs. Keep them
in a disposable verification schema when possible. Native browser tests are scoped
to the original local lab helper settings; adapt that documented harness for your
destination rather than treating its original application ID as portable config.

The native Configuration page exposes rates, elites, selection pressure, diversity,
stagnation, timeouts and four fitness weights. Weights must sum to one. Oracle validates
all fields and freezes them after initialization; changing rules requires a new run.
Bounded controls include the current unfinished generation and pause on completion.
Resume clears that boundary. Checkpoint duplication preserves configuration and
creates a new history. Preferences are separately stored and do not change fitness.

`node scripts/benchmark.mjs` measures a separate current-engine pair with cache reuse
disabled. It records Node CPU/RSS, renderer-page metrics and owner segment allocation;
those values do not measure the whole Oracle/Chromium process or reproduce pilot
runtimes. Run it from committed source and retain the resulting provenance.
