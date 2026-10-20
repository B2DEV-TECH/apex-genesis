# Verification record — 2026-10-20

Evidence is scoped to the documented local environment: Oracle 23.26.3.0.0,
APEX 26.2.0, SQLcl 26.3 thin, Node 22.16, Chromium 141.0.7390.37, Windows.
These are executed checks, not inferred from source. Ordinary suites use mocks;
a separate authorized live validation is recorded below.

| Suite | Passed checks | Evidence scope |
| --- | ---: | --- |
| npm test | 11 | Grammar/schema, canonicalization, mutation, safe paths, bundle verification, actual AI evidence and recorded fitness context |
| database.mjs | 9 | Actual compilation, seeded origins, immutable genomes, claims and lifecycle |
| evolution.mjs | 8 | Repeated five-generation history with and without cache, elites, size, hashes, checkpoint and invalid population |
| fitness.mjs | 8 | Actual Oracle contrast/font/geometry/focus/names gates, custom weights and timing exclusion |
| controls.mjs (integration) | 7 | Immutable bounded configuration, run-one/run-N boundaries and checkpoint settings |
| budget.mjs | 14 | Disabled mode, concurrent reservations, usage, exhaustion, uncertainty, malformed/truncated/missing-model responses and token overrun |
| ai-boundary.mjs | 7 | Two connections, due/in-flight/response-processing holds, accepted child and stale known-usage recovery |
| ai-fallback.mjs | 2 | Missing credentials stop AI and continue genetic evolution before any HTTP |
| renderer.mjs | 5 | Actual functional renderer, keyboard/filter interaction, three viewports, separate axe audit |
| showcase.mjs | 14 | Real replay, global tree search, method filters, mutation, analytics, mobile, full axe, no page errors and tamper rejection |
| apex.mjs | 10 | Authenticated eight-page native app, creation, scheduler and anonymous denial |
| controls.mjs (browser) | 9 | Real custom-weight creation, bounded worker, private download, separate vote, short tree window and server-side reader denial |
| publication.mjs | 10 local + 10 production | Edge video codecs, actual article/replay/mobile/CSP, media hash/range and public routes |
| verify-export.mjs | 10 runs | 1,010 generations, 12,120 organisms, 1,015 hashed files, 16,654,367 listed bytes |

The native suite includes a longer experiment-label regression. The actual callback
bug was assigning x02 to VARCHAR2(32) before dispatch; validation is now action-specific.
The verifier traversal, scheduler AI race and mode-only evidence label were each
reproduced failing before their fixes. A separate reviewer examined the milestone;
four P2 findings were repaired and regression-checked. No critical finding was reported.

Separate APXGEN_VERIFY owner: clean portable database installation, zero invalid
objects, nine core checks passed. Its initial package compilation preceded the metric
contract fix; the first rendered attempt correctly rejected missing legacy metrics.
After compiling the current revision, the unmodified native SQL export was imported
into a separately mapped workspace with generated app ID **121**. Two genuine
five-generation conditions completed and all ten native browser checks passed.
This does not claim compatibility with other Oracle/APEX versions.
The current installer and explicit uninstall/reinstall were subsequently verified in
this same disposable owner, with zero invalid objects, nine core checks, two actual
five-generation runs and ten native checks against app 121. The publication owner
and all unrelated schemas/applications were preserved.

Representative renderer and exhibition axe runs reported zero violations with no
excluded rules. They do not certify all organisms or complete accessibility. The
exhibition mobile check measured no page overflow at 390px. A cold localhost initial
load measured 135ms in one run; this is not a production SLA or a hardware benchmark.

The real MP4 is 347.333333 seconds, H.264/AAC, 1920×1080, 15,077,195 bytes, SHA-256
`b320cf1d6a0748f3378db178aeb42888bf550124f715227a39655388a0722216`.
[Media evidence](../../media/video/evidence.json) identifies its real Oracle run,
chapters, synthetic narration and editing disclosure. A decoded video frame was
visually inspected. Raw captures remain local; final media is hosted separately.

Runtime model lookup and a real one-generation Haiku mutation passed using the
APEX Web Credential and existing TLS/network configuration. [Live evidence](live-haiku.json)
records 333 input / 65 output tokens, USD 0.0000658 usage-derived cost. A prior
256-token truncated trial was rejected (USD 0.0001615); no automatic retry ran.
Provider request construction now explicitly disables thinking, with two zero-cost
contract checks. No provider invoice verification or main 100-generation AI result
is claimed by this milestone.

## Completed Haiku cohort, 2026-10-20

All 15 preregistered runs completed: 1,515 generations including origins and
18,180 organisms. The verifier checked all 1,520 files (25,693,691 bytes),
canonical hashes, paired origins and generation distributions. Analysis checks
exact seed/condition coverage, completion, shared settings, archived Git source
hashes and all 100 approved operations against exact stored child genomes.
Cost arithmetic tolerance is less than 1e-12 USD.

All five final Darwin/Haiku pairs tied at 98.95. Actual usage: 33,299 input and
5,553 output tokens, USD 0.0061064; 100 accepted proposals, 0 rejected cohort
attempts. Separate trials bring session cost to USD 0.0063337. No invoice or
statistical superiority claim. [Analysis](../../experiments/published-results/haiku-analysis.json).

Five new actual-data browser checks passed: Haiku default, exact mutation/usage,
run-total cost, random control and preserved offline archive. The new test caught
an early-selection race; binding its handler before parent loading and discarding
stale renders fixed it. Showcase 14, unit 11 and native APEX 10 checks passed.
[Haiku browser evidence](haiku-browser.json).
