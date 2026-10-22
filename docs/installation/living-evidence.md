# Living Applications evidence packaging

## Publish through the existing R2 transport

`scripts/application/publish-evidence.mjs` reuses `runtime/publisher.mjs` and the
existing B2DEV media bucket. Its independent `genesis/living/v1/` namespace leaves
the continuous archive's `genesis/live/v1/latest.json` untouched.

The publisher validates a completed public package with the exhibition loader,
rejects orphan files and private-capable image metadata, and uploads only those
verified bytes. Objects live under `packages/<manifest-sha256>/`. Existing objects
must match; they are never overwritten with different bytes. Every upload is read
back from the public endpoint and hashed. The package manifest is uploaded after
its files, and the application `latest.json` pointer moves last. A failed pointer
verification restores the previous pointer only while the current value remains
the publisher's own value. Receipts stay in a fresh private working directory.

Use the existing publication configuration with an explicit absolute
`publication.applicationLockPath` shared by every application publisher. It also
contains `target`, `bucket`, `publicBase`, `wrangler` and `wranglerCwd`, using the
same fields as the current transport. A `DIRECTORY` target exercises the complete
flow locally without uploading anything.

```powershell
node scripts/application/publish-evidence.mjs <verified-package> <local-publication-config.json> <new-private-work-directory>
```

This is a single-publisher workflow. The current Wrangler object transport does
not offer atomic conditional pointer writes. A shared local lease and conflict
checks protect this workstation; distributed writers are unsupported. A failed
first pointer has no previous value to restore. The website therefore pins an
immutable manifest hash rather than automatically following the mutable pointer.
No retry, background publication or old supervisor change is enabled by this
command.

The public exhibition reads an independent, versioned application dataset. It does
not read Oracle, launch applications, start experiments or reuse the historical
dashboard scores. No application dataset or illustrative result is bundled with
the page. Without a dataset it shows the explicit empty state.

## Package genuine recorded evidence

After the authorized private materialization loop has completed, prepare a private
staging directory containing only the intended public source files, sanitized
stage summaries and recorded screenshots. Keep credentials, browser storage,
authentication recordings, private runtime URLs and detailed private logs elsewhere.
The packager copies only explicit references; it never copies the staging directory
recursively.

Call the helper from a private driver:

```js
import {buildPublicEvidence} from './scripts/application/package-evidence.mjs';

const result = await buildPublicEvidence({
  candidates, sourceHash, evaluatorHash, inputRoot, outputDir
});
```

`candidates` is an array of sanitized candidate objects in the contract below.
`sourceHash` and `evaluatorHash` are lowercase SHA-256 values for the actual source
and evaluator definitions used. Every candidate and its stage records must agree
with them. `inputRoot` contains the explicitly referenced files. `outputDir` must
be a **new directory**. Existing directories are never merged or overwritten.

The CLI takes the staging root, a private request JSON file, and the new output:

```powershell
node scripts/application/package-evidence.mjs <inputRoot> <sanitized-request.json> <newOutputDir>
```

The request contains exactly `candidates`, `sourceHash` and `evaluatorHash`. The
helper returns `verified`, `manifest`, `manifestPath`, `manifestSha256`,
`verifiedCandidates`, `files`, `bytes` and the local `outputDir`. Local paths in
this operator result are not included in the public manifest.

Before writing, the helper hashes all referenced bytes and runs the same loader
used by the exhibition. It then exclusively creates the output directory, writes
the evidence files, verifies their actual disk bytes through that loader and
writes `manifest.json` last. An interrupted write may leave an incomplete private
directory for inspection. Do not reuse it or publish it; choose a new output path
after resolving the failure. This command performs no R2 upload, website mutation,
Oracle import or deployment.

## Exact public contract

Unknown fields, duplicate JSON properties and excessive JSON nesting are rejected.
All file references are safe paths relative to the
dataset root, without URLs, traversal, query strings, backslashes or hidden
directories. Symlinks are refused by the packager. `manifest.json` and the
`candidates/` namespace are reserved for generated publication files.

