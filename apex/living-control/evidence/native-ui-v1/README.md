# Native presentation compiler evidence

This record validates the 67-file native control template with definition hash `2881a97c701d2fae12cccaa934baf35cf978db9152209248cebd543d575fb195`, APEXlang MMD `26.2.0+3479` and the explicit `0.3 development` application version. SQLcl 26.3 ran offline with `/nolog`; no application import, Oracle connection, worker execution or provider request occurred.

Validation succeeded with **20 reviewed `FILE_IGNORED` warnings**, not zero warnings. Each warning names one of the two recorded organisms' ten sanitized `.apx` source assets under `shared-components/static-files/evidence/c46d109a8952417ea277daa0696ed698/`. Every record has line 0, column 0 and the exact message `APEXlang source file ignored.`. The complete records remain in `offline-validation.json`, and `compiler-output.txt` preserves the complete raw compiler output. Its SHA-256 is `d2a1ebd1b1d0271c4cba6548c1341b915591f581559b6e5badeb2ff2193d1fbe`.

The 49 embedded package objects are unchanged from the genuine sanitized native run. Its manifest SHA-256 is `9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e`; total size is 275,656 bytes. All 55 application static files are explicitly declared. Root independently reviewed the exact warning inventory against the manifested source hashes and declarations. This review permits no other compiler warning or general suppression. The static files are evidence assets, not additional application components. See [Oracle's APEXlang creation documentation](https://docs.oracle.com/en/database/oracle/apex/26.2/htmdb/creating-an-application-with-APEXlang.html).

The previous source and compiler records remain immutable at `../../versions/queued-feasibility-v1/template/` and `../queued-feasibility-v1/`. This new receipt proves offline source acceptance only. Runtime verification requires a separately authorized guarded UPDATE_ONLY operation for existing app 134, preserving its original full export, exact owner/workspace/alias, request/role/configuration data, all experiment histories and other applications. The worker must remain disabled and unbound, the canonical coordinator lock must cover the update, and every resulting static BLOB must match the complete source filename/length/hash inventory. Never reuse the create-only importer or remove its permanent attempt marker.

Local frontend checks use the actual template and genuine assets with explicitly TEST-only in-memory API projections:

```powershell
node --test apex/living-control/tests/control-contract.test.mjs
node --test apex/living-control/tests/control-browser.test.mjs apex/living-control/tests/control-view.test.mjs
```

They cover exact candidate/run/parent/application/generation/eligibility/score/selection matching, root and screenshot corruption, unknown-run refusal, hash synchronization with the strict public loader, bounded package caching, local replay with zero Oracle callbacks, text-only labels, disabled capabilities and accessibility at 390/768/1440 pixels. Private `native-ux-TEST-review-*` captures are UI reviews; they are not new APEX application or experiment evidence.
