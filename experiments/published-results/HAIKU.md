# Recorded Haiku comparison

Five paired seeds, three conditions, 100 advances plus generation zero, population 12. All 15 runs completed, 18,180 candidate slots. [Immutable export](../../showcase/datasets/haiku-paired/manifest.json). Exact source 54f35e538b75722af22efc61dc321fd35134d682; every source hash independently checked against Git.

| Seed | Darwin | Haiku | Random | Haiku minus Darwin | AI cost USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| 42 | 98.9500 | 98.9500 | 98.2846 | 0.0000 | 0.0011829 |
| 137 | 98.9500 | 98.9500 | 98.1500 | 0.0000 | 0.0011860 |
| 3107 | 98.9500 | 98.9500 | 97.3500 | 0.0000 | 0.0012161 |
| 7729 | 98.9500 | 98.9500 | 98.6000 | 0.0000 | 0.0012169 |
| 201026 | 98.9500 | 98.9500 | 97.2500 | 0.0000 | 0.0013045 |

Mean final paired Haiku-minus-Darwin difference 0.0000000. Haiku wins 0, ties 5, Darwin wins 0.

100 actual provider attempts; 100 approved proposals replay to the exact stored child genomes; 0 rejected proposals. 33299 input / 5553 output tokens. USD 0.0061064 computed from returned usage and reservation rates; invoice not verified. Two separate integration trials add USD 0.0002273 and are not part of the comparison. Authorized aggregate cap USD 20; no automatic renewal.

Primary final best-so-far is separate from best-of-generation and mean trajectory. Secondary time to 95 and mean-best-so-far outcomes appear in [full analysis](haiku-analysis.json), together with eligibility, distributions, diversity, timings, mutation acceptance and cost. Generations are dependent, not independent repetitions. Five seeds do not support general superiority claims.

The original offline pilot was already known to plateau at 98.95. Objectives were held fixed and this prior knowledge was disclosed before the new cohort. AI replaces an existing offspring; it receives no additional candidate slots. External model inference adds computation and latency. A shared cross-run browser cache makes unique browser work unequal, reported per run. No human task or preference outcome is measured.
