# RFCs

Every RFC, one file per item; the roadmap they serve is [`../roadmap.md`](../roadmap.md). RFC 0001 says how this works; `0000-template.md` is what an
RFC is made of. A *stub* holds a roadmap slot and the direction taken, and is expanded before it can be
accepted. Statuses: draft, accepted, implemented, withdrawn.

| RFC | Title | Status |
|---|---|---|
| [0001](0001-the-rfc-process.md) | The RFC process | accepted |
| [0002](0002-storage-plugin.md) | The `@storage` plugin: records of a shape behind a generic port | accepted |
| [0003](0003-storage-known-to-the-compiler.md) | Storage declarations the compiler judges | accepted |
| [0004](0004-atomic-graphs.md) | Atomic graphs: transactions as a property of a data graph | accepted |
| [0005](0005-externalized-state.md) | Externalized state: every store behind a port the project binds | accepted |
| [0006](0006-run-reports-as-traces.md) | Observability: the run report as a trace | accepted |
| [0007](0007-invariants.md) | Invariants: what must hold, declared once and judged by the checker | accepted |
| [0008](0008-ir-versioning.md) | Versioning the intermediate representation | accepted |
| [0009](0009-queue-triggers-and-workers.md) | Queue messages as triggers, and workers | accepted |
| [0010](0010-scheduled-triggers.md) | Scheduled triggers | accepted |
| [0011](0011-effect-semantics-retry-idempotency-timeout.md) | Retry, idempotency and timeout as declared properties of an operation | accepted |
| [0012](0012-limits-and-cancellation.md) | Resource limits, timeouts and cancellation of a run | accepted |
| [0013](0013-deployment-and-profiles.md) | A deployment model: profiles, environments and what a tree needs to run | stub |
| [0014](0014-outcome-semantics.md) | Outcome semantics: refusals, failures and faults, end to end | draft |
| [0015](0015-tenant-and-resource-scoping.md) | Tenant and resource scoping as a provenance rule | draft |
| [0016](0016-capability-aware-compilation.md) | Capability-aware compilation: what a tree requires against what an environment permits | stub |
| [0017](0017-migration-planner.md) | Migrations derived from store declarations | draft |
| [0018](0018-scenario-generation.md) | Scenario generation from the branch solver | draft |
| [0019](0019-diagnostics-for-repair-loops.md) | Diagnostics designed for an agent's repair loop | draft |
| [0020](0020-security-model.md) | The security model: what is guaranteed, what is enforced, what is the application's | stub |
| [0021](0021-higher-level-constructs.md) | Higher-level constructs: state machines and resources | draft |
| [0022](0022-storage-engines.md) | More storage engines: SQLite, MySQL, and declared capabilities | draft |
| [0023](0023-adapters.md) | Adapters: search, cache, email, payment | stub |
| [0024](0024-cloud-deployment.md) | Kubernetes deployment: a Helm chart and a local cluster | stub |
| [0025](0025-ai-provider-integrations.md) | AI model calls as an effect | stub |
| [0026](0026-application-manifest.md) | The application manifest | stub |
| [0027](0027-fitness-functions.md) | Fitness functions: decisions about the code, held by the tests that record them | implemented |
| [0028](0028-principles-hold.md) | The principles hold: four sentences of `CLAUDE.md` that nothing held, and the two claims not to write | implemented |

Which milestone first shows an RFC is said once, in [`../roadmap.md`](../roadmap.md); the tracking issue
carries it as GitHub's milestone. Where this list and the outside assessment that seeded it differ, the
list won: observability moved up, outcome semantics moved down since most of it exists, and higher-level
constructs are challenged in their own stub.
