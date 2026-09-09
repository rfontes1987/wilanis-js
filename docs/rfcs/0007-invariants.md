# RFC 0007: Invariants: what must hold, declared once and judged by the checker

- **Status:** draft
- **Milestone:** A credible backend
- **Areas:** `area:core`, `area:compiler`, `area:runtime`, `area:view`
- **Tracking issue:** #9
- **Depends on:** none for access invariants (class 1); RFC 0002 (storage) for the examples of field
  invariants (class 2) over stored records, though class 2 itself needs only shapes and graphs; RFC 0002
  and RFC 0021 (higher-level constructs) for transition invariants (class 3), which this RFC names and
  defers

## Summary

A tree can state a rule that must hold everywhere, in one document, and the checker holds every document
to it. Today the checker answers structural questions: does the reference exist, does the type fit, is
the reason mapped. An `invariant` document asks a behavioural one: is every write to this port gated by
a signed-in recorder, is a URL ever empty. The checker proves what it can at compile time and refuses
with an `I` code where the tree contradicts the invariant. Where a value cannot be judged before it
exists, the compiler lowers a guard the author never writes, and `rehearse` reports which invariants
were proved and which are guarded at run time. Nothing is added to the engine: a guard is a `switch`
and a `refuse` node the compiler synthesises.

## Motivation

The example gates every write of the monitor feature with `@access/edge/can-record.policy.json`. It
does so trigger by trigger: six triggers each attach `employees-only` and `can-record`. Nothing in the
tree says that this is a rule rather than six coincidences. An agent adding `PATCH /monitor/{id}/method`
that fires `monitor.port.json#update` and forgets the policies produces a tree `wilanis check` accepts.
The write is public, and the only thing that would catch it is a human reading the trigger.

The same holds for the values the domain trusts. `Entry.shape.json` says `url` is a string. It cannot
say the string is never empty. A data graph translating a row from the upstream API can hand the domain
an entry with `"url": ""`, and every graph downstream believes it.

Both mistakes are of one kind: a rule the author holds in their head and the tree cannot state. An
`invariant` document states it. The checker then has two jobs it did not have: to find every place the
rule applies (every trigger that reaches the port, every node that makes the shape), and to decide
whether the rule is met there. Where the answer is known from the documents alone, a violation is a
refusal at check time. Where it depends on a value that arrives at run time, the compiler guards the
place and the rehearsal reports the guard. The strategic goal is the one from the architecture review:
move correctness from run-time testing toward compile-time verification wherever possible, and be honest
about where it is not possible.

This RFC does not try to make invariants over state (an order cannot become paid without a payment
result). Those need old and new values of a stored record, which the tree cannot name before RFC 0002,
and a construct for a record's lifecycle, which is RFC 0021. Section "Class 3" says what they will look
like and stops there.

## Guide-level explanation

An **invariant** is a document in a feature's `domain/`, `*.invariant.json`, because it is a rule of the
business, not of the world. It comes in two forms, and a document is exactly one of them.

**An access invariant** names domain port operations and says what must gate every way in that reaches
them. It never names a role: a role is what a policy's graph decides. The invariant says the gate stands;
the policy says what it decides.

```json
{
  "$schema": "@wilanis/invariant.schema.json",
  "label": "Writes are for recorders",
  "description": "Every trigger that can change an entry attaches the recorder policy. Reads stay public.",
  "access": {
    "over": [
      "@monitor/domain/monitor.port.json#record",
      "@monitor/domain/monitor.port.json#update",
      "@monitor/domain/monitor.port.json#remove",
      "@monitor/domain/monitor.port.json#removeMany",
      "@monitor/domain/monitor.port.json#submit",
      "@monitor/domain/monitor.port.json#import"
    ],
    "requires": {
      "policy": "@access/edge/can-record.policy.json"
    }
  }
}
```

"Reaches" is transitive. `POST /monitor/import` fires `#import`, whose domain graph calls `#record` for
every row; the trigger therefore reaches `#record`, and the invariant holds it to the same gate. A
domain graph cannot route around an invariant by calling the operation itself.

`requires` may instead name what must be proved rather than which policy proves it:

```json
"requires": { "proves": ["request.principal"] }
```

