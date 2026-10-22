# Offline APEXlang capability prototypes

These isolated applications establish compiler support for native interactive reports, modal editing, and clean top navigation. They have **not been imported or runtime tested**. The production builder and the successful feasibility template are unchanged.

The `snapshots/feasibility-v1` directory preserves the successful baseline application, its original template, compiler evidence, and the existing 16-variant compiler matrix. The baseline definition hash remains `a3fcadef1911fd2c00aeff8109b2a924a5ae533640b56a7cb5a18aebe415bfae`.

## Verified compiler results

Every case has its complete application source and raw compiler output. `index.json` records successful and rejected attempts. All results used SQLcl **26.3.0.0**, build **26.3.0.260.1620**, with MMD **26.2.0+3479**, offline `/nolog` validation.

| Final case | Supported source | Compiler result |
| --- | --- | --- |
| `top-navigation-v1` | Native top navigation with matching template options | Success, zero warnings |
| `interactive-report-v3` | Native interactive report, typed columns, primary saved report, four displayed columns | Success, zero warnings |
| `modal-edit-v4` | Native modal page, fixed status update, native close process, native cancel action | Success, zero warnings |
| `combined-v2` | All three additions in the same application | Success, zero warnings |

Launcher SHA256: `1a0fe799c0f0cf17f7f5767e49b6250f903ac6d7c69b6c70ef966e518684fc07`.

Compiler JAR SHA256: `8be7e04267ea5744e1fce51f4f5e7dd88f101eb5cd21025a5d66239ac362b7b0`.

## Exact supported fragments

The complete source in each final case is authoritative. The interactive report in [`interactive-report-v3/application/pages/p00001-orders.apx`](interactive-report-v3/application/pages/p00001-orders.apx) uses `type: interactiveReport`, preserves the fixed safe-view query and checksum URL generation, and supplies a `source.dataType` on every report column. Numeric columns use `number`; customer, status, and the hidden edit URL use `varchar2`. The hidden URL column also requires a heading.

The primary saved report is nested directly inside the region. Its identifier supplies the saved-report identity, and each displayed-column identifier supplies the column name:

```apx
savedReport primary-orders (
    visibility: primaryDefault
    view {
        default: report
        rowsPerPage: 50
        chart: false
        groupBy: false
        pivot: false
    }
    displayColumn ORDER_ID (
        sequence: 10
    )
)
```

The modal page in [`modal-edit-v4/application/pages/p00002-edit-order.apx`](modal-edit-v4/application/pages/p00002-edit-order.apx) sets `appearance.pageMode: modalDialog` and `appearance.dialogTemplate: @/modal-dialog`. Its content region uses `layout.slot: contentBody`. A native `closeDialog` process runs at `processing`, sequence 20, after the existing fixed status update at sequence 10; `serverSideCondition.whenButtonPressed: @save-order` scopes it to Save status. The Cancel button uses `definedByDynamicAction`, with a nested native `cancelDialog` action and `fireOnInit: false`.

The top-navigation case changes both the application list template and theme navigation position, then uses only `#DEFAULT#` for that list's template options. The preserved matrix's eight top-navigation cases contain three compiler **warnings** each: inherited side-navigation options `js-defaultCollapsed`, `js-navCollapsed--hidden`, and `t-TreeNav--styleA` are invalid for the top-navigation list. Every preserved output hash matches, every case ends in validation success, and none contains compile errors. The existing side-navigation cases have zero warnings.

## Rejected attempts and documentation differences

`interactive-report-v1` omits required column data types and the hidden URL heading. `interactive-report-v2` adds those fields but writes `savedReport.staticId` and `displayColumn.identification.column`; the installed compiler rejects those explicit identity properties. Version 3 uses component identifiers instead.

`modal-edit-v1` compiles with an invalid `body` slot warning. Version 2 uses `contentBody` and adds the native close process. Version 3 adds native cancellation but explicitly supplies `action.execution.event`; the compiler rejects this property on the nested action. Version 4 lets the enclosing dynamic action supply that relationship. `combined-v1` preserves the same rejected explicit-event attempt; version 2 compiles cleanly.

These findings were checked against Oracle's [APEXlang component reference](https://docs.oracle.com/en/database/oracle/apex/26.2/apxln/index.html), [generated EBNF](https://docs.oracle.com/en/database/oracle/apex/26.2/apxln/apexlang.ebnf), and [SQLcl APEXlang command documentation](https://docs.oracle.com/en/database/oracle/sql-developer-command-line/26.2/sqcug/apexlang.html). Actual compiler output determines acceptance for this installed version.

## Recheck

Run the artifact checks without a database or SQLcl installation:

```powershell
node --test apex/order-lab/prototypes/evidence.test.mjs
```

To compile a final case again, use a fresh evidence directory with the existing validator, or invoke SQLcl offline with:

```text
apex validate -input "<absolute path to a prototype application directory>"
exit
```

Compilation establishes source acceptance. Modal opening, iframe task evaluation, dialog close/cancel behavior, report rendering, accessibility, and database isolation still require genuine runtime measurements before these mappings can enter the materializer.