The manifest contains these exact fields:

| Field | Required value or type |
| --- | --- |
| `schemaVersion` | `"1.0"` |
| `experimentType` | `"APEX_APPLICATION"` |
| `genomeSchemaVersion` | `"2.0"` |
| `fitnessDefinition` | `"order-lab-task-proxy/2.0.0"` |
| `sourceHash`, `evaluatorHash` | Lowercase SHA-256 strings |
| `files` | Array of `{path, sha256, bytes}` for every referenced file |
| `candidates` | Array of manifested candidate JSON paths |

The loader also recognizes the optional boolean `testOnly`. Its default public
mode refuses `testOnly: true`; the packager never enables the test fixture path.
Candidate/run IDs and reference paths explicitly marked `TEST` are not publishable.
Synthetic unit fixtures remain in tests and private temporary memory/directories;
they are not experimental results.

Each candidate JSON contains exactly:

| Field | Meaning |
| --- | --- |
| `id`, `runId` | Bounded identifiers: letters, digits, underscore or hyphen |
| `generation` | Nonnegative recorded generation number |
| `parentId` | Null for generation zero, otherwise a verified selected parent ID |
| `genomePath`, `genomeHash` | Manifested canonical application genome JSON and its exact byte SHA-256 |
| `artifactPath`, `artifactHash` | Manifested sanitized `.apx` file or bundle index and its exact byte SHA-256; both null if no definition was generated |
| `applicationId` | Actual allocated APEX application ID, or null before an import is attempted; allocation alone does not establish import |
| `sourceHash`, `evaluatorHash` | The manifest’s source/evaluator hashes |
| `validation`, `import`, `runtime` | Null if not attempted; otherwise `{success, evidence}` |
| `tasks` | Exactly `locateOrder`, `filterOrders`, `updateOrder`, each null or `{success, evidence}` |
| `selected` | Explicit boolean from the recorded Oracle selection |
| `fitness` | Null without Oracle fitness evidence; otherwise the recorded score |
| `fitnessEvidence` | Null or a manifested Oracle fitness JSON path |
| `screenshots` | Array of `{path, viewport: {width, height}, alt}` |

The optional `rejectionReason` is null or a sanitized string of at most 240
characters, permitted only when `selected` is false. Eligible challengers that lose
selection retain their actual task evidence and Oracle score. A genome rejected
before definition generation has null artifact/application identity, no attempted
stages, no fitness and no screenshots; no placeholder artifact or ID is invented.

Canonical genome bytes must equal `canonicalApplicationGenome(genome)` exactly,
without a trailing newline. The public loader cross-checks the same bounded grammar
as the private genome boundary. Application source is never executed by the viewer.

For a multi-file APEXlang definition, the artifact index is JSON with exactly
`{files: [<root-relative .apx and .css paths>]}`. Include the actual density
stylesheet referenced by the application. Every component is separately manifested
and verified. The public `artifactHash` hashes this sanitized index’s exact bytes;
it may differ from the private builder’s `definitionHash`. Stage binding fields
must use the public artifact hash consistently.

Every stage’s `evidence` points to a JSON document with exactly:

- `candidateId`, `runId`, `applicationId`, `genomeHash`, `artifactHash`,
  `sourceHash`, `evaluatorHash`, all bound to that candidate;
- `stage`: `validation`, `import`, `runtime`, `task:locateOrder`,
  `task:filterOrders`, `task:updateOrder`, or `fitness`;
- `success`: explicit `true`, `false`, or `null` for an ambiguous observation;
- `completedAt`: the actual ISO completion time.

Task stage documents may additionally carry actual measured `actions` and
`navigationSteps` together, plus optional `elapsedMs`. These are bounded,
nonnegative integer observations. Navigation cannot exceed actions, and a
successful task cannot claim zero actions. No counters or timings are filled in
when they were not recorded. These optional values appear in secondary inspection;
they never create a JavaScript fitness score.

