# Order Lab application fitness 2.0 protocol

Status: implementation contract, not an executed or preregistered cohort.
The three additive packages compiled without `USER_ERRORS` in the separately
authorized Order Lab sandbox on 2026-10-22. The pure Oracle contract test passed
69 check groups, including validation of all 64 genomes. Real materialization and
browser acceptance remain separate gates. No application fitness result from a
real materialized candidate is claimed here.

`apxgen_app_fitness.c_fitness_definition` is
`order-lab-task-proxy/2.0.0`; its evidence protocol is
`application-fitness-2.0`. This definition is independent of dashboard fitness
1.1.0. Changing a formula, weight, task script, fixture, viewport, instrumentation
or normalization requires a new protocol/definition or a separately recorded
experimental condition before comparing candidates.

The score is an automated engineering proxy. Action counts do not measure human
task time, satisfaction or aesthetics. The accessibility component records bounded
automated checks; a passing value is not an accessibility certification.

## Genome contract

`apxgen_app_genome` accepts only this five-key envelope, six named binary traits
and the three fixed task names in the displayed order:

```json
{"schemaVersion":"2.0","application":"GENESIS_ORDER_LAB","dataSource":"GENESIS_ORDERS_SAFE_V","tasks":["locateOrder","filterOrders","updateOrder"],"traits":{"report":"classicReport","edit":"page","filters":"above","summary":"before","navigation":"side","density":"comfortable"}}
```

Alternative alleles are `interactiveReport`, `modal`, `beside`, `after`, `top`
and `compact`, respectively. Unknown properties, duplicate JSON keys, alternate
tasks, type coercion, nulls, code and URLs have no representation in this grammar.
Input genomes are limited to 4,096 characters. Canonical bytes use exactly the
displayed root/trait key order, compact JSON, unchanged task order and no newline.
Fingerprints are lowercase SHA-256 of the canonical UTF-8 bytes.

`validate`, `canonical` and `fingerprint` are pure. `random_genome` draws six
binary alleles in trait order through a local pure Oracle Park-Miller helper,
using exactly the existing RNG arithmetic and golden sequences. This avoids
installing historical dashboard tables or a duplicate provider/spending ledger
in the dedicated application sandbox. `mutate` draws one trait and flips its allele, so a
valid mutation always changes exactly one trait. `crossover` draws once per trait
and chooses the corresponding allele from parent A for zero, parent B for one.
All RNG entry points require an integer state from 1 through 2,147,483,646.
No JavaScript genetic algorithm or persistence is introduced.

`apply_proposal` accepts only an object containing `operations`, an array of one
through three distinct `{ "trait": "edit", "value": "modal" }` operations.
Each operation has exactly those two string properties and an allowed allele.
Proposal input is limited to 2,048 characters. Validation failures use ORA-20110
for genomes/RNG and ORA-20111 for proposals. No partially applied result is returned.

## Exact evidence contract

The trusted builder and browser evaluator supply exactly these 20 root keys:

```json
{
  "fitnessDefinition": "order-lab-task-proxy/2.0.0",
  "protocolVersion": "application-fitness-2.0",
  "genomeFingerprint": "<64 lowercase hexadecimal characters>",
  "compilerValidated": true,
  "importVerified": true,
  "authenticationVerified": true,
  "runtimeVerified": true,
  "fixtureVerified": true,
  "databaseChangeVerified": true,
  "securityVerified": true,
  "tasks": {
    "locateOrder": {"success": true, "actions": 2, "navigationSteps": 0},
    "filterOrders": {"success": true, "actions": 3, "navigationSteps": 0},
    "updateOrder": {"success": true, "actions": 4, "navigationSteps": 1}
  },
  "viewportsTested": 3,
  "criticalViolations": 0,
  "seriousViolations": 0,
  "unnamedControls": 0,
  "focusFailures": 0,
  "horizontalOverflow": 0,
  "runtimeErrors": 0,
  "loadMs": 500,
  "componentCount": 10
}
```

The placeholder fingerprint in this explanatory example must be replaced by the
actual Oracle canonical fingerprint. Evidence is capped at 8,192 characters.
JSON must be strict and have unique keys at every depth. Strings must be nonempty;
flags must be JSON booleans. Counts must be JSON numbers with integer value;
numeric strings, fractions and nulls are rejected. Task objects have exactly the
three shown keys; unknown task names are rejected.

Actions, navigation steps, violation counts and runtime errors are in
0..100,000. `viewportsTested` is in 0..3, `loadMs` in 0..3,600,000, and
`componentCount` in 1..100,000. A successful task requires at least one action.
Navigation steps cannot exceed actions. `loadMs` is rounded up to whole
milliseconds by the evaluator before submission. Missing, malformed, contradictory
or mismatched-genome evidence raises ORA-20120 rather than receiving a score.

Complete evidence with a failed observation is retained as ineligible, with final
fitness zero. Every field is validated even after an earlier gate fails. Eligibility
requires all seven verification flags true, all three tasks successful, three
tested viewports, no counted accessibility/responsive failures and no runtime errors.

## Observations and trust boundary

