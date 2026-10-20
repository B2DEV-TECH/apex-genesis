# Changelog

## 0.2.0-alpha.1 — 2026-10-20

- Autonomous operation: lease-holding Node supervisor, Oracle policy and admission
  (`apxgen_autonomy`, migration 006) and a durable command queue. Deterministic
  independent-then-lineage runs, bounded recovery continuations and stagnation actions.
- Two least-privilege Windows tasks (`B2DEV-Genesis-Supervisor`,
  `B2DEV-Genesis-Watchdog`): current user, no SYSTEM, no stored password, no
  power-policy changes. The watchdog never restarts the supervisor after a deliberate stop.
- Resource limits: storage budget, daily generation cap, disk/memory/CPU throttling,
  browser recycling and BelowNormal priority.
- Verified publication of completed generations to R2: immutable hashed run and
  catalog objects, a single verified pointer, rollback on failure, an allowlist and
  a secret scan.
- Native APEX page 9, Autonomous Operations, with server-side OPERATOR authorization.
  Operator CLI `runtime/genesisctl.mjs`.
- Website live archive (`/genesis/live.html`) proposed separately. The recorded
  pilot and Haiku archives are unchanged.
- `apex-local.ps1` now fails on SQL errors (the byte-order mark no longer swallows
  `whenever sqlerror`).

## 0.1.0-alpha.1 — 2026-10-20

- Oracle-owned seeded genetic engine, random-search control, immutable history,
  leased browser evaluations, checkpoint duplication and scheduler orchestration.
- Shared constrained dashboard renderer; native eight-page APEX laboratory and
  public static replay, ancestry, mutation comparison and technical analytics.
- Five real paired offline seeds, 100 generations per condition, 12,120 records,
  verified export, descriptive analysis and source provenance.
- Optional disabled Anthropic mutation integration, serialized budget reservations,
  reconciliation, uncertain charges and two-worker boundary tests.
- Clean-install evidence, English technical article and real captioned demonstration.

Original experiment engine: 1.0.0 at `be49b9d`. Current engine: 1.1.0, including
reviewed scheduler/response-processing fixes, immutable configurable fitness,
bounded controls, run downloads, separate human comparisons, population selectors
and organism search. No completed live Haiku experiment.

- Recorded five-seed, three-condition Haiku comparison: 15 completed 100-generation
  runs, 18,180 organisms and 100 real accepted provider proposals. Five final-score
  ties at 98.95; usage-derived cost USD 0.0061064. Preserved original offline pilot.
- Public replay now defaults to Darwin/Haiku, with recorded mutation operations,
  token/cost inspection and random-control selection. Fixed inspector selection race.
- Added an operational Claude handoff; continuous service operation is a next task.
