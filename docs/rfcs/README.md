# RFCs

The roadmap of wilanis, one file per item. RFC 0001 says how this works; `0000-template.md` is what an
RFC is made of. A *stub* holds a roadmap slot and the direction taken, and is expanded before it can be
accepted. Statuses: draft, accepted, implemented, withdrawn.

| RFC | Title | Status | Milestone |
|---|---|---|---|
| [0001](0001-the-rfc-process.md) | The RFC process | draft | none |
| [0002](0002-storage-plugin.md) | The `@storage` plugin: records of a shape behind a generic port | draft | A credible backend |
| [0003](0003-storage-known-to-the-compiler.md) | Storage declarations the compiler judges | draft | A credible backend |
| [0004](0004-atomic-graphs.md) | Atomic graphs: transactions as a property of a data graph | draft | A credible backend |
| [0005](0005-externalized-state.md) | Externalized state: every store behind a port the project binds | draft | A credible backend |
| [0006](0006-run-reports-as-traces.md) | Observability: the run report as a trace | draft | A credible backend |
| [0007](0007-invariants.md) | Invariants: what must hold, declared once and judged by the checker | draft | A credible backend |
| [0008](0008-ir-versioning.md) | Versioning the intermediate representation | draft | 1.0: published |
| [0009](0009-queue-triggers-and-workers.md) | Queue messages as triggers, and workers | stub | Production grade |
| [0010](0010-scheduled-triggers.md) | Scheduled triggers | stub | Production grade |
| [0011](0011-effect-semantics-retry-idempotency-timeout.md) | Retry, idempotency and timeout as declared properties of an operation | stub | Production grade |
| [0012](0012-limits-and-cancellation.md) | Resource limits, timeouts and cancellation of a run | stub | Production grade |
| [0013](0013-deployment-and-profiles.md) | A deployment model: profiles, environments and what a tree needs to run | stub | Production grade |
| [0014](0014-outcome-semantics.md) | Outcome semantics: refusals, failures and faults, end to end | stub | Production grade |
| [0015](0015-tenant-and-resource-scoping.md) | Tenant and resource scoping as a provenance rule | stub | The AI advantage |
| [0016](0016-capability-aware-compilation.md) | Capability-aware compilation: what a tree requires against what an environment permits | stub | The AI advantage |
| [0017](0017-migration-planner.md) | Migrations derived from store declarations | stub | The AI advantage |
| [0018](0018-scenario-generation.md) | Scenario generation from the branch solver | stub | The AI advantage |
| [0019](0019-diagnostics-for-repair-loops.md) | Diagnostics designed for an agent's repair loop | stub | The AI advantage |
| [0020](0020-security-model.md) | The security model: what is guaranteed, what is enforced, what is the application's | stub | 1.0: published |
| [0021](0021-higher-level-constructs.md) | Higher-level constructs: state machines and resources | stub | Ecosystem |
| [0022](0022-storage-engines.md) | More storage engines: SQLite, MySQL, and declared capabilities | stub | Ecosystem |
| [0023](0023-adapters.md) | Adapters: search, cache, email, payment | stub | Ecosystem |
| [0024](0024-cloud-deployment.md) | Cloud deployment integrations | stub | Ecosystem |
| [0025](0025-ai-provider-integrations.md) | AI model calls as an effect | stub | Ecosystem |
| [0026](0026-application-manifest.md) | The application manifest | stub | The AI advantage |

The order of the milestones is the order of the work: *A credible backend* (storage, atomic graphs,
externalized state, traces, invariants), *1.0: published* (freeze IR v1, publish, the security model),
*Production grade*, *The AI advantage*, *Ecosystem*. Where this table and the ChatGPT assessment that
seeded it differ, the table won: observability moved up to the first milestone, outcome semantics
moved down since most of it exists, and higher-level constructs are challenged in their own stub.
