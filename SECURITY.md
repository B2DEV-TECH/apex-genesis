# Security

Do not put credentials, private application exports or internal paths into public
issues. Use GitHub private vulnerability reporting when available; otherwise contact
the maintainer through B2DEV TECH before publishing sensitive details. No response
time guarantee is offered for this alpha.

Only the current alpha is maintained. Install into a dedicated development schema
and workspace with synthetic data. The database owner and measurement worker are
trusted. Public replay is a separate read-only static export.

See the [threat model](docs/security/threat-model.md), [AI setup](docs/installation/haiku.md)
and [release limitations](docs/releases/v0.1.0-alpha.1.md). No provider key belongs
in browser storage, Git, dataset files, screenshots or logs.
