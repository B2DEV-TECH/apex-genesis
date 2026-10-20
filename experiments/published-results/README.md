# Recorded offline results

Five paired seeds, 100 generations plus generation zero, population 12, identical initial populations and candidate-slot budgets. Source: [manifest](../../showcase/datasets/pilot/manifest.json).

| Seed | Darwin best-so-far | Random best-so-far | Paired difference |
| --- | ---: | ---: | ---: |
| 42 | 98.95 | 98.28 | 0.67 |
| 137 | 98.95 | 98.15 | 0.80 |
| 3107 | 98.95 | 97.35 | 1.60 |
| 7729 | 98.95 | 98.60 | 0.35 |
| 201026 | 98.95 | 97.25 | 1.70 |

Mean paired final difference: 1.0231 points. Darwin wins 5; ties 0; random-search wins 0. Descriptive only; five pairs are not a basis for broad superiority claims.

The primary outcome is final best-so-far, not the final generation winner. Random search retains no population elites, but its historical best remains in the archive. The public race separately shows best-of-generation, including actual regressions.

Every run has 1,212 candidate slots. Retained elites and repeated phenotypes may reuse observations under the same environment fingerprint. Distinct browser evaluations are reported separately; this is equal opportunity, not equal unique browser work or compute.

No Haiku calls or tokens were used. H3 remains untested. API cost is measured zero for these offline conditions; no improvement-per-dollar claim is meaningful.

Fitness rewards the declared proxy and saturates early in some runs. A single-column, large-text layout can win despite requiring more vertical scrolling. The objective does not measure task completion, cognitive load, user preference or beauty. This result exposes a limitation of the fitness design rather than proving a usable interface was discovered.

Runtime comparisons are descriptive: one workstation, sequential runs and a shared evaluation cache. Browser render time is measured separately and excluded from selection. Full machine memory/CPU profiling is not implemented.

Machine-readable [analysis](analysis.json) includes per-run initial/final distributions, eligibility, diversity, mutation acceptance, timings, unique evaluations and winners.
