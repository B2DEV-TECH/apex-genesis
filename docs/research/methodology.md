# Protocol, scoring and interpretation

The [registered offline protocol](../../experiments/configurations/offline-paired.json)
precedes the ten runs. H1 asks whether GA_ONLY improves over its origin; H2 compares
paired GA_ONLY/RANDOM_SEARCH final best-so-far; H3 compares GA_HAIKU/GA_ONLY and
remains **untested** without paid execution.

Five paired seeds: 42, 137, 3107, 7729, 201026. Population 12, generation zero plus
100 advances, mutation .25, crossover .75, two elites, tournament three. Identical
origins, scenario, browser, viewports and objectives. The equal opportunity budget
is 1,212 candidate slots per run. Cache reuse means unique browser work, external
inference and workstation compute are not equalized.

## Hard gates and score

The authoritative [PL/SQL rules](../../database/packages/apxgen_fitness.sql) validate
grammar, contrast >=4.5, text >=14px, required sections, accessible names, focus and
zero measured overflow/overlap/clipping/errors at 390, 768 and 1440px. Failures receive
zero eligible fitness. All-invalid ties are random while variation continues.

For eligible candidates, score = .40A + .25H + .25R + .10P, rounded to six decimals:

- A = min(100, 60 + min(20, (minimumContrast − 4.5) × 4) + min(20, fontGene × 5)).
  Font genes 0–4 map to 12, 14, 16, 18, 20px; gene zero fails eligibility.
- H = max(0, 100 − 15 × metricsPosition − 15 × max(0, filtersPosition − 1)
  − firstFilterPenalty − 5 × abs(spacingGene − 3)). The first-filter penalty is
  five when filters are first, otherwise zero. Positions are zero based; spacing
  genes 0–5 map to 4–24px. This is a declared task preference.
- R = 100 when measured geometry passes, otherwise zero and ineligible.
- P = clamp(100 − .5 × (DOMNodes − 40), 0, 100), a structural cost proxy.

Contrast uses sRGB relative luminance and the least declared palette pair. Actual
synchronous render/layout time is recorded separately and excluded from selection.
The original records contain a legacy axeCritical=0 placeholder; per-candidate axe
was not performed. New metrics record audit.performed=false. Separate release
fixtures receive axe audits. Neither scope establishes complete accessibility.

## Persistence and analysis

Summaries store mean, median, population variance, current best, historical best,
eligibility, diversity and accepted variation. Diversity is unique phenotypes divided
by population size, not genetic distance. Mutation acceptance means an eligible
varied child exceeds its best parent; counts include recorded crossover/immigrant
variation methods, not human preference.

[Analysis JSON](../../experiments/published-results/analysis.json) derives from stored
observations. Export verification recomputes hashes, candidate counts, summaries,
ordering and paired origins. External cache sources are exported separately.

Final paired differences average 1.0230776 points. This descriptive pilot does not
justify significance, universal superiority or treating dependent generations as
independent repetitions. Best-so-far is naturally nondecreasing; current-generation
scores can regress. No human task or preference experiment ran.

Original engine 1.0.0 and commit be49b9d are preserved in the manifest. Later engine
1.0.1 fixes do not relabel these results. The original context hashed sources but
omitted the executed preview bundle. Publication review confirmed that archived
bundle matches its source; new contexts verify and hash executed bytes before cache
reuse. This is a provenance limitation, not evidence of demonstrated corruption.

## Limits and next experiments

The small grammar/objective saturates at 98.95. Long single-column winners expose
missing scroll/task costs. Sequential cache sharing confounds runtime comparisons.
No full CPU/memory profile or blinded user study exists. Pareto/rank selection,
adaptive AI invocation, more scenarios and human preference require new protocols.
Live Haiku evidence must report actual outputs, tokens, usage-based cost and invoice
status; mocks cannot substitute for that experiment.
