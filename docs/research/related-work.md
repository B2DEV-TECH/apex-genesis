# Related work and contribution

Reviewed 2026-10-20 before the recorded protocol. These established ideas are
background, not inventions of APEX Genesis.

| Area | Primary reference | Relationship |
| --- | --- | --- |
| Genetic algorithms | [Holland, Adaptation in Natural and Artificial Systems](https://mitpress.mit.edu/9780262581110/adaptation-in-natural-and-artificial-systems/) | Selection, recombination and mutation are established search techniques. |
| Genetic programming | [Koza, Genetic Programming](https://mitpress.mit.edu/9780262111706/genetic-programming/) | Genesis evolves a bounded parameter grammar, not executable programs. |
| Interactive evolution | [Takagi, 2001 survey](https://ieeexplore.ieee.org/iel5/5/20546/949485/949485.plain.html) | Human evaluation can guide evolution; Genesis primary fitness stays technical. |
| Adaptive UI generation | [Gajos, Wobbrock and Weld, SUPPLE, UIST 2007](https://homes.cs.washington.edu/~weld/papers/kgajos-uist07.pdf) | Optimization-based UI generation predates this experiment. |
| Multiple objectives | [Deb et al., NSGA-II](https://ieeexplore.ieee.org/document/996017) | Pareto selection is future work; this alpha uses hard gates and a weighted sum. |
| Neuroevolution | [Stanley and Miikkulainen, NEAT](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf) | Background only; Genesis does not train neural networks. |
| LLM-assisted search | [Romera-Paredes et al., FunSearch, Nature](https://www.nature.com/articles/s41586-023-06924-6) | Model proposals and independent evaluation are established in other domains. |
| Declarative APEX | [Oracle APEXlang](https://docs.oracle.com/en/database/oracle/sql-developer-command-line/26.1/sqcug/apexlang.html) | Authors the native admin app; organisms do not rewrite application SQL. |

SQL/PL/SQL evolutionary algorithms and database optimization are not claimed as
new. The focused review did not establish an exhaustive catalogue of earlier
PL/SQL implementations. Absence from this review is not proof of novelty.

The specific contribution is an inspectable combination: Oracle owns evolution and
the spending boundary; one constrained renderer connects browser measurement, native
APEX inspection and a static public museum; exported lineage and approved mutations
make recorded replay independent of model access. No world-first claim is made.

Official references: [Oracle Web Credentials](https://docs.oracle.com/en/database/oracle/apex/26.2/htmdb/understanding-web-credentials.html),
[Anthropic models](https://platform.claude.com/docs/en/models/overview),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Messages](https://platform.claude.com/docs/en/api/messages/create).
Runtime lookup and fresh reviewed prices remain required before paid calls.
