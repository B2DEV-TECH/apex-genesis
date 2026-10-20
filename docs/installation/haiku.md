# Optional Haiku setup and spending

The complete offline experiment works without an API key. Provider installation
defaults are disabled and every run budget starts with enabled=0.

The original documentation review on 2026-10-20 found `claude-haiku-5-5`, with
short-prompt base rates starting at USD 0.10/input million and 0.50/output million.
Sources: [model catalog](https://platform.claude.com/docs/en/models/overview),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Messages](https://platform.claude.com/docs/en/api/messages/create),
[model lookup](https://platform.claude.com/docs/en/api/models/retrieve), and
[token counting](https://platform.claude.com/docs/en/api/messages/count_tokens).
These observations do not establish access for your account or future prices.

## Credential

In your dedicated workspace, create a Web Credential with HTTP Header authentication,
header name `x-api-key`, and the secret API key. Restrict valid URLs to
`https://api.anthropic.com/`. Never put the key in JavaScript, exports, prompts or Git.
[Oracle documents HTTP Header credentials](https://docs.oracle.com/en/database/oracle/apex/26.2/htmdb/understanding-web-credentials.html).

The original lab offers `scripts/configure-haiku.ps1`: it prompts without echoing
the key, passes it through stdin, and binds it into the APEX credential API. It
writes no key file and leaves paid execution disabled. It reads the original lab's
ignored connection configuration. The generic adapter uses the credential static
ID configured by the owner.

## Network and TLS

A DBA must authorize HTTPS to `api.anthropic.com:443` in the execution context used
by APEX_WEB_SERVICE and Web Credentials. Preserve existing ACLs, use an exact host
and port, and do not grant wildcard outbound access. APEX-owned Web Credentials
normally use the APEX engine's network context; determine the exact installed
engine owner rather than copying a release-specific schema name. Do not alter an
unrelated database or its ACLs.

Use the existing trusted APEX wallet/TLS configuration. If certificate validation
fails, configure a trusted certificate chain; do not disable validation. Live
credential, ACL and wallet access remain unverified until an actual authorized
provider preflight succeeds. No wallet or ACL change is required by the offline
installer.

## Owner opt-in

The owner configures the provider row directly with a credential static ID,
requested model, reviewed input/output rates, a current pricing timestamp,
daily cap, maximum tokens and request frequency. `APXGEN_AI.VERIFY_MODEL` resolves
the model through the official Models API. Model verification and reviewed prices
must be fresh within one day before reservation.

Only then may an explicitly authorized GA_HAIKU run set its own budget enabled=1.
A suggested small experiment uses at most USD 1.00 total, one request every five
generations, input cap 2,048, output cap 256, one concurrent request and at most
20 attempts per run. These are safe starting limits, not permission to spend.
Automatic paid retries are zero; a failed/uncertain attempt does not retry itself.

Reservations are serialized under a provider budget lock and committed before
network I/O. No run or budget row lock is held during HTTP. Reconciliation records
returned token usage with the reservation's price snapshot. Unknown billing keeps
the full amount reserved and stops new requests. A reservation older than 120 seconds
is recovered as uncertain, with the stop flag retained. No automatic spending reset
occurs on exhaustion.

The Stop AI action prevents new requests. An already-sent request may still complete,
be billed, and have its approved output recorded; it cannot be forcibly unsent.
Stopping the evolutionary run prevents further offspring creation. The due/in-flight
generation gate prevents a scheduler from skipping an unfinished proposal.

`actual_usd` in the private ledger means cost computed from returned usage and the
reserved rates. Public output calls this a **usage-based cost estimate** and keeps
invoiceVerified=false unless separate billing evidence exists. Unsuccessful and
uncertain attempts remain separate. Never describe a computed estimate as a verified
provider invoice.

## Provider boundary

`APXGEN_AI` is the provider adapter boundary. Its public contract is model
verification, constrained proposal application and a bounded proposal request for
an evaluated parent. Any additional adapter must return the same mutation grammar,
reserve through APXGEN_BUDGET, preserve approved operations for replay and leave
fitness and selection to the engine. Only the Anthropic implementation ships;
Ollama and other endpoints are future adapters, not hidden required services.

The published offline suite contains no paid provider call. Mock invocations have
clearly labeled test runs and are excluded from published experimental results.