Compiler validation must refer to the trusted, versioned APEXlang template output.
Import verification checks the intended app ID, workspace and parsing schema in
installed metadata. Authentication verification checks both denied anonymous access
and successful authorized access. Runtime verification checks the authenticated
application rather than accepting the import process exit code.

The fixture contains only fixed synthetic orders. The evaluator resets its owned
fixture partition before each task trial and independently asserts the outcome:

| Task | Required independent outcome |
| --- | --- |
| `locateOrder` | The designated synthetic order's identifier and expected values are visible. |
| `filterOrders` | The exact expected set of synthetic order IDs is shown after the prescribed filter. |
| `updateOrder` | The target field is changed through the application and an independent database query confirms the expected row/version and value. |

`fixtureVerified` confirms the expected initial fixture version/hash, and
`databaseChangeVerified` confirms the update and absence of unintended fixture
changes. `securityVerified` confirms fixed authorization checks, rejected access
to another owned fixture partition, and absence of public mutation endpoints.
These booleans require independent assertions; rendering a screenshot or issuing
a click does not establish success.

An action is one scripted user intent: click/activate, fill one logical field,
choose one option or submit. Waiting and assertion reads do not count. A
navigation step is an action that opens/replaces a page or dialog. All candidates
use the same initial route, authentication state, target values and task script.
Future browser acceptance must freeze the complete script and fixture hashes
before a scored cohort; these definitions alone do not establish comparability.

Accessibility and responsiveness checks cover authenticated pages and the edit
surface at 390, 768 and 1,440 CSS pixels, height 1,000. The evaluator records the
total critical/serious automated audit violations, controls lacking accessible
names, failed visible-focus checks, and horizontal-overflow observations.
`runtimeErrors` counts uncaught page errors and failed required application
requests. Audit coverage, browser, APEX/APEXlang version and instrumentation
hashes belong in the retained evidence record even though they are not score inputs.

`loadMs` is the median of three warm authenticated initial-page loads, measured
from navigation start until the report and required controls are ready for the
first task. Each trial starts with the same reset fixture and browser conditions.
`componentCount` is obtained from independently verified installed APEX metadata:
non-global task pages plus their regions, page items and dynamic actions, each
counted once; shared template assets and authentication pages are excluded. The
genome and model cannot self-report or choose this number.

The pure scoring package verifies shape, ranges, consistency and genome identity.
It cannot prove that submitted observations came from a real browser. Only the
trusted worker may submit scoring evidence, and a future persistence boundary
must retain source/template/fixture/evaluator hashes and raw assertions. These
packages introduce no public submission endpoint, credentials or database tables.

## Fixed normalization and weights

For an observed cost `x`, ideal `a` and ceiling `b`, define
`costScore(x,a,b) = max(0,min(100,100*(b-x)/(b-a)))`.

| Component | Weight | Normalization |
| --- | --- | --- |
| Task effort | 35% | Mean of action scores: locate ideal 2/ceiling 12; filter 3/15; update 4/20. |
| Navigation | 25% | Mean of navigation-step scores: locate 0/4; filter 0/4; update 1/6. |
| Accessibility/responsiveness | 20% | 100 when three viewports pass all bounded checks; otherwise 0 and ineligible. |
| Performance | 10% | `costScore(loadMs,500,5000)`. |
| Simplicity | 10% | `max(0,100-2*max(0,componentCount-10))`. |

Eligible final fitness is the weighted sum on a 0..100 scale. Oracle weights the
unrounded component values and rounds the final result to six decimal places.
Returned component values are also rounded to six decimals. Components remain
diagnostic for complete ineligible evidence; the final score is always zero.

The ideal fixture above scores 100. With action counts 7/9/12, navigation steps
2/2/1, load 2,750 ms and 35 components, component scores are
50 / 66.666667 / 100 / 50 / 50, and final fitness is 64.166667.
Poor effort, navigation, load and complexity can still yield 20 if all hard gates
pass; no minimum quality threshold beyond eligibility is implied by this definition.

## Verification and installation boundary

The package sources are additive and deliberately absent from existing LAB
installation/upgrade paths. They do not modify genome/fitness 1.x, historical
weights, run budgets, provider settings, scheduler state or archives.

`tests/integration/application-contract.mjs` requires
`APXGEN_APPLICATION_TEST_CONFIG` pointing to a local configuration containing
`user`, `password`, `connectString` and explicit
`sandbox.schema`, `sandbox.workspace`, `sandbox.workspaceId`,
`sandbox.applicationIds`. The connected owner/current schema and workspace mapping
are verified with read-only queries. Active `APXGEN_LAB` and existing applications
120/121 are excluded. The test invokes only pure package functions and rolls back;
it never installs packages, resets fixtures or imports applications. With no
configuration it reports skipped before opening a connection. Do not interpret
that skip as Oracle compilation or a passing PL/SQL contract test.

The integration checks cover all 64 genomes, canonical byte/hash agreement,
duplicate/unknown/type/code rejection, deterministic RNG golden values, mutation,
crossover, bounded distinct proposals, every hard gate, score arithmetic and
malformed evidence. These pure calls passed in the dedicated `APXGEN_ORDER_LAB`
sandbox on 2026-10-22. The fixture registry and order table were empty afterward;
no application was imported and no provider request was made by those checks.