Fitness evidence additionally requires `authority: "ORACLE"`,
`definition: "order-lab-task-proxy/2.0.0"`, `eligible` and `score`. Its `success`
must be true, its score must equal `candidate.fitness`, and an ineligible score
must be zero. It must follow the task observations. Eligibility requires all three
successful tasks after successful validation/import/runtime. Successful tasks
alone do not establish eligibility: Oracle may reject another hard gate and record
an ineligible zero score. The outcome ledger preserves that distinction.
The viewer does not calculate or invent an Oracle score.

Stage completion times follow validation, import, runtime and the fixed task order.
A later stage cannot pass a missing, failed or ambiguous prerequisite. Failure and
ambiguity remain distinct outcomes. A selected candidate additionally needs a
verified Oracle score and at least one recorded screenshot. Parent lineage stays
within one run and points strictly to an earlier generation; rejected intermediate
generations do not require fabricated copies of a surviving organism.

Screenshots are PNG, JPEG or WebP. Their original bytes are retained, manifested
and verified before display, including actual screenshots of runtime-verified
challengers that fail tasks or lose selection. The packager refuses text/EXIF/XMP metadata and
trailing data that could carry private context. It does not inspect or redact the
visible pixels: supply actual captures reviewed for public display, excluding
authentication recordings and private runtime details. Screenshot presence never
substitutes for the required task and materialization evidence.

## Preview without publishing

Keep the package private until evidence and publication are reviewed. A temporary
local preview may copy a **verified genuine** package to a new subdirectory under
`showcase/datasets/` and open:

```text
http://127.0.0.1:4173/living.html?dataset=datasets/<actual-package>/manifest.json
```

`node scripts/serve.mjs` serves the exhibition. The dataset path must remain on its
origin. The default page has no fixture fallback. Playback controls and screenshots
appear only for actual successfully imported, runtime-verified applications with
recorded screenshots. Selected, rejected, task-failed and ineligible outcomes are
labelled separately. Genome-only and unmaterialized candidates remain in the
secondary outcome ledger, with an inspector for actual stage evidence and rejection
reason. Imported candidates that later fail retain their genuine application ID and
import evidence without a fabricated runtime observation or screenshot. Historical
exhibition files stay untouched.

A deployed copy may pin an actual immutable package without a query string by
adding `meta[name="genesis-evidence-manifest"]` with its safe same-origin manifest
path and `meta[name="genesis-evidence-manifest-sha256"]` with the package’s exact
`manifestSha256`. The source HTML intentionally contains neither setting. When
`?dataset=` is present it explicitly overrides the default path; its optional
`?manifestSha256=` pins that chosen package independently. The loader option is
`expectedManifestSha256`. A malformed pin or mismatching root manifest is rejected
before any candidate files are followed or displayed.

Run the focused boundary and empty-state checks without Oracle or provider calls:

```powershell
node --test tests/unit/living-evidence.test.mjs tests/unit/application-publication.test.mjs
node tests/browser/living.mjs
```

To additionally inspect a genuine private package without copying or publishing
it, pass its directory to the browser check. Responses are intercepted from those
exact disk bytes; the normal public loader still verifies them. This exercises the
actual outcome ledger, screenshots, recorded timeline when available, desktop/mobile
layout, accessibility and screenshot tamper rejection:

```powershell
node tests/browser/living.mjs <genuine-packaged-output-directory>
```

The browser check uses existing Edge on Windows and Playwright Chromium elsewhere;
`APXGEN_BROWSER_CHANNEL` can select an already-installed browser channel. It writes
no application evidence or screenshots. Packaging and preview alone do not establish
that an application is deployed or that a cohort or release has completed.

## Stage an actual smoke run

