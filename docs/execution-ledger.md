# Execution ledger

2026-10-20: empty repository cloned into a dedicated allowed directory. Existing
monorepo and website work are preserved. GitHub authentication verified. Oracle
23.26.3.0.0 and APEX 26.2.0 observed through read-only OS-authenticated queries.

Pre-flight interfaces: genome contract feeds Oracle genetics and renderer; evaluation
observations feed Oracle fitness; Oracle export feeds static replay; common renderer
feeds all three hosts. Names and ownership agree with the design.

Ruling: use a dedicated checkout inside the writable workspace instead of the
suggested Labs directory, avoiding an unnecessary filesystem escalation. No source
behavior changes. The autonomous user brief overrides routine skill approval stops.

Task 1: shared renderer and strict genome tests pass (3 unit behaviors, 5 browser
checks including a real axe audit). Dedicated schema/workspace created. Foundation
DDL and six packages compile without USER_ERRORS. SQL*Plus entry must run from
installer directory; installer now rejects absent foundations and compilation errors.

Task 2 progress: 9 live database checks pass, including seeded initialization,
immutable genomes, forged claims and pause/resume/stop. Real five-generation smoke
run 0c70d099b633423f9603e698d7df6f8d completed 36 candidate slots, 10 cache hits.
That run predates the final evaluation fingerprint and is not a published result.

Task 3 progress: 8 mocked budget/provider checks pass with zero provider HTTP.
Two independent connections cannot both reserve the same available slot. Actual
usage reconciliation, exhaustion, uncertain reservations and invalid proposals tested.
Live provider integration remains unverified and is not yet enabled.
