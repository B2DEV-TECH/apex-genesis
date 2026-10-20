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

Task 2 verified: 7 full-evolution checks pass, including repeated five-generation
histories, elite immutability, cross-language SHA-256, checkpoint duplication and
all-invalid reporting. Oracle still owns selection and offspring creation.

Task 4 verified: native APEX app 120 imports through SQLcl 26.3; eight functional
pages, authenticated control/configuration and common history frontend. Native
browser suite: 10 checks pass including actual creation/scheduler startup and
anonymous denial. Long experiment labels now have a regression test. Root cause
of the empty AJAX response was premature assignment of x02 into VARCHAR2(32),
not JSON itself; configuration retains the simpler scalar argument contract.

Task 5 verified: ten real offline runs completed 100 advances plus generation zero.
Five paired seeds, 12,120 candidates, 1,010 generation partitions. Export verification
recomputes hashes and summaries and checks identical initial populations. Darwin
minus random final best-so-far mean = 1.0230776 points, all five positive. No inference
about beauty/usability or statistical significance. Published source is original
engine 1.0.0 at be49b9d; exact archived source hashes were checked against Git.

Public browser suite: 12 checks pass, full axe with no excluded rules, zero page
errors, responsive mobile, real replay/tree/mutations and tampered-partition rejection.
Cold local load observed 136 ms in one test; not a production performance guarantee.

Independent review by milestone_review found four P2 issues. Verifier traversal was
reproduced RED then fixed GREEN. Preview bundle/source verification and executed-byte
fingerprinting added. AI due/in-flight boundary race reproduced RED and fixed GREEN
with two Oracle connections (4 checks, zero HTTP). Invocation-derived evidence labels
tested RED then GREEN. Backend now copies cache measurements from Oracle; external
cache-origin observations are exported. Per-candidate axe is explicitly not run.
All-invalid parent ties are random; update design to avoid claiming least-violation
ranking. Existing offline data remain unchanged and carry legacy scoring provenance.

Engine 1.0.1 contains the safety fixes. Its new evaluation fingerprint is distinct.
No old run is relabeled as this implementation. The provider remains disabled;
key and up-to-US$1 authorization were requested asynchronously and remain pending.

Clean install: separate APXGEN_VERIFY schema, documented grants, all nine packages
compiled, zero invalid objects, 9 core checks pass. No pre-existing schema was reset.

Publication in progress: isolated website worktree ../genesis-site on
feature/apex-genesis from site main 9b58a65. Existing checkout untouched. Cloudflare
authentication verified. English technical article prepared from actual results.
28 original local English voice segments and WebVTT prepared; 347.318371-second
timeline. Continuous real recording is running; video is not yet a completed claim.

## 2026-10-20: native controls and live provider milestone

Source and website PR #2 merged; original pilot/article/exhibition and real
5:47 demonstration published and checked. Production dataset: 1,015/1,015 files
match their manifest. Native app export imported and uninstall/reinstalled only
in the dedicated disposable APXGEN_VERIFY owner; eight pages and bounded controls
verified. Per-run weights, checkpoint copies, votes, downloads and lineage search
work with recorded settings and server-side role checks.

Owner configured the APEX Web Credential and explicitly authorized USD 20 total.
Lifetime and daily caps are both20, per-run cap1 for the registered cohort. Real
model lookup confirms claude-haiku-5-5 and thinking-disable capability. First
trial reached256output tokens and was rejected: USD0.0001615 usage-derived cost.
Explicit thinking-disabled request then passed:333input/65output, USD0.0000658,
three validated operations, actual rendered/evaluated offspring. No invoice claim.

Focused independent review found a provider-configuration snapshot race. Requests
now read model/token limits from the committed reservation before HTTP. Unit11,
budget14, AI boundary7, fallback2 and request contract2 pass; ordinary tests stay
in APXGEN_VERIFY to preserve the live owner credential/configuration. The paired
Haiku cohort is preregistered; its execution follows this committed milestone.