Every trigger reaching the operations then attaches some policy whose `proves` lists `request.principal`
or a path above it, the same rule A006 applies to a required resolver. `signed-in`, `employees-only`
and `can-record` all qualify; a public trigger does not.

Drop `can-record` from `delete-entry.trigger.json` and `wilanis check` answers:

```
I001  @features/monitor/edge/delete-entry.trigger.json#policies
    trigger reaches @monitor/domain/monitor.port.json#remove, which 'Writes are for recorders'
    (@monitor/domain/writes-are-for-recorders.invariant.json) gates with @access/edge/can-record.policy.json,
    but attaches no such policy
    → attach "@access/edge/can-record.policy.json" under policies, or take #remove out of the invariant's over
```

**A field invariant** names a core shape and a rule over its fields, in the grammar a `switch` rule
already uses: `has()`, `len()`, comparisons, `in`, `&&`, `||`, `!`. The fields are the roots.

```json
{
  "$schema": "@wilanis/invariant.schema.json",
  "label": "An entry names a call",
  "description": "A URL is never empty, and a deletion always says who asked for it.",
  "holds": {
    "on": "@monitor/domain/Entry.shape.json",
    "when": "len(url) > 0 && (method != 'DELETE' || has(ua))"
  }
}
```

Where a value of `Entry` comes into being, the rule is judged:

- If every value the rule reads is a literal at that node, the checker evaluates the rule. True is
  proved; false is a refusal, I005, at check time.
- If a `switch` that routes to the node already established the rule (its `when` says `len(url) > 0`
  about the same value), the node is proved by narrowing, the way `has()` narrows a read today.
- Otherwise the compiler lowers a **guard** at the node: a `switch` on the rule, routing to the value
  when it holds and to a `refuse` with reason `invariant` when it does not. The author writes nothing;
  the trigger maps the reason the way it maps every other (T005), and the viewer shows the guard.

`wilanis rehearse` then reports a guard as it reports a decision:

```
features/monitor/data/create-row  guard 'row' An entry names a call  2/2 branches
  ok  holds     answered from 'row'
  ok  violated  refused on purpose at 'row:violated' as invariant: "An entry names a call does not hold"

invariants -- 2 declared: 'Writes are for recorders' holds at 6 trigger(s); 'An entry names a call' proved at 1 site(s), guarded at 5.
```

The two examples above are added to the example tree by this RFC, so its tests exercise both forms.

## Reference

### Documents and schemas

One new kind, `invariant`, `packages/core/schemas/invariant.schema.json`, `$id` under the published
base, `$schema` accepting the URL and the alias `@wilanis/invariant.schema.json`, with the optional
`label` every kind carries.

```
invariant
  description  string, required
  label        string
  access       object            exactly one of access | holds
    over       opRef[] | path[]  domain port operations, or a domain port path meaning every operation of it; unique, at least one
    requires   object            at least one of:
      policy   path              a policy every reaching trigger attaches
      proves   string[]          request.* paths (the policy schema's `proves` pattern) some attached policy proves
  holds        object
    on         path              a core shape
    when       string            a rule in the switch grammar; roots are the shape's fields
```

`InvariantDoc` joins `DocByKind` in `packages/core/src/model.ts`; `'invariant'` joins `Kind` and
`KINDS`, so `kindOfSchema` recognises it and `validate.ts` joins the schema. `HOME` in
`packages/core/src/placement.ts` gains
`invariant: { layers: ['domain'], why: 'an invariant is a rule of the business, over its ports and shapes' }`,
so a document elsewhere is D008. The kinds table in `packages/runtime/templates/CLAUDE.md` gains the row
`invariant | a rule that must hold: access (which policy gates writes to a port) or holds (a rule over a core shape's fields) | domain/`,
and `SCAFFOLDS` in `packages/runtime/src/scaffolds.ts` gains `invariant`, writing the `holds` form with
`when: "true"` under `into(target, 'domain', 'invariant')` unless `--over` names an operation, in which
case the `access` form with `requires.proves: ["request.principal"]`.

No existing schema changes.

### Ports, operations and kinds granted

None. The guard is lowered to `@std/object.port.json#make` and `@std/outcome.port.json#refuse`, both of
which exist. The reason word `invariant` is reserved: a `refuse` node an author writes with
`"reason": "invariant"` is refused (I006), so that a mapped `invariant` always means a guard.