`stage-smoke-evidence.mjs` converts one original private `run-evidence.json` into
sanitized input for the packager. It requires the application worker configuration
with exactly `oracleConfigPath`, `sandboxPolicyPath` and `sqlclPath`; relative
configuration paths resolve beside that file. Supply the configuration explicitly
or through `APXGEN_APPLICATION_CONFIG`. There is no historical LAB fallback.

```powershell
node scripts/application/stage-smoke-evidence.mjs .local/order-lab/runs/<real-run-id>/run-evidence.json .local/order-lab/staging/<new-staging-directory> .local/order-lab/worker.json
node scripts/application/package-evidence.mjs .local/order-lab/staging/<new-staging-directory>/input .local/order-lab/staging/<new-staging-directory>/request.json .local/order-lab/public-evidence/<new-package-directory>
node tests/browser/living.mjs .local/order-lab/public-evidence/<new-package-directory>
```

The API is `stageSmokeEvidence({runEvidencePath, outputRoot, configPath})`. It returns
`{request, inputRoot, requestPath, runId, candidates, files}`, where `request` contains
exactly the packager's `candidates`, `sourceHash` and `evaluatorHash`. The optional
`packageSmokeEvidence({...options, outputDir})` also invokes the ordinary packager.
Both output directories must be new. Nothing uploads or publishes in these steps.

The adapter opens an explicit Oracle read-only transaction, verifies the authorized
schema/workspace mapping, and reads the finished run's immutable candidate decisions,
phase events and import-attempt ledger. Every local candidate must match its canonical
Oracle genome, lineage, definition identity, allocated application and cached decision.
Cached metrics, events and import attempts must agree when present. It never starts
an APEX session, invokes a worker, resets fixtures or changes a run. Credentials and
private account names are consumed only for reconciliation and excluded from output.

Validation needs the original compiler output, matching source hashes and the actual
`VALIDATED` event. Import needs the guarded import result, its compiler binding,
verified metadata, one verified durable attempt and the actual `IMPORTED` event.
Runtime needs actual authentication, anonymous-access blocking and `RUNTIME_VERIFIED`.
Task counters and completion times come from recorded browser tasks and agree with
stored Oracle metrics. Fitness is emitted only with an actual `EVALUATED` event.
The zero defaults recorded by `reject()` for an incomplete run remain an unscored
rejection. An imported application that fails before runtime therefore retains its
real application ID and import evidence, with null runtime, tasks and fitness.

The source hash is SHA-256 of compact JSON of the full recorded `{path, sha256}` list,
sorted by path. The evaluator hash is SHA-256 of compact JSON with keys `sources`,
`protocolHash`, `browserVersion`, in that order. `sources` is the sorted recorded
subset for `run-smoke.mjs`, `runtime/application/tasks.mjs`,
`database/packages/apxgen_app_fitness.sql`, the feasibility configuration, and the
recorded Order Lab fixture package/migration when present. The first four are required;
the configuration hash must equal the recorded protocol hash. Current checkout bytes
never replace historical recorded hashes. Runs with different source identities are
packaged separately.

Every original definition file must still match its private definition manifest and
definition hash. The public artifact is a sanitized source bundle containing the
original `.apx` and `.css` bytes. Private compiler/deployment configuration and logs
are omitted; this bundle is not a complete reproducible compiler project. Its public
artifact hash binds the bundle index, independently from the private definition hash.

Only original PNGs explicitly recorded as a Playwright viewport clip below the
account header are copied. Their SHA-256 and pixel dimensions must match the recorded
clip; the adapter does not edit pixels. Older body-region captures without this proof
are omitted. A selected candidate without safe captures is refused, while an
unselected outcome can remain in the ledger without images. `TEST` and synthetic runs
are refused before database access or staging output. The unit tests use clearly marked
in-memory synthetic input and cannot publish it.

```powershell
node --test tests/unit/application-stage-evidence.test.mjs tests/unit/living-evidence.test.mjs tests/unit/application-publication.test.mjs
```
