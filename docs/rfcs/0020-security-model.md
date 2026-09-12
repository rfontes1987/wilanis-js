# RFC 0020: The security model: what is guaranteed, what is enforced, what is the application's

- **Status:** draft
- **Areas:** `area:process` (`docs/security-model.md`, `SECURITY.md`, two fitness functions under `fitness/`, a
  sentence in `CONTRIBUTING.md`), `area:runtime` (one sentence in `packages/runtime/templates/CLAUDE.md`; the
  README's *Reference: the model in one page* section points at the page). Nothing in the engine, the compiler
  or a plugin: this RFC adds no rule and changes no behaviour.
- **Schemas:** none
- **Packages:** none new
- **Tracking issue:** #22
- **Depends on:** none to write the page: every line in its first version is true of the code today. RFC 0007
  (I codes), RFC 0013 (the reach, the secrets refusal before `postLoad`), RFC 0016 (`permits`), RFC 0012, RFC 0011,
  RFC 0014, RFC 0015, RFC 0025 and RFC 0032 each add a line when they land, and this RFC says how. RFC 0019 for
  `docs/refusals/<CODE>.md`, the pages a code on this page links to; until it lands the codes are text.

## Summary

After this RFC the repository has one page, `docs/security-model.md`, that says in three lists what a tree that
passes `wilanis check` is guaranteed to be, what the runtime enforces on every run whether or not the tree was
checked, and what no part of wilanis decides and the application must. Every line under *Guaranteed* names the
refusal codes that make it true and the RFC that added it; a fitness function holds the page to the code, so a
line that cites a code the checker no longer makes is a failing test. The page opens with the one statement the
rest stands on, that a document never runs code, and closes with a fourth, short section naming what the model
does not address, so nobody assumes it does. `SECURITY.md` beside it says how a reader reports a line that is
false and what happens then: the code is fixed, the page is not softened. The page is published with 1.0
(`docs/roadmap.md`, M14) because it is the claim the version makes; it exists before that with the lines that are
true, and every RFC that lands a guarantee or an enforcement adds its line in the pull request that lands it.

## Motivation

The claims exist and are scattered. `README.md` says a JSON file cannot open a socket or read the disk
(`README.md:166-167`), that a trigger with no policies is public (`:223-224`), that `request.*` is legal in three
places and nowhere else (`:274`), that `from` is a package name and never a path (`:289-290`), that a graph may
never start a server (`:338-341`). The template's `CLAUDE.md` repeats four of them for an agent
(`packages/runtime/templates/CLAUDE.md:100-114`). Each plugin's README states its own: the guard identifies and
never authorises (`packages/plugin-auth/README.md:3-6`), files never pass through the engine
(`packages/plugin-http/README.md:22`), every `@blob` operation is an effect (`packages/plugin-blob/README.md:19`).
Eleven accepted RFCs each promise something more, and three of them -- RFC 0015 (`:603-604`), RFC 0025
(`:490-493`), RFC 0032 (`:33-34`) -- say in so many words that RFC 0020 is where the promise will be listed.

What is missing is not a claim but the difference between kinds of claim. "A domain graph reaches no effect" is
a proof: L002 refuses the tree, and a sabotage test proves L002 bites. "A secret is redacted from every report"
is a promise about running code, true of a tree the checker never saw, and true only as far as `secretPaths` in
`packages/compiler/src/lower.ts:76-92` follows a type. "The directory the guard trusts tells the truth" is
neither: it is the application's, and nothing in wilanis helps. A reviewer deciding whether to trust a tree an
agent wrote, an auditor, and a contributor deciding where a new check belongs each need the three kinds told
apart on one page, and today they would have to read the checker to learn which is which.

Two smaller things go wrong without the page. A code can be retired, or a rule weakened, without anyone noticing
that a sentence in the README stopped being true; nothing joins the sentence to the code. And there is no
`SECURITY.md`: a reader who finds a line false has an issue tracker (`packages/runtime/package.json:14`) and no
private channel, and no statement of what the project does when a guarantee breaks.

This RFC does not add a rule, a kind, a hook or a runtime check. It does not decide the supply-chain policy (how
a plugin package is vetted): the page names the supply chain as outside the model and `CONTRIBUTING.md` keeps the
policy. It does not write the pages per code; those are RFC 0019's. It does not publish 1.0; it is one of the
things 1.0 publishes.

## Guide-level explanation

**The words.** A *guarantee* is a property of every tree `wilanis check` accepts, made true by refusal codes and
proved by the sabotage tests behind them. An *enforcement* is a property of every run, made true by code in the
runtime, the engine or a plugin, and true of a tree that was never checked. *The application's* is a property
nothing in wilanis decides. *Outside the model* is what the page does not address at all.

**The page.** `docs/security-model.md`, five sections, one sentence per line, each line under the first two
ending with its codes in brackets and the RFC it came from:

```markdown
# The security model

What a tree can and cannot do, in four kinds of sentence. A line under *Guaranteed* is proved of every tree
`wilanis check` accepts, by the refusal codes it names; a line under *Enforced* is true of every run; a line under
*The application's* is nobody's but yours; *Outside the model* is what this page does not address. When a line
is false, read `SECURITY.md`.

## A document never runs code

A tree is JSON. No node evaluates a string, no template calls a function, no document names a file on disk.
A switch rule is `has`, `len`, comparison, `in` and boolean operators over paths (`packages/core/src/expr/ast.ts`);
a template `{{path}}` is a read; `plugins[].from` and `includes[].from` are npm package names. Adding any of
these is an RFC that edits this page first.

## Guaranteed by the checker

- Every reference resolves, and every document is a kind the schemas know, in the directory its kind lives in.
  [D001, D008, R001] (before the RFCs)
- A document's layer is read off its path, never inferred from what references it. [D008, L001] (before the RFCs)
- A domain graph reaches no effect and reads no request; a data graph reaches only the effects its feature
  allows. [L002, L003] (before the RFCs)
- A graph never starts something that outlives its run, and a startup step names a domain operation or a native
  operation marked `holds`. [L008, B006] (before the RFCs)
- A trigger never names a graph and never fires a native operation. [L006] (before the RFCs)
- The request is read in three places only: a trigger's `fire.in`, a policy's `decide.in`, a resolvers document.
  [L002, P001, P002, A001, B008] (before the RFCs)
- Every refusal a trigger can reach is mapped to an answer, and every mapped reason is reached. [T005, T006, A002,
  A003] (before the RFCs)
- A credential a policy needs is one the guard verifies, and a `required` resolver is proved by a policy.
  [A004, A005, A006] (before the RFCs)
- Settings read secrets and nothing else, and a secret is the name of a variable, never a value. [C001] (before the RFCs)
- Every declared profile is judged, and under each a port has one binding. [B002, B003, B004] (before the RFCs)
- A value written where the compiler writes it is refused. [L0nn, G0nn] (RFC 0032)
...

## Enforced by the runtime

- The guard verifies a credential before any graph runs, on every fire of a trigger that attaches a policy; the
  stubbed gates of `rehearse`, `fuzz` and `regress` never call it, so a rehearsal proves nothing about identity.
  (`Embedder.gate`, `packages/runtime/src/embed.ts`)
- A field marked `secret` is `«secret»` in every report, to a depth of six fields inside a type.
  (`packages/engine/src/redact.ts`, `secretPaths` in `packages/compiler/src/lower.ts`)
- A blob's bytes never enter the engine: a graph carries a handle, and a handle opens only what the store holds.
  (`packages/runtime/src/blobs.ts`)
- Nothing listens unless a startup step says so; a step that refuses stops the start with nothing serving.
  (`runStartup`, `packages/runtime/src/serve.ts`)
- `wilanis start` runs `wilanis check` first and refuses a tree that does not pass. (`packages/runtime/src/cli.ts`)
...

## The application's

- A business rule the checker cannot express. (An invariant of RFC 0007 is a guarantee once written; until
  written, the rule is yours.)
- The behaviour of the system a connection reaches, and which hosts, tables or buckets its settings name.
- The truth of a directory the guard trusts, and of the issuer an OIDC connection names.
- The logic of your policies: who may do what is decided by the graphs your policies fire.
- The values of your secrets and the environment that holds them.
...

## Outside the model

The packages `plugins[].from` and `includes[].from` name run in the process with everything the process has: a
compromised plugin is not a tree problem, and the model says only what a plugin may be *asked* to do. The Node
process, the host, the network between the listener and its clients, and the operator's shell are the
deployment's. `CONTRIBUTING.md` says how this repository's own packages are reviewed.
```

The ellipses stand for the lines *Reference* lists in full. Every line is one sentence a reader can check
against the code named beside it; no line is a hope.

**When a line is false.** `SECURITY.md` at the root of the repository, the file GitHub shows under *Security*:
report privately through the repository's *Report a vulnerability* form, never as a public issue; the maintainer
acknowledges the report; a line under *Guaranteed* or *Enforced* found false is a bug ahead of every other piece
of work, is fixed in code, ships as a patch release of every affected package, and the advisory quotes the line.
The page is never edited to match the bug. A line under *The application's* found wanting is not a
vulnerability; it is a request to move it up, which is an RFC.

**Who edits the page.** A line under *Guaranteed* or *Enforced* is added by the pull request that makes it true,
which is the implementing step the line's RFC names; it is removed or weakened only by an RFC, or by the
withdrawal of the RFC that added it. Wording that changes no meaning is an ordinary pull request. The fitness
function under *Tests* is what makes a stale line a failing build rather than a discovery.

**What an agent sees.** `packages/runtime/templates/CLAUDE.md` gains one sentence under its rules: "what a tree
can never do, and why a refusal is not a suggestion, is `docs/security-model.md` in the wilanis repository".
The README's *Reference: the model in one page* section, which states the claims in passing today, points at
the page as the statement in full and keeps its own sentences.

## Reference

### Documents and schemas

None. The page and `SECURITY.md` are markdown, not documents of a tree.

### Ports, operations and kinds granted

None.

### Checker rules

None. This RFC makes no rule; it lists the ones that exist.

The first version of *Guaranteed by the checker*, each line with the codes that make it true as they are emitted
today (`packages/core/src/{documents,validate,load,placement}.ts`, `packages/compiler/src/check/*.ts`,
`packages/plugin-http/src/rules.ts`, `packages/plugin-auth/src/rules.ts`):

| Line | Codes |
|---|---|
| every document is JSON of a kind the schemas know, once, in the directory its kind lives in | D000 D001 D002 D003 D004 D005 D008 |
| every reference resolves, and only to what its layer may see | R001 L005 |
| a document's layer is its directory; a type crosses a layer only where the layer allows | D008 L001 |
| a plugin or include is an npm package the project names; an include's plugins are the project's | D006 D009 D010 |
| a domain graph reaches no effect and reads no request; a data graph runs no domain operation | L002 |
| a data graph reaches only the effects its feature allows | L003 |
| a domain graph does more than forward; a binding lives inside a feature | L007 |
| a trigger and a policy fire a domain operation and never a native one; a graph never runs a `holds` operation | L006 L008 |
| a startup step names a domain operation or a native `holds` operation, with inputs it has and no request | B006 B007 B008 |
| every value fits the type declared for it, and every input is given, once, from something that exists | G003 G004 G005 G006 G013 B005 T002 T003 C002 T001 |
| a graph is acyclic and every node, constant and input is read | G001 G007 G008 G009 G010 G012 |
| a switch rule is a boolean expression over the node's inputs | G011 |
| the request is read in a trigger's `fire.in`, a policy's `decide.in` and a resolvers document only; a resolver is a read | P001 P002 P003 T004 A001 |
| every refusal a trigger can reach is mapped, and every mapped reason is reached; a challenge names its method | T005 T006 A002 A003 |
| a credential a policy asks for is one the guard verifies, and a trigger that attaches a policy gives the guard its credentials | A004 A005 |
| a `required` resolver is proved by a policy on every trigger that reads it | A006 |
| plugin and connection settings read `{{secrets.*}}` and nothing else, and conform to their kind | C001 C002 |
| every declared profile is judged; under each, every port has one binding and it implements that port | B001 B002 B003 B004 |
| a scenario names a trigger of the tree | S001 |
| a codec is what the http plugin's table names, a content type has a codec, a throttle lets something through | X001 X002 X003 |
| a session is written against the shape the guard declares, and a challenge names a declared method | X101 X102 X103 |

Lines added by accepted RFCs when their rules land, each in the pull request that lands the code:

| Line | Codes | RFC |
|---|---|---|
| a trigger that reaches an operation an access invariant covers attaches a policy that satisfies it | I001 I002 I003 | RFC 0007 |
| a field invariant a graph can decide statically is decided; a rule parses and types against its shape | I004 I005 I006 | RFC 0007 |
| a store's scope is fed from what the guard hands and never from what the caller could send | the codes of RFC 0015 | RFC 0015 |
| a document names each read it takes from the request | P004 P005 P006 | RFC 0029 |
| a profile names one default, a stand-in is a connection of the same kind, every secret is read, a step names declared profiles | C0nn B0nn | RFC 0013 |
| a profile with `permits` reaches exactly what it permits, and permits only effects and connections | C0nn | RFC 0016 |
| a field the compiler provides is never written by an author | L0nn G0nn | RFC 0032 |
| a `raw` storage operation, if ever granted, is legal in `data/` alone and counted apart | the codes of RFC 0002 | RFC 0002 |

### Runtime behaviour

None changes. The first version of *Enforced by the runtime*, each line with the code that makes it true:

| Line | Where |
|---|---|
| the guard verifies a credential before any graph runs, on every fire of a trigger that attaches a policy; a refusal ends the run as `identify` and no policy and no graph runs | `Embedder.gate`, `packages/runtime/src/embed.ts:174-192`; `guard` in `packages/core/src/plugin.ts:161-179` |
| the stubbed gates never call the guard: `rehearse`, `fuzz` and `regress` prove nothing about identity | `embed.ts:80-81, 171, 179` |
| what the guard learned reaches a graph as `request.principal`, `request.session`, `request.challenge` and by no other path; no graph sees a raw credential | `embed.ts:185`; `packages/plugin-auth/src/guard.ts:148-165` |
| a field marked `secret` is `«secret»` in every report's `in` and `out`, to a depth of six fields inside a type | `packages/engine/src/redact.ts`; `secretPaths`, `packages/compiler/src/lower.ts:76-92`; `run.ts:212-244` |
| a `{{secrets.*}}` read is substituted into plugin and connection settings only, and the variable's value reaches no report | `Secrets`, `packages/compiler/src/env.ts:10-52` |
| a blob's bytes live once, in the store; a graph carries a handle; a handle opens only what the store holds, and nothing reads a blob whole | `packages/runtime/src/blobs.ts:22, 58-61`; `fitness/a-blob-is-never-read-whole.fitness.ts` |
| nothing listens unless a startup step says so; a `required` step that refuses stops the start with nothing serving | `runStartup`, `packages/runtime/src/serve.ts:45-68` |
| `wilanis start` runs `check` first and refuses a tree that does not pass | `packages/runtime/src/cli.ts:72-81, 119-121` |
| a plugin is loaded from the project's own `node_modules` by package name; an include is a package name | `packages/runtime/src/project.ts:31-47, 102-117` |

Lines added by accepted RFCs when they land:

| Line | RFC |
|---|---|
| a run has a deadline, a fan-out ceiling and a body size; a cancelled run answers the kind's fault and never a partial answer; a cancellation cannot undo an effect that ran | RFC 0012 |
| a retry repeats an idempotent site only and never repeats a declared refusal | RFC 0011 |
| a caller is told the outcome's word and the run's id, never what broke | RFC 0014 |
| a missing variable the profile's reach needs stops the start before any plugin's `postLoad` | RFC 0013 |
| a model's answer is validated against the declared shape before any node reads it; nothing runs what a model wrote | RFC 0025 |
| a run's trace carries the site of every node and never a secret | RFC 0006, RFC 0032 |
| state lives where the profile binds it; a refresh token is compared by its hash | RFC 0005 |

The first version of *The application's*: a business rule the checker cannot express, until it is written as an
invariant (RFC 0007); the behaviour of the system a connection reaches, and the hosts, tables or buckets its
settings name (RFC 0016 says why these are the connection's); the truth of a directory the guard trusts and of
the issuer an OIDC connection names; the logic of the policies: who may do what is what their graphs decide;
the values of the secrets and the environment that holds them; the contents of a `raw` storage operation, if RFC
0002 ever grants one; what is sent to a model and what is done with its answer (RFC 0025); whether a credential
belongs in a queue message's body (RFC 0009's question, answered here as: no, a worker's trigger gives the guard
its credentials like any other, and a body is data).

*Outside the model*: the code of the packages `plugins[].from` and `includes[].from` name, which run in the
process with all it has; the Node process and the host; the network between the listener and its clients (TLS
is the load balancer's or the listener's settings, not the tree's); the operator's shell and what it exports;
this repository's own supply chain, whose review is `CONTRIBUTING.md`'s to describe.

### Discoverability

- `docs/security-model.md` is the page. `README.md`'s *Reference: the model in one page* links it in one sentence; `CONTRIBUTING.md`
  says a new check goes where the page says its kind lives, and that a change to the page follows the rule under
  *Who edits the page*.
- `SECURITY.md` at the repository root; GitHub's *Security* tab shows it. Private vulnerability reporting is
  enabled on the repository (a setting, recorded here).
- Each code on the page is a link to `docs/refusals/<CODE>.md` once RFC 0019 lands; until then, text.
- `packages/runtime/templates/CLAUDE.md`: one sentence pointing an agent at the page.
- `wilanis describe`, `wilanis map`, `wilanis ls` and the viewer: unchanged.

### Plugin contract

None.

## Compatibility

None: no schema, no behaviour. Every later RFC that adds a guarantee or an enforcement adds its line under the
heading it belongs to, in the pull request that lands the code, and names that pull request in its
Implementation plan. A withdrawn RFC removes its line in the pull request that withdraws it.

## Tests

Two fitness functions, one decision each (RFC 0027; `fitness/README.md`):

- **`fitness/the-security-model-cites-live-codes.fitness.ts`.** Claim: *every refusal code the security model
  cites is one the checker or a plugin makes, and every line under Guaranteed cites at least one*. `gather` reads
  `docs/security-model.md` and the codes emitted from the sources, as `every-refusal-code-is-proved-by-a-sabotage`
  gathers them today. `judge`: a cited code nobody makes is a violation naming the line and saying *the rule is
  gone: remove the line or say which code holds it now*; a line under *Guaranteed* with no code is a violation
  saying *a guarantee names the code that proves it*. Sabotage: a page citing `L099`; a line with no bracket.
- **`fitness/a-document-never-runs-code.fitness.ts`.** Claim: *no source under `packages/*/src` evaluates a
  string or loads a module from a path a document could supply*. `gather` reads every source file. `judge`: `eval(`,
  `new Function(`, `vm.`, and a dynamic `import(` or `require(` whose argument is not a string literal or a
  package name resolved through `createRequire`, outside `packages/runtime/src/project.ts` (the plugin and
  include loader, whose argument is `PACKAGE_NAME`-checked), is a violation naming the file and saying *a
  document never runs code; if this is deliberate, RFC 0020's page changes first*. Sabotage: a source with
  `eval('1')`; a `require(doc.path)`.

The page itself is checked by reading, as RFC 0001 is. The fitness functions carry the maintainer's `Decision:`
line as every file under `fitness/` does.

## Implementation plan

1. `docs/security-model.md` with the first version of the five sections, from the tables above; `SECURITY.md`;
   the README and `CONTRIBUTING.md` sentences; private vulnerability reporting enabled. (`area:process`)
2. The two fitness functions, with their sabotage cases and the `Decision:` lines. (`area:process`)
3. The template sentence in `packages/runtime/templates/CLAUDE.md`. (`area:runtime`; `good first issue`)
4. Each accepted RFC in the tables above gains one line in its Implementation plan: "add the line to
   `docs/security-model.md`", on the step that lands the rule. A docs-only pull request. (`area:process`;
   `good first issue`)

Steps 1 to 3 in any order; step 4 after 1.

## Drawbacks and alternatives

- **A published model is a promise a bug can break.** That is what `SECURITY.md` is for, and why the page is
  never edited to match the bug. The alternative, keeping the claims in the README where they cannot be false
  in a way anyone checks, is where they are now.
- **The page is long, and one sentence per line makes it longer.** A shorter page would group codes into
  families; a reader deciding where a check belongs would then read the family, not the sentence. The lines are
  the point; the fitness function is what keeps them from rotting.
- **Codes on every line double the page as an index of codes**, which RFC 0019's `docs/refusals/README.md` is
  already. The two lists answer different questions: RFC 0019's says what each code refuses; this page says what
  the codes together make true. A code appears on several lines here and once there.
- **A fourth section naming what is not addressed** can read as a list of holes. It is: a reader who is not
  told the supply chain is outside the model will assume `permits` covers a hostile plugin, and it does not.
  Naming it costs a paragraph; the policy for this repository's own packages stays in `CONTRIBUTING.md`, so the
  page states a boundary and not a procedure.
- **Redaction to a fixed depth is a line on the page rather than a fix.** `secretPaths` stops at six nested
  fields; a `secret` field deeper than that in a type is not marked, and a report would print it. Stating the
  bound is honest; lifting it is a small change to `lower.ts`. *Open questions* asks which.
- **No hook guards the page.** RFC 0027's `.githooks/commit-msg` refuses a commit that changes a fitness file
  without a `Decision:` line; extending it to a removed line under *Guaranteed* or *Enforced* was considered and
  set aside: the page is one file every reviewer of a pull request reads, the fitness function catches the case
  that matters most (a code gone), and one more hook is machinery the process does not yet need.
- **The one statement is a fitness function, not a checker rule.** "A document never runs code" is a property of
  the TypeScript, not of a tree, so the checker cannot judge it; a fitness function is the repository's way of
  holding a decision about the code.

## Open questions

Before `accepted`:

- **Whether the page names threats it does not address as a fourth section**, or leaves the supply chain to
  `CONTRIBUTING.md` alone. This RFC recommends the section, one paragraph, as shown: a boundary stated, a
  procedure left to `CONTRIBUTING.md`.
- **Whether each guaranteed line cites its codes in the text.** This RFC recommends yes, held by the fitness
  function; the alternative leaves the join between sentence and code in a reader's head.
- **Who may change the page.** This RFC recommends: a line is added by the pull request that makes it true,
  removed or weakened by an RFC alone, wording by an ordinary pull request, and no hook beyond the fitness
  function.
- **Whether the redaction depth is stated or lifted before the page is published.** This RFC recommends stating
  it in the first version, as the table does, and lifting it in a task of RFC 0006 or a fix if the bound has no
  reason a comment explains; the line then loses its clause.
- **Whether `SECURITY.md` states a response time.** This RFC recommends no number: one maintainer, and a promise
  of days that cannot be kept is worse than "acknowledged, then fixed ahead of every other piece of work".

During implementation:

- The exact wording of each line, and whether the first version groups the G codes into two lines or one.
- Whether the codes link to `docs/refusals/<CODE>.md` by relative path or by the URL RFC 0019 prints.
