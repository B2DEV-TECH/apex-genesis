# APEX Genesis engineering design

## Intent and scope

Build a working, independently reproducible Oracle interface evolution laboratory
and a static public exhibition. The supplied master brief is the governing spec.
This design records implementation choices under its autonomous execution policy.
All project content is English. Use synthetic data only. Never modify existing apps.

The first organism is a synthetic operations dashboard with four required sections:
metrics, filters, revenue and orders. The grammar varies section order, responsive
columns, navigation orientation, chart and order representation, spacing, typography,
palette, radii, sort and disclosure. Required data and controls cannot disappear.
Eleven bounded genes describe each phenotype; metadata and parents live separately
so identical phenotypes deduplicate. Canonical fixed-key JSON is SHA-256 fingerprinted.
No markup, code, expressions or URLs can appear in a genome or mutation proposal.

## Architecture and alternatives

Selected: Oracle owns populations, RNG state, genetic operators, immutable genomes,
evaluation queue, lineage, checkpoints, lifecycle and budgets. A small Node/Playwright
evaluation worker renders candidates and submits observations. DBMS_SCHEDULER handles
generation orchestration without an open tab; rendered experiments require the
evaluation worker. The public site consumes verified static exports only.

Rejected: a JavaScript-owned GA would not answer the Oracle research question.
Rejected: database-only heuristic fitness cannot establish rendered responsiveness.
Rejected: arbitrary generated APEX application SQL creates unnecessary authority.

APEX 26.2 Universal Theme supplies authenticated administration. APEXlang is used
for authoring through documented SQLcl tooling, followed by a real SQL export.
The same original ES module renderer and CSS serve APEX previews, evaluations and
public replay; there is no second phenotype implementation.

## Evolution and recovery

Park-Miller RNG uses explicit integer state, multiplier 16807 and modulus 2147483647.
Record engine version and each generation boundary's state. Tournament selection
uses size 3 by default. Uniform crossover transfers complete compatible traits,
including the section permutation as one gene. Mutation changes bounded genes.
Elites are copied into new immutable organism records. Duplicate offspring receive
bounded retries followed by a recorded immigrant. Random search has the same
generation size and evaluation opportunity budget but no evolutionary parent selection.

One transaction owns generation creation, using SELECT FOR UPDATE NOWAIT on the run.
Evaluations use leases and tokens; stale leases can be reclaimed. Evaluated generations
are finalized only after all candidates are terminal. Cancellation acts at generation
boundaries; no promise of interrupting an in-flight provider HTTP request is made.
Checkpoint restore duplicates into a new run, preserving the original history.

## Evaluation contract

Hard gates: supported grammar, complete section permutation, text >=14px, contrast
>=4.5:1, visible controls, no overflow/clipping/overlap at 390, 768 and 1440px.
Browser evaluation records keyboard focus, required accessible names and axe findings.
Failures have score zero and cannot beat eligible candidates. All-invalid populations
are reported; tournament ties among invalid parents are random while variation
continues to seek feasible offspring. No least-violation ranking is implemented.

Technical fitness is a transparent weighted sum: accessibility 0.40, hierarchy 0.25,
responsiveness 0.25, deterministic DOM-size performance proxy 0.10. Timing is measured
separately, excluded from selection to avoid optimizing scheduling noise. Hierarchy
is a declared task proxy (summary and filters precede detailed records), not beauty
or proof of usability. Human votes are separate and excluded from primary fitness.
Repeated phenotypes may reuse metrics only under an identical evaluation fingerprint.

## Optional AI and cost

AI is disabled at installation. Paid execution requires explicit per-run opt-in,
owner-configured APEX Web Credential, runtime model lookup, a fresh reviewed pricing
snapshot, and run/daily budgets. A serialized reservation transaction precedes HTTP;
no database row lock spans the request. Retries reserve separately. Uncertain failures
retain the entire reservation; unknown usage fails closed. Stop AI persists immediately.
No credential or privileged endpoint is exported. Unknown mutation properties fail.
The initial mutation policy replaces at most one offspring every five generations;
AI never increases the evaluation budget or scores its own output.

## Research and publication gates

Pre-register H1: GA_ONLY improves best-so-far technical fitness over its generation 0.
H2: paired-seed GA_ONLY improves over RANDOM_SEARCH at equal evaluation opportunity.
H3: GA_HAIKU improves over GA_ONLY at equal opportunity, with external cost reported.
No superiority is assumed. Distinguish candidate slots from unique browser evaluations.
Use multiple paired seeds where feasible. Report distributions and paired differences;
do not infer significance from one showcase or dependent generation observations.

Export immutable run metadata, genomes, all parent edges, measured evaluations,
generation summaries, events, sanitized approved mutations and SHA-256 file manifest.
Public visitors see Recorded experiment labels and explicit unavailable AI evidence.
Index and generation partitions load lazily. Article publication follows a real
end-to-end offline run if AI authorization is unavailable. Its title must disclose
the actual conditions. Video must contain real software captures and editing disclosure.

## Verification and portability

Test actual Oracle package behavior, duplicate seeded runs, parent immutability,
population size, constraints, failure handling, recovery, concurrent reservations,
lease ownership and stale claims. Test renderer with real Chromium, responsive
viewports, axe, interactive controls, replay, tree and no console errors.
Only tested versions are certified: observed Oracle 23.26.3.0.0 and APEX 26.2.0.
Portable installers accept destination context without fixed lab credentials or IDs.
