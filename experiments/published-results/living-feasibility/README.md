# First real APEX application feasibility run

On October 22, 2026, Oracle created and selected bounded Order Lab application
genomes while SQLcl and actual browser interactions verified two materialized
APEX applications. This is a feasibility result, not a search-algorithm comparison.

The preregistered [protocol](../../configurations/application-feasibility-v1.json)
uses seed 50000, one challenger, two materializations, three fixed tasks and zero
paid requests. Parent application 133 places filters above the report. Oracle's
mutation placed them beside the report in descendant application 130. Both passed
the fixed tasks and hard gates. Both scored **89.675** under the independently
versioned Oracle task proxy. The strict-improvement rule retained the parent.

| Task | Actions, both candidates | Navigations, both candidates |
| --- | ---: | ---: |
| Locate delayed order 1002 | 3 | 1 |
| Filter DELAYED orders | 3 | 1 |
| Update order 1002 to SHIPPED | 6 | 3 |

The [public replay](https://b2dev.tech/genesis/living) shows genuine browser
captures and recorded task evidence. The immutable package's root SHA256 is
`80f6c970568ee4683afe3d48b2dcf8af1066b752ff642d4ebd9242cfe5c659ac`.
Every referenced file has an independent byte count and SHA256. The website pins
the root hash, so a changed manifest or screenshot prevents display.

[summary.json](summary.json) retains the actual source fingerprints, original
compiler definition hashes, Oracle decisions and task metrics. The public source
bundle is sanitized and hashes its own index; its hash is distinct from the
original multi-file compiler definition hash. Private credentials, runtime URLs,
sessions, import logs and full database snapshots remain excluded. Hashes support
artifact integrity; they do not replace an independent Oracle reproduction.

Three earlier runs remain recorded as failures. One stopped after import because
a locking fixture function was called through SELECT. The next failed mobile
accessible-name and focus gates. Another failed focus observation during a native
CSS transition. Repairs produced new source fingerprints and new runs; the prior
results were not rescored. The [verification record](../../../docs/testing/living-applications-progress.md)
documents these attempts and the safely archived reuse of application 130.

These automated measurements establish neither human usability nor aesthetic
superiority. They establish that a PL/SQL-generated structural descendant can
compile, import, authenticate, execute the fixed tasks and receive an independent
Oracle selection decision. Multiple generations, paired seeds and explicitly
authorized AI proposals remain future experimental work.
