# APEX Genesis implementation plan

> Execution: native implementation in this session under the user's autonomous brief;
> use superpowers:executing-plans and test-driven-development. No routine approval gates.

**Goal:** deliver the Oracle engine, actual experiments and a public recorded exhibition.
**Architecture:** Oracle authoritative state plus a bounded browser evaluation worker;
one ES module renderer shared by APEX, evaluation and static publication.
**Stack:** Oracle 26ai Free, APEX 26.2, SQLcl/APEXlang, Node 22, Playwright, native JS/CSS.
**Spec:** [design](architecture/design.md) and supplied master engineering brief.

## Global constraints

- English only; Apache-2.0 original code; synthetic data only.
- No arbitrary generated code or changes to existing applications.
- AI disabled by default; no paid call without explicit owner opt-in.
- Publish actual observations; distinguish unavailable and unverified capabilities.
- No fixed schema/workspace/app IDs in portable install configuration.

## Review focus

- All-invalid generations must not look like successful optimization.
- Two workers must not finalize, evaluate or reserve the same work twice.
- A stale or forged evaluation token must not overwrite measured history.
- Dataset tampering or partition path traversal must stop public replay.
- Pause/stop/recovery and empty populations must have visible truthful states.

## Task 1: Foundations, genome and shared renderer

Files: database/migrations/001_core.sql; database/packages/apxgen_genome.sql;
showcase/renderer/{genome,renderer}.mjs; showcase/renderer/organism.css;
evolution/genome-schema/genome.schema.json; tests/unit/genome.test.mjs.
Interfaces: validateGenome(genome), renderOrganism(root,genome), canonicalGenome(genome);
Oracle APXGEN_GENOME from_genes, validate, fingerprint, random_genome.

- [ ] Write rejection, fingerprint and renderer tests; observe initial failures.
- [ ] Implement bounded schema, canonical phenotype and complete synthetic renderer.
- [ ] Create isolated owner/workspace and install relational foundations.
- [ ] Verify npm test and live Oracle validation. Commit.

## Task 2: Oracle evolution, evaluation and lifecycle

Files: database/packages/apxgen_{genetics,fitness,evolution}.sql;
installer/install.sql; scripts/{db,evaluate,run-experiment}.mjs;
tests/integration/database.mjs.
Interfaces: create_run, initialize, advance, submit_evaluation, control, duplicate_run;
evaluation requests use leased organism ID and opaque claim token.

- [ ] Write live tests for determinism, immutability, invalid evaluations and lifecycle.
- [ ] Implement RNG, tournament/crossover/mutation, elitism/diversity and durable history.
- [ ] Implement browser evaluator, failed metric handling and evaluation cache.
- [ ] Test duplicate seeds, concurrent calls and pause/recovery. Commit.

## Task 3: Budgeted optional AI

Files: database/packages/apxgen_{budget,ai}.sql; tests/integration/budget.mjs;
evolution/mutation-policies/bounded.schema.json.
Interfaces: reserve/reconcile/uncertain/stop; propose(run,organism) returns safe genome.

- [ ] Test disabled, concurrent budgets, exhausted budget, uncertain usage, unknown ops.
- [ ] Implement owner-configured pricing, model lookup, secure credential HTTP adapter.
- [ ] Test mocked provider responses and offline fallback; no paid execution. Commit.

## Task 4: APEX and static visual laboratory

Files: apex/application/; showcase/{index.html,lab.mjs,lab.css}; scripts/serve.mjs;
tests/browser/showcase.mjs.
Interfaces: static partitioned dataset OR authenticated APEX process feeds common lab.

- [ ] Verify a real organism, controls, replay pause/scrub, tree and mobile behavior.
- [ ] Build native Universal Theme pages, authenticated processes and shared previews.
- [ ] Compile/import through SQLcl; export actual app; capture screenshots. Commit.

## Task 5: Experiments, analysis and export

Files: experiments/configurations/; scripts/{export,verify-export,analyze}.mjs;
experiments/published-results/; docs/research/; docs/testing/.
Interfaces: manifest indexes immutable JSON parts with SHA-256 and safe relative paths.

- [ ] Run 5-generation smoke, repeated seeds and actual 100-generation offline runs.
- [ ] Export database measurements and verify partition hashes and chronology.
- [ ] Analyze paired offline controls; explicitly report absent AI observations.
- [ ] Verify full dataset UI and record measured limitations. Commit.

## Task 6: Publication, video and release

Files: docs/installation/; README.md; media/; showcase/integration/; site-specific files.

- [ ] Prepare installer, upgrade/uninstall, references, security, provenance and notices.
- [ ] Capture real footage and subtitles; build/verify MP4 and thumbnail.
- [ ] Write evidence-based English article and embed static exhibition.
- [ ] Test site; review code, licenses and secrets; push/release/deploy when checks pass.
- [ ] Verify public URLs and write final engineering/ACE contribution reports.
