# Maintenance, upgrade and removal

Back up and export runs before upgrades. DDL and APEX imports can partially commit;
no atomic rollback is promised. Stop workers and pause/stop active runs before
changing packages. Preserve original source commits and evaluation contexts.

This first alpha has a clean-install script, not a repeatable upgrade. Never rerun
install.sql over populated objects. For an engine 1.0.0 development checkout,
inspect/apply only missing numbered migrations, then replace packages in installer
dependency order. Check USER_ERRORS and run verification before restarting.
Renderer/fitness changes need a new context and a new run or checkpoint duplicate.

Portable APEXlang accepts destination context. The SQL export also supports public
APEX_APPLICATION_INSTALL overrides before importing the unmodified artifact:

```sql
begin
  apex_application_install.set_workspace_id(:destination_workspace_id);
  apex_application_install.set_schema(:destination_schema);
  apex_application_install.set_application_id(:unused_destination_application_id);
  apex_application_install.generate_offset;
end;
/
@f120.sql
```

Bind values in your SQL client. Source app 120 and APXGEN_LAB are export metadata,
not destination prerequisites. Reimporting a selected ID replaces that definition;
use only your Genesis application. Do not edit Oracle's generated export.

To uninstall, export what you need, remove **only your Genesis application** through
APEX administration, and run installer/uninstall.sql as the dedicated owner after
reading it. It requires an explicit prompt phrase, stops only APXGEN_* jobs and
drops only APXGEN_* schema objects. It does not drop users, workspaces or other apps.
No uninstall was performed on the publication lab.

## Troubleshooting

- Compilation: inspect USER_ERRORS, direct DBMS_CRYPTO grant, APEX installation and
  dependency order. Process exit alone does not establish success.
- SQLcl grammar/OCI error: use tested SQLcl 26.3 thin mode.
- Denied/empty APEX data: verify authentication and APXGEN_PRINCIPALS role.
- Pending generation: start the browser worker; the scheduler cannot measure layouts.
- Expired claim: acquire a new lease instead of reusing its token.
- Changed context: restore the original environment or create a new experiment.
- Replay integrity failure: restore the complete export; do not bypass checks.
  HTTPS or localhost is required for Web Crypto.
- Provider failure: stop AI and continue genetic evolution. Review credential,
  ACL/TLS and fresh pricing. Never clear uncertainty to silently resume spending.