### Checker rules

A new family `I`, `packages/compiler/src/check/invariants.ts`, with `checkInvariant(judge, invariant)`
and `checkInvariantSites(judge)`. Both run in `judgeTree` (`packages/compiler/src/checker.ts`) after the
trigger loop and before `checkScenario`: an invariant is judged over documents already found well-formed,
so an `I` refusal never repeats an R001, T or A refusal, and a trigger's attached policies are known.
The A family judges each trigger on its own; the I family judges the tree against a rule that spans
triggers, which is why it is not another method of `AccessCheck`.

Reaching: the operations a trigger reaches are `fire.run` and, transitively, every domain operation
called by the graph its binding runs (or the operation it delegates to), under each profile. This is the
walk `refusalsReachable` in `packages/compiler/src/refusals.ts` already makes to find reasons; it is
factored into `operationsReachable(scope, opRef, profile)` in the same module and both use it. A
policy's `decide.run` is not a way in and is not walked: the policy is the gate.

Satisfying: `requires.policy` is satisfied when the trigger attaches that policy, by canonical path
(`judge.canonOp`'s sibling `scope.canon`), bare or with credentials. `requires.proves` is satisfied when,
for each path, some attached policy's `proves` holds it or a path above it, by `atOrBelow` from
`check/typing.ts`, exactly as `checkNeed` in `check/triggers.ts` judges A006.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| I001 | `check/invariants.ts`, against the trigger's file, at `policies` | a trigger reaches an operation an access invariant covers, under some profile, and no attached policy satisfies `requires`; the message names the invariant, the operation, and the path it was reached through when not fired directly | `attach "<policy>" under policies` (or `attach a policy whose proves lists "<path>"`), `or take <op> out of the invariant's over` |
| I002 | `check/invariants.ts`, against the invariant, at `access/over/<i>`, `access/requires/proves/<i>` or `holds/on` | `over` names a native port or operation, or a port path that is not a domain port; `proves` names a path that is not `request.*` the guard or a kind hands (the A001 judgement in `PolicyCheck.checkProves`, reused); `on` names an edge shape or a non-shape. An unknown path is R001 through `judge.opAt`, `scope.get`, and visibility is L005 through `judge.visible` | `an invariant gates domain ports; a native port is reached through a binding` / `wilanis describe <guard plugin>` / `an invariant holds over core shapes; the edge is judged by the trigger` |
| I003 | `check/invariants.ts`, against the invariant, at `access/over` or `holds/on` | no trigger reaches any operation of `over` under any profile, or no site makes or takes the shape of `on`: the invariant constrains nothing, like G008 for an unread node or T006 for a dead reason | `remove it, or name what a trigger reaches` / `remove it, or name a shape a graph makes or takes` |
| I004 | `check/invariants.ts`, against the invariant, at `holds/when` | the rule does not parse (`expr.parse`) or does not type-check against the shape's fields as inputs (`expr.check` with `Inputs` built from `scope.types.ref(on).fields`, each optional field optional); the message is the `ExprError` | `the roots are the shape's fields: <names>` |
| I005 | `check/invariants.ts`, against the graph, at `nodes/<id>` | a site whose every read is literal evaluates the rule to false (`expr.evaluate` over the literal object): a compile-time violation | `the value contradicts '<label>' (<file>): <rule>` |
| I006 | `check/graph-nodes.ts`, against the graph, at `nodes/<id>/in/reason` | a `refuse` node's static `reason` is `invariant`, a word reserved for guards | `choose another word; 'invariant' is what a guard the compiler lowers refuses with` |

### Runtime behaviour

**Sites.** A site is a place a value of a shape with a field invariant comes into being. Two kinds, found
by `sitesOf(scope, shape)` in `packages/compiler/src/sites.ts`, used by the checker and the compiler alike:

- A **made site**: a `run` or `map` node in any graph whose declared result type is the shape or a list
  of it, when the operation is native: a `type` field bound to `$T` (`@std/object#make`, `#merge`,
  `@std/list#first`, `#concat`, `#slice`) or an operation whose `returns` names the shape (a storage
  operation of RFC 0002). A domain operation's result is not a site: it was made inside the graph that
  answers it and judged there.
- A **taken site**: a graph whose `in` is the shape or a list of it. The value arrives from a caller, a
  trigger through the embedder or another graph, and is judged on entry.

**Proof.** A site is proved when every conjunct of the rule (`&&` at the top, as `provedBy` in
`packages/core/src/expr/check.ts` splits it) is established, by one of:

1. *Literal*: every root the conjunct reads is a literal in the node's `value` (or `base` and `over`
   for `merge`). The checker evaluates it; false is I005.
