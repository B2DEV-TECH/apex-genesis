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
