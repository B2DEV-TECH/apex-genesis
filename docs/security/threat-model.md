# Security boundaries

Assets: Oracle history, authenticated controls, provider credentials, spending limits
and truthful public evidence. Inputs cross different trust boundaries.

| Boundary | Control | Residual limitation |
| --- | --- | --- |
| Genome to browser | Strict property/type/value allowlists, textContent, predefined CSS, opaque-origin sandbox | Browser defects remain possible; fixture audits have limited scope. |
| Model to genome | Only 1–3 allowlisted operations, canonical validation, no code/URLs | Live provider and TLS access remain unverified. |
| APEX user to owner packages | APEX Accounts plus READER/OPERATOR/OWNER principals; server callback role gates | Owner and workspace administrators are trusted. |
| Worker to queue | Lease tokens, locks, expiry, same-context cache, authoritative cached observations | Worker observations are trusted; this is not remote attestation. |
| Concurrent AI workers | Serialized reservation, single in-flight request, due-generation hold, stale uncertainty | Stopping an in-flight request may still incur cost. |
| Oracle to public | Sanitized export, file allowlist, SHA-256, lazy partitions, no live privileged endpoint | Manifest is not a signature against complete publication replacement. |

Provider calls use a fixed HTTPS Anthropic origin and an APEX Web Credential. ACL
and wallet configuration remain owner/DBA responsibilities. Keys never reach the
browser. Usage-based and invoice-verified charges are distinct. Uncertain charges
retain their reservations and stop further spending.

Public visitors can replay and inspect only. No voting backend, model-call capability
or database credentials are deployed. Human-vote rows are separate from primary
fitness; public voting infrastructure is outside this alpha.

Use documented grants and a dedicated workspace/schema. The app never edits other
APEX definitions. No employer/client data is needed. The installer does not grant
privileged access or change network ACLs. Removal is a separate deliberate operation.