2. *Narrowed*: the node is routed, directly or through a node it reads, by a `switch` whose rule has a
   conjunct that is the same after renaming the switch's `in` aliases to the value's fields (how
   `provedBy` in `check/narrowing.ts` renames a `has()` today), or that implies it by ordering on the same
   literal (`x > 0` proves `x >= 0`; `x == 'GET'` proves `x != 'DELETE'`). `Narrowing` collects every
   conjunct of a routing rule, not only `has()`; `Narrowing.provedFor` answers them.
3. *Pass-through*: the node's whole value is read from a site of the same shape that is proved or
   guarded (`"value": "{{in}}"`, `"value": "{{row}}"`), so the rule held where the value was made.

Whatever is not proved is **guarded**.

**Lowering a guard.** In `Compiler.lowerGraph` (`packages/compiler/src/compiler.ts`), after every node is
lowered, each guarded made site `id` becomes three kernel nodes and a rename:

```
id:made      the original node, as lowered
id:check     switch  in: one entry per root the rule reads, {{id:made.<field>}}
                     rules: [{ when: <rule>, to: 'id' }]   else: 'id:violated'
id           call    @std/object.port.json#make  value: {{id:made}}  type: <shape>
id:violated  call    @std/outcome.port.json#refuse  reason: 'invariant'
                     message: "'<label>' does not hold: <rule>"  type: <shape>
```

Every read of `{{id...}}` elsewhere is unchanged, since `id` still answers the value. Where `id` is an
`out.from` candidate (`outputCandidates` in `documents.ts`), `id:violated` is appended after it, so the
graph refuses when the guard does. A guarded taken site is the same with `in` as the made value: the
compiler renames the root `in` to `in:ok` in `lowerRef` (`Roots` gains `aliases`), and lowers
`in:check` reading `{{in}}`, `in:ok` and `in:violated`. A list of the shape is guarded element by element:
the check is a nested spec and the site becomes a `map` over the list with `onItemFailure: 'fail'`, the
mechanism `graphCall` and `nestedRunner` already use for a bound graph. Ids with a colon cannot collide
with authored ids, which are `ident`s; the report shows them, and `redact` carries over from the
original node.

The reason `invariant` joins the reasons reachable from an operation: `graphRefusals` in `refusals.ts`
adds `{ reason: 'invariant', file: graph, node: id }` for each guarded site in a graph it walks, so T005
holds every trigger reaching a guarded site to map `invariant` and T006 refuses mapping it where nothing
is guarded. A proved site adds nothing: proving an invariant relieves the trigger of mapping it.

**Rehearsal.** A guard is a switch, so the branch solver (`packages/runtime/src/solve.ts`) inverts its
rule the way it inverts any rule and the walk (`rehearse.ts`) tries both branches; nothing new is solved.
`rehearsal-report.ts` prints a guard's decision with the header `guard '<id>' <label>` instead of
`switch '<id>'`, its two branches labelled `holds` and `violated`, and one summary line per invariant
after the branch summary: `holds at N trigger(s)` for the access form, `proved at N site(s), guarded at M`
for the field form. A guard's `violated` branch is "refused on purpose", as a declared refusal is today.

**The embedder** changes nothing: `Embedder.gate` and the values that cross the edge are as they are.
A taken site guards what the embedder hands to the graph, inside the graph.

**Access invariants** have no run-time behaviour. They are proved or refused at check time.

### Discoverability

`wilanis describe <invariant>` (`packages/runtime/src/discovery.ts`, a new `invariantLines`) prints the
form, what it covers, and how it is met: for `access`, each reaching trigger and the policy that
satisfies it; for `holds`, each site as `proved (literal|narrowed by '<switch>'|from '<node>')` or
`guarded`. `describe <trigger>` gains a line per access invariant it satisfies:
`holds  @monitor/domain/writes-are-for-recorders.invariant.json  through @access/edge/can-record.policy.json`.
`describe <shape>` lists the invariants over it. `wilanis map` prints the same `holds` line under each
trigger's gates. `wilanis ls invariant` lists them.

