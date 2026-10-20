# Contributing

Use English in source, issues, documentation and UI. Work in a branch and submit a
focused pull request with the problem, behavior, verification and limitations.
Use synthetic data and a dedicated Oracle schema/workspace. Never copy customer
applications, credentials or private prompts into fixtures.

Run `npm ci`, `npm test` and `node scripts/verify-export.mjs`. Renderer changes also
require `node scripts/build-renderer.mjs` and real browser suites. Database changes
require a clean install, compilation checks and relevant Oracle integration tests.
Run budget tests sequentially in a verification schema: they temporarily replace
provider metadata, restore it afterward, and perform no HTTP requests.

Do not edit published observations to improve a result. Changes to genome, renderer,
scoring or operators require a new version/fingerprint and newly identified runs.
Keep prior protocols and provenance. Preserve negative findings and regressions.
Dependent generation points are not independent experimental repetitions.

Provider integrations must validate bounded operations, reserve cost before HTTP,
retain uncertain charges and protect credentials. Paid calls require explicit
owner opt-in, even in development. The pure engine must work without paid services.

Original contributions are licensed under Apache-2.0. Identify third-party assets
and retain notices. Do not claim Oracle endorsement or a world-first. Maintainers
may request evidence before merging behavioral claims.
