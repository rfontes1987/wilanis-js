# RFC 0017: Migrations derived from store declarations

- **Status:** accepted
- **Areas:** `area:plugin-storage` (the planner, the record, the engine contract), `area:core` (two optional marks on the
  `store` schema; one optional hook on `PluginModule`), `area:compiler` (two C rules over the marks), `area:runtime`
  (the `wilanis migrate` command, the template), `area:view`
- **Tracking issue:** #19
- **Depends on:** RFC 0003 (the marks a store carries and `ensure`'s `drift`, which this RFC gives an answer to; accepted).
  RFC 0002 for implementation: the planner lives in `@wilanis/plugin-storage` and every step is executed by an engine
  through the `Engine` interface that RFC 0002 exports, so nothing here lands before that package does. RFC 0022's
  `transactionalDdl` capability decides whether a plan is one transaction (*Runtime behaviour*); until it lands the
  postgres engine is the one engine and has it. RFC 0019's envelope is what `--json` prints. RFC 0013 is a stub: when
  it settles the active profile, `--profile` follows it, and until then the flag is given as `start` takes it
  (*Runtime behaviour*). RFC 0008 used the word `migrate` for the command that rewrites a tree's documents; that
  command is renamed `wilanis upgrade` there (*Open questions*, first).

## Summary

A migration is derived, not written. The storage engine keeps, in the database itself, the declaration of every
collection as it was last applied there; `wilanis migrate <root> --profile <name>` diffs that record against the store
documents of the tree and prints a plan: one step per line, each **additive** (create a collection, add an optional
column, add a column with a default), **transformative** (rename a field or a collection, drop a constraint, make a
field optional) or **destructive** (drop a collection or a field that holds data, narrow a type, make a field
required with no default). Nothing runs until `--apply`, a destructive step runs only when `--allow-destructive`
names its collection, a step that existing rows would violate is refused outright with the count and the one-off
graph that fixes it, and every plan that applied is one row of the record, so `--history` prints what changed and
when. A rename is the one step no diff can see, so the store says it, `"renamed": { "agent": "ua" }`, and the planner
tells the author when the mark has done its work. RFC 0003's `ensure` becomes the same planner allowed only additive
steps, so `wilanis start` on a store that is behind refuses with the plan it would need and names this command.
`rehearse` never migrates: it reaches no engine.

## Motivation

RFC 0002 gives a tree a store and RFC 0003 gives the compiler the store's marks: `key`, `unique`, `refs`, `defaults`,
and an `ensure` that adds what a table lacks and refuses, with reason `drift`, what it would have to destroy or
change -- a column of another type, a `unique` that existing rows violate, a required column with no default. Those
two RFCs stop at the refusal on purpose, and say this one is the answer. Today the answer is outside the tree: an
operator writes a Kysely migration file, or a `psql` session, against the very production data an agent cannot be
trusted with, and the tree learns nothing of it -- `wilanis check` cannot see a migration file, `describe` does not
list it, the viewer does not show it, and the next `ensure` finds a table it did not make and stops the start.

What an author, human or agent, cannot express now: that the shape's field `ua` is now called `agent` and the
column should follow; that the `notes` collection is gone and its table may go, this once, with the rows it holds;
that a new `unique` over `url` and `method` is meant, and what to do about the three rows that already repeat. Each
is a decision about data that only the database can inform (how many rows, which repeat) and only the tree can
authorise, and the model has no place where the two meet. Once the shape changes in the tree and `ensure` refuses
`drift`, an agent in the repair loop of RFC 0019 has a refusal it cannot fix by editing a document, which is exactly
the class of dead end the loop must not have.

What this RFC does not do. It does not add a migration document kind: a hand-written history of steps is code an
agent would have to keep in step with the shapes, and a diff is what keeps itself in step. It does not write business
backfills: a step that needs logic -- splitting `name` into `first` and `last`, giving every existing row a tenant
(RFC 0015) -- is a one-off graph the tree declares and a command-line trigger fires, and the planner says so where
it meets one. It derives no reverse plan: the platform moves forward, and the record says what it moved from
(*Drawbacks*). It does not touch what `ensure` is for (RFC 0003 settled that running it in `live` is the author's
call). It exposes no SQL: the plan is printed in the tree's words, and what a step is on an engine is the engine's.
And it does not rewrite a tree's documents from one IR version to the next, which is RFC 0008's `wilanis upgrade`
(*Open questions*, first).

## Guide-level explanation

**The declared** is what a collection is according to the tree: the store document and the shape it names, lowered
to what a database needs to know -- the key, each field with its type and whether it is required, the `unique` lists,
the `refs`. **The record** is the declared as it was last applied to that database, kept there by the engine, one row
per applied plan and collection. **A plan** is the difference, as steps, from the record to the declared, for every
connection the tree's stores name. **A step** is one thing the engine would do, and it has a class:

| Class | Steps | What is at stake |
|---|---|---|
| additive | create a collection; add an optional field; add a field with a `defaults` value; add a `unique` or a `refs` no row violates; make a field required when no row is empty; adopt a table that exists and was never recorded | nothing: no row and no value is lost, and the step cannot fail on data |
| transformative | rename a field; rename a collection; drop a `unique` or a `refs`; make a required field optional | no data, but a name or a guarantee: a graph elsewhere may read the old name, a duplicate may now be written |
| destructive | drop a collection that has rows; drop a field that holds a value in some row; change a field's type; make a field required with no default when rows are empty and `--allow-destructive` names the collection | rows or values, gone |
| refused | a `unique` or a `refs` that existing rows violate; a required field with no default over empty rows, unless allowed as destructive; a changed `key`; a type change the engine cannot cast; a `renamed` whose old name is not in the record | nothing runs: the plan prints the count and the edit or the graph that makes the step possible |

The example, after RFC 0003 gave its store the `entries` and `notes` collections. Three edits at once: `Entry` gains
an optional `note`, its `ua` becomes `agent`, and the `notes` collection is dropped because notes now live in the
entry. The shape changes in `domain/`, and the store in `data/` says the one thing a diff cannot see:

```json
{
  "$schema": "@wilanis/store.schema.json",
  "label": "Entries",
  "description": "Observed calls, one row each; a url is observed once per method. A note is a field of the entry.",
  "connection": "@connections/entries.connection.json",
  "collections": {
    "entries": {
      "of": "@monitor/domain/Entry.shape.json",
      "key": "id",
      "unique": [["url", "method"]],
      "defaults": { "agent": "unknown" },
      "renamed": { "agent": "ua" }
    }
  }
}
```

`renamed` is keyed by the field as it is now, and says what it was. Without it the diff would see `ua` gone and
`agent` new: a destructive drop and an additive add, and every user agent lost. With it the column is renamed, and
`defaults` on `agent` says what a row gets if the column had ever to be added -- the mark is read by the field's
current name, as every mark is (RFC 0003).

```
$ wilanis migrate example --profile production
plan for @connections/entries.connection.json  (postgres, granted by @storage-postgres)
  entries
    rename   ua → agent                                     transformative
    add      note  text, optional                           additive
  notes
    drop     collection notes  (17 rows)                    destructive   ✗ needs --allow-destructive notes

2 steps would apply; 1 is refused. Nothing was applied: run again with --apply.
```

The plan is printed and nothing has happened. `--apply` alone applies the two steps it may and stops before the
third, saying so; to drop the table the operator names it:

```
$ wilanis migrate example --profile production --apply --allow-destructive notes
plan for @connections/entries.connection.json  (postgres, granted by @storage-postgres)
  entries
    rename   ua → agent                                     transformative   applied
    add      note  text, optional                           additive         applied
  notes
    drop     collection notes  (17 rows)                    destructive      applied

3 steps applied in one transaction; recorded as migration 4 (2026-09-11T09:14:02Z).
```

The next run finds nothing to do, and one thing to say:

```
$ wilanis migrate example --profile production
plan for @connections/entries.connection.json  (postgres, granted by @storage-postgres)
  entries
    up to date; renamed.agent has been applied
      → remove "renamed": { "agent": "ua" } from @monitor/data/entries.store.json

nothing to apply
```

A mark that has done its work is noise for the next reader and a lie to the next database (a fresh one has no `ua`
to rename), so the planner asks for its removal; it does not refuse, because a tree is deployed to more than one
database and the mark must survive until the last of them has moved.

**What existing rows can refuse.** Add `"unique": [["url"]]` to `entries` when four rows share a URL:

```
  entries
    unique   [url]  (4 rows violate)                        refused
      → a constraint over rows that break it is a decision about which rows stay: fix them with a one-off
        graph fired by a command-line trigger, or drop the mark; wilanis migrate applies it once no row violates
```

Nothing about this step can be made safe by a flag: deleting three of four rows is business, and business lives in
a graph the tree declares. The same holds for a `refs` that dangling rows violate, and for a field made required
while rows are empty and no `defaults` value says what they receive -- there the fix is often the mark itself,
`"defaults": { "agent": "unknown" }`, which turns the step additive.

**`start`, on a store that is behind.** RFC 0003's `ensure` stays a startup step's operation and stays additive;
what changes is that it computes the same plan and applies it when every step is additive, and otherwise refuses
`drift` with the plan and this command in the hint:

```
startup 1/3 Prepare the entry store: refused as 'drift'
  @connections/entries.connection.json is behind @monitor/data/entries.store.json:
    entries  rename ua → agent (transformative); notes  drop collection (17 rows, destructive)
  → wilanis migrate example --profile production; ensure applies additive steps only
```

So production never migrates destructively because a process started; it migrates because an operator ran the
command and read the plan.

## Reference

### Documents and schemas

**`store.schema.json`** (`packages/core/schemas/`), the collection entry, gains two optional marks beside RFC 0003's
`unique`, `refs` and `defaults`:

- `renamed` (object; `propertyNames` `common.schema.json#/$defs/ident`, values `ident`; `additionalProperties:
  false`): "Fields of the shape that changed name, each keyed by its name now and holding its name before, so
  `wilanis migrate` renames the column instead of dropping one and adding another. Remove the entry once every
  database has applied it; the planner says when. A name may appear once as a value."
- `was` (`ident`): "The collection's name before this one on the same connection, so `wilanis migrate` renames the
  table instead of dropping it and creating another. Remove it once every database has applied it."

`StoreCollection` in `packages/core/src/model.ts` gains `renamed?: Record<string, string>` and `was?: string`. The
`$id`, the `required` list and everything else stay. The baseline in `packages/core/test/validate.test.ts` gains a
collection with both; `"renamed": { "agent": 7 }` and `"was": "two words"` are refused by validation.

No new kind, no change to placement: a store lives in `data/` (RFC 0002, `HOME.store`). The row in
`packages/runtime/templates/CLAUDE.md` becomes:

| kind | what it is | where |
|---|---|---|
| `store` | what the feature keeps: a connection and collections of a core shape, each by key, with `unique`, `refs`, `defaults`; `renamed` and `was` say what a field or the collection was called, for `wilanis migrate` | `data/` |

and the template's loop gains one sentence after step 3: "When a shape a store holds changes, `wilanis migrate`
prints what the database would have to do; a rename is written as `renamed` on the collection, and a destructive
step is the operator's to allow, never yours." `wilanis new store` is unchanged: a fresh store has nothing to rename.

**`project.schema.json`**: nothing. Which profile the command runs under is the flag's, as it is for `start`.

### Ports, operations and kinds granted

None new. `@storage/storage.port.json#ensure` (RFC 0002, widened by RFC 0003) is redefined over the planner and its
contract does not move: it still accepts `store` (static), still answers `{ collections, columns, constraints }`,
still `refuses: false` since `drift` is a startup failure and not a graph's declared outcome. Its description
becomes: "Plans the store's collections against what this connection has recorded (RFC 0017) and applies the plan
when every step is additive; refuses `drift`, naming the steps and `wilanis migrate`, when one is not. Counts what
it created." A collection never recorded on a database whose table exists is adopted, which is additive.

### Checker rules

The marks are static facts about the store and the shape, so they are the compiler's, in `checkStore` in
`packages/compiler/src/check/contracts.ts` (RFC 0002; `check/stores.ts` once the module passes the house limit),
family C, beside RFC 0003's rows over `unique`, `refs` and `defaults`. Codes are placeholders; the implementing pull
request takes the next free in the family. Whether a rename *applies* to a database is not a checker rule: the
checker judges documents against the tree, and only the planner has the record.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0nn | `checkStore`, at `collections/<name>/renamed/<field>` | a key of `renamed` is not a field of the shape (there is nothing to rename to); or its value *is* a field of the shape (both names exist, so nothing was renamed); or the same value appears under two keys (one column cannot become two) | `renamed is keyed by the field's name now and holds its name before: wilanis describe <shape>` |
| C0nn | `checkStore`, at `collections/<name>/was` | `was` equals the collection's own name, or the name of another collection of the same store, or of another collection of the same connection (the pair (connection, name) names a table, RFC 0002) | `was is the collection's previous name on this connection, and no collection is named that now` |

What is not added. A `renamed` naming the key is allowed: a key is a column like any other and renaming it loses
nothing. A `defaults` on a renamed field is allowed and means what it always means (what a row receives *if* the
column is added). The storage plugin's `check` (X2xx) gains no rule: it judges call sites, and no call site names a
migration.

### Runtime behaviour

**The command.** `wilanis migrate [root] [--profile word] [--apply] [--allow-destructive a,b] [--adopt]
[--history] [--json]` joins `USAGE` in `packages/runtime/src/cli.ts`; the work is `migrate` in a new
`packages/runtime/src/migrate.ts`, exported from `tools.ts` and callable without the CLI, as every command's work is.
It loads and checks the tree (a refused tree runs nothing, and prints what `check` would), runs every plugin's
`postLoad` under the profile exactly as `start` does -- an engine registers itself there (RFC 0002) and a plan needs
the engine -- and then, for every loaded plugin that has a `migrate` member (*Plugin contract*), asks it for its plan,
prints the plans, applies them when told, and tears the plugins down. It does not run the startup steps and it
listens to nothing: `Served` is never built. Exit 0 when the plan is empty or applied in full; 1 when a step is
refused, a destructive step was not allowed, or a connection has drifted; 2 on a flag it does not know.

The runtime knows nothing of tables. It knows a `Plan`: targets, each with steps of one of three classes, a line of
text, and what would be lost. It prints them in the format above with the `padEnd` columns `discovery.ts` already
uses, orders targets by connection path and steps by target then declaration order, and applies a target only
when every one of its steps is allowed -- a refused step refuses the whole connection, since a plan is one
transaction. The three lines it can print at the end: `N steps would apply; M refused. Nothing was applied: run again
with --apply.`, `N steps applied in one transaction; recorded as migration K (<iso>).`, `nothing to apply`.

**The planner** (`packages/plugin-storage/src/plan.ts`, new, pure). Its input is two declarations and its output the
steps between them:

```ts
/** A collection as a database needs to know it: lowered from the store and the shape, engine-neutral, and what the record keeps. */
export interface Declared {
  key: string;
  fields: Record<string, { type: 'string' | 'number' | 'boolean' | 'json'; required: boolean }>;
  unique: string[][];
  refs: Record<string, { collection: string; onRemove: 'refuse' }>;
}
/** The steps from `recorded` to `declared` for the collections of one connection, before any row is counted. */
export function plan(recorded: Record<string, Declared>, declared: Record<string, Declared>, marks: Marks): Step[];
```

`Marks` is what the store says that is not state: each collection's `renamed`, `was` and `defaults`. A shape's field
lowers as RFC 0002 lowers it for a column (`string`, `number`, `boolean`; a shape, a list or `unknown` is `json`;
`blob` is refused at check time by X221 and never reaches here). Nothing engine-specific is in `Declared`, which is
what lets one planner serve every engine and lets the record be compared across engine versions. `defaults` is not
in it: a default is applied when a column is added and dropped at once (RFC 0003), so it is an instruction to a
step, not a fact about the table.

The diff, collection by collection, keyed by the pair (connection, collection name) as RFC 0002 names a table:

1. A declared collection with no record and no table: `create`. With `was` naming a recorded collection that is no
   longer declared: `renameCollection`, then the field steps below against that record. With no record but a table
   the engine finds: `adopt` -- the record is written from what the catalog holds, then the field steps run against
   *that*, so a database that predates this RFC, or that `ensure` built before it, joins the record on first contact.
2. A recorded collection no longer declared and not named by any `was`: `drop`, with the row count.
3. A changed `key`: refused. A key identifies, and re-keying is a new collection: declare it, copy with a graph,
   drop the old one.
4. Per field: in `renamed` with the old name in the record and the new one not: `rename`. Declared and not recorded:
   `add`, with the `defaults` value where one is declared and the row count. Recorded and not declared: `remove`,
   with the count of rows where the column holds a value (a column empty everywhere drops as transformative). Both,
   with another type: `retype`, with the count of rows the engine cannot cast. Both, required now and not before:
   `require`, with the count of empty rows and the `defaults` value; optional now and required before: `relax`.
5. Per constraint: a `unique` list or a `refs` declared and not recorded: `unique` or `ref`, with the count of rows
   that violate it; recorded and not declared: `ununique` or `unref`.

Each step is then classed by the table under *Guide* once the engine has counted its rows (*The engine*), and the
class decides what applies: additive always; transformative under `--apply`; destructive under `--apply` when
`--allow-destructive` names the collection; refused never, and the plan says why. The planner's own wording for
each step is the `says` the runtime prints (`rename ua → agent`, `drop collection notes (17 rows)`), and the
`loses` line names the data (`17 rows`, `values of ua in 240 rows`).

**The record** is the engine's, in the database it describes, so a database carries its own history and a fresh one
carries none. On PostgreSQL: one table `wilanis_migrations` in the connection's schema, beside RFC 0010's
`wilanis_schedule` -- `id` (bigint, identity, primary key), `applied_at` (timestamptz), `collection` (text),
`declared` (jsonb: the `Declared` after the plan), `steps` (jsonb: the steps that touched it, as printed), `tree`
(text: `project.json → name`), `by` (text: the operating-system user and host that ran the command). The current
record of a collection is its latest row; a dropped collection's last row has `declared` null. The table is created
by the engine on first contact, as `wilanis_schedule` is, and never by a step of a plan. One row per collection per
applied plan, so `--history` reads one table and prints:

```
migration 4  2026-09-11T09:14:02Z  by rfontes@build-1  tree monitor
  entries  rename ua → agent; add note
  notes    drop collection (17 rows)
migration 3  2026-09-02T17:40:11Z  by deploy@ci  tree monitor
  entries  adopt (from the database as it stood)
```

**Drift, and `--adopt`.** Before any plan is computed for a connection the engine compares each recorded collection
with its catalog (`inspect`, the comparison RFC 0003's `ensure` already makes against `information_schema`). Where the
two disagree -- someone altered the table by hand, or a migration outside the tree ran -- the connection is refused
as drifted, the difference is printed in the record's words (`entries.agent is text, required in the database; the
record says optional`), and nothing on that connection is planned: a plan from a record that is wrong would be wrong
in ways the diff cannot see. `--adopt` re-seeds the record from the catalog for the drifted collections, as one
additive step per collection, and plans from there; it is the operator saying the database is right and the record is
behind, and it is recorded as such.

**The engine.** The `Engine` interface RFC 0002 exports from `packages/plugin-storage/src/engine.ts` gains five
members, each taking the connection's canonical path first as the storage operations do, and no SQL in any
signature:

```ts
/** The record's current entry for a collection, or nothing when it was never recorded on this connection. */
recorded(connection: string, collection: string): Promise<Declared | undefined>;
/** What the catalog holds for a collection, lowered to Declared, or nothing when there is no table. */
inspect(connection: string, collection: string): Promise<Declared | undefined>;
/** How many rows stand in a step's way: rows of a collection, rows holding a value, rows violating a constraint, rows that would not cast. */
rows(connection: string, step: Step): Promise<number>;
/** Apply the steps of one connection and write the record, in one transaction where the engine can; throws having applied nothing otherwise. */
apply(connection: string, steps: Step[], record: Record<string, Declared | null>, applied: Applied): Promise<void>;
/** Every applied plan on this connection, latest first. */
history(connection: string): Promise<Applied[]>;
```

`@wilanis/plugin-storage-postgres` implements them with Kysely: `inspect` over `information_schema.columns`,
`table_constraints` and `key_column_usage`; `rows` as one `SELECT count(*)` shaped by the step (a `GROUP BY ... HAVING
count(*) > 1` for a `unique`, a `LEFT JOIN ... WHERE ... IS NULL` for a `refs`, a cast in a `WHERE` for a `retype`);
`apply` as one transaction -- `BEGIN`, the `ALTER TABLE` and `CREATE TABLE` statements in step order, the
`wilanis_migrations` rows, `COMMIT` -- so a step that fails midway (a row written between the count and the
constraint) rolls the whole connection back and the record is untouched. PostgreSQL's DDL is transactional, which is
what makes "one plan, one transaction" a promise and not a hope; an engine whose kind declares
`transactionalDdl: false` (RFC 0022) applies step by step and writes the record after each, so a failure leaves the
record at the last step that applied, and the plan's summary line says `applied step by step` for it. A `retype`
uses `ALTER COLUMN ... TYPE ... USING` with the cast the engine chooses; a `rename` is `RENAME COLUMN`; an `add` with
a default is `ADD COLUMN ... DEFAULT` followed by `DROP DEFAULT`, as RFC 0003's `ensure` does today.

`@wilanis/plugin-storage-memory` keeps nothing between processes, so there is nothing to record and nothing to
migrate: `recorded` and `inspect` answer nothing, `rows` zero, `apply` does nothing, and the command prints
`@connections/entries.connection.json  (memory): nothing kept between processes, nothing to migrate` for its
connections. `ensure` on it keeps answering zeros.

**`ensure` over the planner.** `ensure`'s handler in `@storage` (RFC 0002) becomes: lower the store, ask the engine
for the record and the catalog of each of its collections, plan, count, class. When every step is additive, apply
and count what was created into `{ collections, columns, constraints }`; when one is not, refuse `drift` with the
steps, one per line, and the hint naming `wilanis migrate <root> --profile <profile>`. RFC 0003's behaviour is a
special case of this one -- what it added, this adds; what it refused, this refuses -- and the code that compared a
declaration with `information_schema` moves from `ensure` into `inspect`, where the planner reads it. One planner,
two callers.

**Several connections.** A tree's stores may name several connections and two stores may share one. The plan is per
connection, since a transaction is; a `refs` stays within a store (RFC 0003) and so within a connection, so no step
ever spans two. Connections are planned and applied in the order of their canonical paths, each in its own
transaction, and the summary says which applied when a later one refused: the operator sees `2 connections: 1
applied, 1 refused` and the record of the first is already written, which is the truth and is printed as such.

**`--profile`.** The profile is what the runtime needs to reach a connection: the secrets its settings read and, when
RFC 0013 settles how a profile may choose a connection, that choice. Every store of the tree is planned; a profile
does not filter them, because a store's connection is the document's and not the profile's (RFC 0002, *Drawbacks*).
The default profile is whatever RFC 0013 decides for `start`; until then the flag is given as `start` takes it.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** Unchanged, and no engine is involved: every storage operation is an
effect and is stubbed (RFC 0002), and the planner is not an operation a graph can reach. A rehearsal of a tree whose
database is three migrations behind is exactly the rehearsal of the tree, which is what a rehearsal is for.

**Reload.** `@reload` serves the tree again on a document change and never runs a startup step again, so a shape
edited while `start` runs changes nothing in the database until the next `start` or `migrate`. The store's handlers
judge every row they read against the shape (RFC 0002, `conforms`), so a row that no longer fits fails the node with
the shape's words rather than reaching a graph; the fix is the plan.

### Discoverability

- `wilanis describe <store>` (RFC 0003's page) prints the new marks one line each per collection, in the family's
  place: `renamed  agent ← ua` and `was  entry`, and says under each `until wilanis migrate has applied it everywhere`.
  What the *database* holds is not `describe`'s to say: `describe` reads the tree and opens no connection, so the
  record is `wilanis migrate --history`'s alone.
- `wilanis migrate --json` prints RFC 0019's envelope with `"command": "migrate"`: `format`, `runtime`, `root`,
  `profile`, `ok` (no refused step and no drift), `applied` (boolean), and `targets`, each `{ connection, engine,
  skipped?, drifted?: [...], steps: [{ do, target, at?, class, says, loses?, rows?, refused?, applied }] }`,
  sorted as printed. `--history --json` prints `migrations: [{ id, appliedAt, by, tree, targets: [...] }]`. The
  fields join the envelope's promise from 1.0; the wording of `says` does not.
- `wilanis ls store` and `wilanis map` are unchanged: a migration is not a document and not a flow.
- The viewer's `store` page (`renderDocPage` in `packages/view/client/index.html`, RFC 0002 and RFC 0003) shows a
  renamed field with its old name struck through beside it, and a renamed collection's `was` under its heading. The
  viewer opens no connection either.
- `USAGE` in `cli.ts` gains the line
  `wilanis migrate  [root] [--profile word] [--apply] [--allow-destructive a,b] [--adopt] [--history] [--json]   plan the stores against the database; apply when told`.
- The `@storage` README says what the record is, where it lives, and that the table is the engine's and not a
  document's.

### Plugin contract

One optional member on `PluginModule` in `packages/core/src/plugin.ts`, beside `check` and `postLoad`:

```ts
/**
 * What a plugin that keeps declared state in the world does for `wilanis migrate`: the plan from the tree as it
 * stands against what the world has recorded, and its application. Run after postLoad under the chosen profile,
 * never by a graph and never by start. Plugins without one have nothing in the world to reconcile.
 */
migrate?: {
  plan(ctx: MigrateContext): Promise<Plan>;
  apply(ctx: MigrateContext, plan: Plan): Promise<Applied[]>;
};
```

with, in the same file: `MigrateContext`, which is `PostLoadContext` plus `profile: string`, `allowDestructive:
string[]`, `adopt: boolean`; `Plan`, `{ targets: PlanTarget[] }`; `PlanTarget`, `{ connection: string; engine:
string; skipped?: string; drifted?: string[]; steps: PlanStep[] }`; `PlanStep`, `{ do: string; target: string;
at?: string; class: 'additive' | 'transformative' | 'destructive'; says: string; loses?: string; rows?: number;
refused?: string }`; `Applied`, `{ id: number; appliedAt: string; by: string; tree: string; connection: string;
targets: string[] }`. The storage plugin's own `Step` union lowers to `PlanStep`: `target` is what the step is about
in the plugin's words (a collection here; a topic or a bucket for another plugin) and `at` the part of it (a field).
Core holds the plan's names and none of the store's, so it never learns what a column is.

Why a hook and not a command in the runtime, or an operation in a tree. RFC 0002 rejected "a CLI command and a
printed DDL" because "a CLI command would need the runtime to reach into the plugin, which the contract forbids".
This is that objection answered on its own terms: the runtime reaches the plan through the contract, which is the
one thing it may see of a plugin, and the plugin does the work through `engines(env)` as its handlers do. The
alternative that needs no hook -- a `@storage/storage.port.json#migrate` operation, a domain operation delegating
to it, a command-line trigger firing that, in every feature that has a store -- is under *Drawbacks*; it keeps the
contract untouched at the price of three documents per store and a JSON answer where an operator needs a plan they
can read. The hook is general on purpose and narrow on purpose: any plugin that declares state the world must match
(a queue's topics, RFC 0009; a bucket, RFC 0005) may plan through it, and the runtime composes the plans; and it
carries no verb the runtime interprets beyond `class` and `refused`, so it cannot grow into a second command
dispatcher. `PluginCheckContext` and `PostLoadContext` are unchanged.

## Compatibility

IR v1, compatible. `store.schema.json` gains two optional properties; every store written under RFC 0002 or RFC 0003
validates and means what it did. `StoreCollection` gains two optional members. `ensure` keeps its `accepts` and its
`returns` and refuses `drift` in the cases it refused before, and in no new case for a database that has never been
touched outside `ensure`: a table `ensure` built and this RFC finds unrecorded is adopted, which is additive, so the
first `start` after this RFC lands on a production database prints one `adopt` step per collection in its log and
nothing else. `PluginModule` gains an optional member, which every existing plugin lacks and is not asked for. One
table joins the connection's schema, and the plan never drops it. No `schemas-v2`.

## Tests

`packages/plugin-storage/test/plan.test.ts`, pure, over `plan()` -- one `it` per row of the diff:

| Case | Expects |
|---|---|
| nothing recorded, nothing in the catalog | one `create` per declared collection, additive |
| the RFC 0003 example against its own record | no step |
| `ua` gone, `agent` added, no `renamed` | `remove ua` and `add agent`, the remove destructive once `rows` answers a count |
| the same with `"renamed": { "agent": "ua" }` | one `rename`, transformative; a second run against the new record: no step and the `renamed`-is-stale line |
| `"renamed": { "agent": "nope" }`, `nope` not in the record | refused, with the hint naming the record's fields |
| `notes` no longer declared | `drop collection notes`, destructive when rows are counted, transformative at zero |
| `notes` no longer declared, `drafts` declared with `"was": "notes"` | one `renameCollection`, then field steps against `notes`'s record |
| `note` added optional; `agent` added with `defaults` | `add`, additive both; without `defaults` and required: `require` path refused at a count, destructive when allowed |
| `[url]` added to `unique` | `unique`, additive at zero rows, refused above; `[url, method]` removed: `ununique`, transformative |
| `entryId` `refs` added | `ref`, additive at zero, refused above; removed: `unref` |
| `ua` required now | `require`, additive at zero empty rows, refused above without a default, additive with one |
| `method` from `string` to `number` | `retype`, destructive; the engine's count decides refused |
| `key` from `id` to `slug` | refused, with the three-part hint |
| a table in the catalog with no record | `adopt`, then the field steps against the adopted declared |

`packages/plugin-storage/test/migrate.test.ts`: the hook over a fake `Engine` whose `recorded`, `inspect` and `rows`
are tables the test fills -- the plan for two connections is ordered by path; a refused step refuses its connection
and not the other; `apply` receives only allowed steps; `allowDestructive` gates by collection; `adopt: false` on a
drifted connection plans nothing and lists the difference, `adopt: true` writes the adopt step first; the memory
engine's connection is `skipped` with its line.

`packages/plugin-storage-postgres/test/migrate.test.ts`, behind `WILANIS_TEST_POSTGRES_URL` as `engine.test.ts` is,
end to end on a throwaway schema: `ensure` on an empty database creates and records; the shape gains `note`: `plan`
prints one `add`, `apply` adds the column, `history` has two migrations; `ua` renamed with the mark: the column is
renamed and its values kept; `notes` dropped: refused without the flag, the table intact; with `--allow-destructive
notes`: gone, recorded; a `unique` over repeating rows: refused with the count, nothing applied, the record
unchanged; a second `apply` with nothing to do writes no row; `ALTER TABLE entries ALTER COLUMN agent SET NOT NULL`
by hand: the next plan is `drifted` and applies nothing, `--adopt` re-seeds and the plan proceeds; a table created
by hand and never recorded is adopted on the first plan; a step that fails inside `apply` (a constraint racing a row
inserted mid-plan) leaves the table and the record as they were.

`packages/runtime/test/migrate.test.ts`: the command over a fake plugin with a `migrate` member, as `startup.test.ts`
uses fake plugins -- `postLoad` ran before `plan` and the teardown after; no startup step ran and nothing is held;
the printed lines and the exit code for a clean plan, a refused step, `--apply`, `--json` (a valid envelope with
`command: "migrate"`); a tree `check` refuses runs no plugin. In `packages/runtime/test/sabotage-storage.test.ts`
(RFC 0003), the two C rows: `"renamed": { "nope": "ua" }`; `"renamed": { "agent": "url" }` with both fields present;
`"renamed": { "a": "ua", "b": "ua" }`; `"was": "entries"`; `"was": "notes"` while `notes` is declared. In
`startup.test.ts`: a required `prepare` step on a database whose record is behind by a rename stops the start with
`drift`, the step lines and the hint naming `wilanis migrate`. `packages/core/test/validate.test.ts`: the baseline.
`packages/view/test/view.test.ts`: the store page shows the old name struck beside the field.

## Implementation plan

1. Core: `renamed` and `was` on `store.schema.json` and `StoreCollection`; the validate baseline; the template row and
   sentence. (`good first issue`)
2. Compiler: the two C rows in `checkStore`; `sabotage-storage.test.ts`.
3. `@storage`: `Declared`, the lowering from a store and its shapes, `plan.ts` and `plan.test.ts`. Pure, no engine.
4. `@storage` and the postgres engine: the five `Engine` members; `wilanis_migrations`; `inspect` taking over the
   catalog comparison that RFC 0003 put in `ensure`; the memory engine's answers. `migrate.test.ts` in both packages.
5. `@storage`: `ensure` over the planner, `drift` with the steps and the hint; the startup test.
6. Core and runtime: the `migrate` member and its types on `PluginModule`; `packages/runtime/src/migrate.ts`, the
   `USAGE` line, the printing, the exit codes, `--json`, `--history`; `packages/runtime/test/migrate.test.ts`.
7. `@storage`: the `migrate` member over `plan.ts` and the engines; the stale-`renamed` line; the postgres end-to-end
   test's `apply`, `--allow-destructive`, `--adopt` and `--history` cases.
8. Discoverability: `describe`'s two lines, the viewer's page, the `@storage` README. (`good first issue`)
9. The example, for M05: the shape change and the store's `renamed`, a page in the example's README that walks the
   three commands above, and a test in `packages/runtime/test/example.test.ts` that the example's plan against an
   empty record is all `create`.

## Drawbacks and alternatives

- **A hook on `PluginModule`.** The one contract change, and the RFC's largest cost: every plugin author now sees a
  member most will never fill. It is taken because the alternatives are worse in the tree's own terms. A command
  hard-wired to `@storage` in `cli.ts` would name a plugin in the runtime, which names none today. A
  `@storage/storage.port.json#migrate` operation reached from a command-line trigger keeps the contract untouched
  and puts the migration in the tree, where `map` and `describe` see it -- but every feature with a store would carry
  a trigger, a domain operation and a delegation for it (X211 keeps one feature from naming another's store), an
  operator would run one command per store, and the answer would be the trigger kind's JSON where a plan wants
  columns and a summary line. The hook composes every plugin's plan into one printout, and it is the one route:
  `@storage` grants no `migrate` operation, so no graph and no trigger can reach a schema change (*Open questions*,
  second).
- **The record, not the catalog, is the truth.** Diffing against `information_schema` alone would need no table
  and would see what is really there. It would also lose the one thing a record has: intent. A column made `NOT
  NULL` by hand looks, from the catalog, like the tree is behind; from the record, it looks like what it is, a
  change the tree did not make, and the plan stops to ask. The catalog is still read, twice: to adopt what was never
  recorded, and to refuse what drifted. The cost is one table the plan never drops and one row per collection per
  plan; `wilanis_schedule` set the precedent for an engine's own table.
- **A derived plan is as good as the diff.** A field split in two, a value re-encoded, a tenant given to every row
  (RFC 0015) are steps the planner cannot write and refuses to guess at. It says so where it meets one and names the
  shape of the fix -- a graph the tree declares, fired once by a command-line trigger -- rather than growing a
  scripting language for data. The alternative, migration documents with hand-written steps as a kind, would give
  those cases a home and take from every other case the property this RFC exists for: that the schema is a fact of
  the tree and the database follows it.
- **Forward only.** A reverse plan for an additive step is derivable and for a destructive one is not, and a
  command that undoes some steps and refuses others is a trap for an operator at three in the morning. The record
  keeps each collection's declared before and after, so what to declare to get back is readable in `--history`, and
  the way back is a plan forward from there. A backup before a destructive plan is the operator's and the RFC says
  so in the printout's `loses` line rather than pretending to offer one.
- **A rename is a mark that lingers.** `renamed` and `was` are instructions that must survive until every database
  has applied them, so they outlive their usefulness in the tree and the planner can only ask for their removal. The
  alternative, a rename recorded in the tree as applied, would make the tree say something about a database, which
  no document does. The stale line is the honest compromise.
- **Counting rows costs a query per checked step.** Every `unique`, `refs`, `require`, `remove`, `retype` and `drop`
  step is one `SELECT count(*)` before the plan prints. On a large table that is seconds, and it is what makes the
  plan say `4 rows violate` instead of failing at `COMMIT`; the counts are the reason the plan can be read before it
  runs.

## Open questions

None open. Settled at acceptance, with the edits in the text above:

1. **The word is `migrate`.** RFC 0008, accepted, named `wilanis migrate` as the command that rewrites a tree's
   documents from one IR version to the next; that command does not exist yet and is planned for when there is a
   second version. A database migrates and a tree's documents move up a version, so this RFC keeps `migrate`, the
   word every database tool uses, and RFC 0008's unbuilt command becomes `wilanis upgrade`, edited there with the
   reason in the commit as RFC 0001 provides for a change to an accepted RFC. The roadmap's M05 spells the command
   as this RFC does.
2. **The hook, and only the hook.** `wilanis migrate` composes every plugin's `migrate` member, and there is no
   second route: `@storage` grants no `migrate` operation, so a schema change is never a declared operation that a
   graph or a trigger can reach. The trigger route under *Drawbacks* is the alternative rejected, not one left open
   for a later RFC. What core holds of a step is named for what it is to the runtime, `target` and `at`; the storage
   words stay in the plugin's own `Step`.
3. **`ensure` adopts.** A table `ensure` finds unrecorded is adopted as an additive step and the start goes on,
   logging it: a table `ensure` built is a table it knows, and the alternative, refusing `drift` there, would stop
   every existing deployment's first start after this RFC lands.

During implementation:

- The exact casts `retype` attempts per pair of types on postgres, and which pairs are refused outright rather than
  counted; the suite judges behaviour.
- Whether `by` records the operating-system user and host, as written, or a `--by` flag an operator's pipeline
  fills; a pipeline running as `deploy` on a random host may want to say `release 1.4.2`.
- Whether the memory engine records within the process, so that a test of `wilanis migrate --history` needs no
  database; a fake `Engine` in the plugin's tests serves the same purpose and is what the plan above assumes.
- The `--json` envelope's exact field names, settled beside RFC 0019's when the two meet in code.
- Whether `--allow-destructive` names a collection alone, as written, or the pair of connection and collection: a
  table is the pair (RFC 0002), and two connections of one tree may each hold a `notes`.