The viewer (`packages/view/src/model.ts`, a new `invariantView`; `renderDocPage` in
`packages/view/client/index.html`, a new `case 'invariant'`) shows a page with the rule, what it covers,
and the same per-trigger or per-site table. On the graph canvas, a guarded node carries a badge naming
the invariant and a proved one a lighter badge saying how; double-clicking the badge opens the invariant.
The trigger and shape pages list their invariants beside the policies and the fields.

### Plugin contract

None.

## Compatibility

Additive to IR v1: one new kind, no change to any existing schema. Every document written before this
RFC validates and means what it meant. Two behaviours change for a tree that adds an invariant: T005
may newly require the reason `invariant` on triggers reaching a guarded site, and a `refuse` node with
`"reason": "invariant"` is I006. No tree in this repository has one. Until 1.0 is published, v1 may
change in place; after it, a breaking change goes to `schemas-v2` (see RFC 0008).

## Tests

Sabotage tests in a new `packages/runtime/test/sabotage-invariants.test.ts`, through `sabotage` and
`codes` from `example-harness.ts`, once the two example invariants are in place:

- I001: pop `can-record` from `delete-entry.trigger.json` → `['I001']` (`forbidden` stays reached
  through `employees-only`, so no T006). Delete `policies` and the three access reasons from
  `import-entries.trigger.json` → `['I001']`, the message naming `#record` as reached through `#import`.
- I002: `over: ["@http/http.port.json#request"]`; `proves: ["request.nope"]`;
  `on: "@monitor/edge/EntryView.shape.json"`. `requires.policy: "@access/edge/nope.policy.json"` → R001.
- I003: `over: ["@monitor/domain/monitor.port.json#listByMethod"]` with `list-entries.graph.json`
  edited not to call it; `on` a core shape no graph makes or takes.
- I004: `when: "quantity >= 0"` (no such field); `when: "url > 3"` (string against number);
  `when: "len(url) >"` (parse error).
- I005: in `record-entry.graph.json`, a `make` node with a literal `{ "id": "x", "url": "", "method": "GET" }`.
- I006: `reason: "invariant"` on `create-row.graph.json`'s `failed` node.
- D008: `relocate` an invariant to `edge/` or `data/`.
- T005/T006: with the field invariant present, drop `invariant` from `record-entry.trigger.json`'s
  refusal table → `['T005']`; with the invariant document removed, the mapping is `['T006']`.

Behaviour tests in `packages/runtime/test/example.test.ts` and `branches.test.ts`:

- `rehearse` reports `guard 'row' An entry names a call  2/2 branches` for each guarded data graph,
  `proved` for `record-entry.graph.json`'s pass-through, and the summary line, for every seed 1 to 8.
- A run through `wilanis run` with a stubbed upstream answering `"url": ""` refuses with reason
  `invariant`, and the http kind answers the status the trigger maps.
- `describe` of the invariant, of `delete-entry.trigger.json` and of `Entry.shape.json` print the lines
  above; `map` prints `holds` under each write trigger.
- Compiler: a guarded graph's spec has `row:made`, `row:check`, `row`, `row:violated`, and
  `row:violated` in `output`; a proved site has none.

`packages/core/test/validate.test.ts` gains the baseline invariant of each form and the refusal of a
document with both or neither. `packages/view/test` gains the invariant page of the example.
`libraries/access/test` is unchanged unless the access tree ships an invariant, which this RFC does not.

## Implementation plan

1. **The kind.** Schema, `InvariantDoc`, `Kind`/`KINDS`, `HOME`, the template row, the `wilanis new`
   scaffold, the validate baseline. `area:core`, `area:runtime`. Good first issue: it follows the recipe
   in `CLAUDE.md` for a new kind.
2. **Reaching.** Factor `operationsReachable` out of `refusalsReachable` in `refusals.ts`, with a test
   that `import-entries` reaches `#record`. `area:compiler`.
3. **Access invariants.** `check/invariants.ts` with I001, I002, I003 for the `access` form; the
   `judgeTree` order; the two example invariants and their sabotage tests. `area:compiler`.
