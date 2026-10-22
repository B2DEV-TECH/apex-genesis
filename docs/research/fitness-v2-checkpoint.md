# Fitness 2 development checkpoint — 2026-10-22

Development is paused at the owner's request. This branch preserves the unfinished
`scripts/evaluate-v2.mjs` browser evaluator separately from Living Applications.
It is not a release or an executed Fitness 2 experiment.

The draft measures synthetic tasks, accessibility, responsive geometry and page
density. Its comments describe an intended Oracle scoring boundary; this branch
does not include an installed `apxgen_fitness_v2` package, a scoring migration or
worker integration. No new experiment or provider call is required to save it.

The evaluator has been syntax-checked. The existing renderer integrity test first
reproduced a Windows CRLF checkout mismatch; normalizing the generated HTML to
the canonical LF bytes and pinning HTML checkout line endings addresses that
packaging issue without changing the renderer or historical fitness definition.
The baseline unit suite is checked separately from evaluator runtime correctness.