4. **Sites and proof.** `sites.ts`; `Narrowing` collecting every conjunct; the three proof rules; I004
   and I005; sabotage tests. `area:compiler`.
5. **Guards.** Lowering in `compiler.ts`; `Roots.aliases`; `invariant` as a reachable reason; I006; the
   compiler test on the lowered spec. `area:compiler`.
6. **Rehearsal.** The `guard` header, the `holds`/`violated` labels, the summary lines. `area:runtime`.
7. **Discoverability.** `describe`, `map`, `ls` lines. `area:runtime`. Good first issue after 3.
8. **The viewer.** `invariantView`, the page, the canvas badges. `area:view`.
9. **The agent's rules.** A paragraph in `packages/runtime/templates/CLAUDE.md` saying when to write an
   invariant instead of repeating a policy or a check, and how to read I001. `area:runtime`.

Steps 1 to 3 deliver access invariants alone and can ship before 4 to 8.

## Drawbacks and alternatives

**Cost.** A guard adds three kernel nodes per guarded site and one refusal reason to every trigger that
reaches one. The reason is the honest price: a value that cannot be proved can fail, and the tree must
say how it answers. Proving removes the price, which is the incentive the design wants.

**Class 3 is deferred.** The most quoted invariants of the review ("an order cannot become paid without
a payment result") are transitions over stored state. They need a record's old and new values at a
storage operation, and are best stated against a lifecycle construct. Section "Class 3" names the shape
of the design so RFC 0002 and RFC 0021 leave room for it; this RFC does not design it.

**A rule on the shape itself** (`"where": "len(url) > 0"` inside `Entry.shape.json`) was considered.
It is shorter, but a shape is a type and this is a rule with a label, a description and a place in the
checker's output; a document of its own is what `describe`, `map` and the viewer can name, and what an
include can ship. It also keeps the shape schema unchanged.

**Naming a role** in an access invariant (`"requires": { "role": "recorder" }`) was considered and
rejected: the checker cannot read a role out of a policy's graph without learning what a principal is,
which is the guard's business. Naming the policy says the same thing without a new concept.

**Enforcing taken sites in the embedder** instead of inside the graph was considered. The embedder
judges the edge; a core shape's rule is the domain's, and a graph called by another graph has no
embedder in front of it. Lowering the guard inside the graph covers both callers with one mechanism.

**Making `invariant` a run-time fault** rather than a refusal was considered. A fault is what the graph
did not declare; a guard is declared by the invariant, so it is a refusal with a reason the trigger maps,
and the rehearsal can report both branches.

### Class 3, named and deferred

A transition invariant says what may change between two values of one record:

```json
"transition": {
  "on": "@orders/domain/Order.shape.json",
  "when": "old.status != 'paid' && new.status == 'paid' → has(new.payment)"
}
```

Its sites are the storage operations of RFC 0002 that replace or patch a record, where the old value can
be read and the new one is known. It needs an implication in the grammar or a `then` field, and it is
better stated once against a lifecycle (`pending → paid → refunded`, RFC 0021) than against every write.
Nothing in this RFC forecloses it: the document kind has room for a third form, and sites, proof and
guards apply to it unchanged.

## Open questions

Before `accepted`:

1. The reason word. `invariant` is proposed; the http kind will map it to 422 at a taken site (the
   caller's value) and 500 at a made site (the tree's own translation). Should the compiler hand the
   kind two reasons (`invariant` and `invariant_in`), or one word and the tree decides?
2. Whether `over` may name a whole domain port (every operation) or must list operations. The example
   wants the writes only, so listing is the common case; a whole port is a convenience that makes a
   later `list` operation gated by accident. Proposed: operations only, drop the port form.
3. Whether an include's invariants bind the host. Proposed: yes, since an include's ports are reached by
   the host's triggers, and a library that ships "sign-in is public, refresh is signed in" is exactly
   what `@wilanis/access` should be able to say.

During implementation:

4. How far narrowing goes: the implication table (`>` proves `>=`, `==` a literal proves `!=` another)
   is small on purpose. Widen it only with a failing example.
5. Whether `describe <graph>` should print the guards as nodes. Proposed: yes, marked `(guard)`, so a
   reader of the CLI sees what the viewer shows.
