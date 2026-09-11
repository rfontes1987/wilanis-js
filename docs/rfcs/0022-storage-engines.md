# RFC 0022: More storage engines: SQLite, MySQL, and declared capabilities

- **Status:** accepted
- **Areas:** `area:plugin-storage` (two engine packages, the capability vocabulary, `capabilitiesOf`), `area:core` (one
  optional block on the connection-kind schema: `capabilities`), `area:compiler` (RFC 0003's constraint rule gains the
  fact it reads), `area:runtime` (`describe`), `area:view` (the kind page)
- **Schemas:** adds the optional `capabilities` to `connection-kind.schema.json`, required where `storage` is true
  (compatible in fact, RFC 0008: no storage kind is published yet; see *Compatibility*)
- **Packages:** `@wilanis/plugin-storage-sqlite`, `@wilanis/plugin-storage-mysql`; `@wilanis/plugin-storage`,
  `@wilanis/plugin-storage-memory` and `@wilanis/plugin-storage-postgres` gain the block on their kinds
- **Tracking issue:** #24
- **Depends on:** RFC 0002 for everything (the `Engine` interface, `engines(env)`, the shared suite, the X bands: nothing
  here lands before that package does). RFC 0003 (the rule that refuses a `unique` or `refs` an engine cannot
  constrain reads its fact from here), RFC 0004 (`begin` on `Engine`, which this RFC makes the contract rather than a
  capability) and RFC 0017 (`transactionalDdl`, which its planner already reads) are the RFCs whose words this one
  supplies; they accept without it. RFC 0009's `delivery` and RFC 0010's `leases` marks are what the new kinds declare
  last, blocked on those RFCs' storage steps.

## Summary

A tree can keep its records in a file. `@wilanis/plugin-storage-sqlite` grants
`@storage-sqlite/sqlite.connection-kind.json`, one setting (`file`), no server, no setup; swapping the example from
memory to a database that survives a restart is one line of one connection document. `@wilanis/plugin-storage-mysql`
grants `@storage-mysql/mysql.connection-kind.json` for the trees that already have a MySQL. Both are engines exactly
as RFC 0002 defines one: a package depending on `@wilanis/plugin-storage` for the contract, registering from
`postLoad`, passing the shared suite, refusing in an X band of its own. What is new to the platform is one block on
every storage connection kind, **`capabilities`**, which says the three facts about an engine that a rule somewhere
reads -- whether its DDL is transactional, which field types a `unique` may name, whether it enforces `refs` -- so
that a tree learns at `wilanis check` time, not in production, that its engine cannot honour a declaration.
Transactions are not in the block: every engine can open one, or it is not an engine.

## Motivation

RFC 0002 made an engine a plugin and promised that "a tree can carry an engine we never wrote". Two things are still
missing for that promise to be more than a shape of the code.

The first is the second engine. The memory engine keeps nothing across a restart, which is right for a test and wrong
for a developer who stops the server, edits a graph and starts again expecting yesterday's entries. PostgreSQL keeps
them, and asks for a server, a URL, a secret and a running process before the first `put`. Between the two is what
every framework's development story ends up being: one file, deleted with `rm`, copied with `cp`, opened with any
SQLite tool, and real enough that a `unique` violation or a `refs` restriction is the same answer it will be in
production. Today the suite that says "this is an engine" runs for real only behind `WILANIS_TEST_POSTGRES_URL`, so a
contributor without a database runs the memory engine and trusts. SQLite runs the suite in every CI job with nothing
to provision -- and with it RFC 0004's atomic suite, RFC 0003's constraints, RFC 0015's scope cases and RFC 0017's
planner, each of which is written against a real database and currently has one only where a variable is set.

The second is the vocabulary. Three RFCs already lean on a fact about the engine that no document states. RFC 0017
says a plan is one transaction "where the engine can" and names `transactionalDdl` as this RFC's word. RFC 0003 has a
rule, `a unique or refs entry names a field an engine cannot constrain`, with nothing to read. RFC 0004 lets a graph
declare `atomic` and RFC 0021 wonders aloud whether every connection "can carry that". Each of those is, today, a
sentence in prose about PostgreSQL. Kysely speaks several dialects, and the temptation is to promise them all on the
first day and let the differences surface as run-time failures. This RFC takes the opposite bet, as the stub did: the
differences that matter are few, they are declared by the kind document an author can open, and the rules that read
them refuse before anything runs.

This RFC does not try to solve: swapping a connection's kind per profile (RFC 0005 and RFC 0013 own that; here a
connection names one kind for every profile, and the guide shows the one-line edit); anything about SQL a document
could see (there is no raw operation, RFC 0002); engines that are not relational (a key-value store or a document
database is a plugin like these, and the block is what lets it say `unique: []` honestly); and which engine a fresh
tree gets from `wilanis init`, which is the template's decision, not this RFC's.

## Guide-level explanation

**Engine.** Unchanged from RFC 0002: a plugin that grants a connection kind marked `storage` and registers an
`Engine` for it. A store names a connection; the connection names a kind; the kind is the engine.

**Capabilities.** Three facts a storage kind states about its engine, in its own document, that the checker and the
planner read. An author never writes them: they are in a plugin's `docs/`. An author meets them in a refusal, or in
`wilanis describe`.

The example's entries live in memory under RFC 0002. To keep them across restarts, edit
`example/connections/entries.connection.json`:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Entries",
  "description": "Where the monitor's entries are kept: one SQLite file under .wilanis, created on first start.",
  "kind": "@storage-sqlite/sqlite.connection-kind.json",
  "settings": { "file": ".wilanis/entries.sqlite" }
}
```

and name the plugin in `project.json → plugins`. Nothing else changes: not the store, not a graph, not a binding.
`wilanis start example` runs the `prepare` step, `ensure` creates the tables in the file, and the port opens.
`wilanis rehearse` never opens the file: rehearsal reaches no engine (RFC 0002), before this RFC and after it.

The kind document the connection names, `packages/plugin-storage-sqlite/docs/sqlite.connection-kind.json`:

```json
{
  "$schema": "@wilanis/connection-kind.schema.json",
  "label": "SQLite",
  "description": "One SQLite database in one file. The development database: no server, no secret, deleted with rm.",
  "storage": true,
  "capabilities": { "transactionalDdl": true, "unique": ["string", "number", "boolean"], "refs": true },
  "settings": {
    "fields": {
      "file": { "type": "string", "description": "The database file, relative to the tree's root; created if absent." }
    }
  }
}
```

Read the block top to bottom. A migration plan (RFC 0017) applies in one transaction, so a step that fails leaves
the file as it was. A `unique` (RFC 0003) may name a string, a number or a boolean field, and not a field that is a
shape, a list or `unknown`: those are kept as JSON, and equality of two JSON documents is not a business rule an
author meant to declare. `refs` are enforced: a note whose entry does not exist is refused, and so is removing an
entry that still has notes.

The refusal an author meets when a declaration asks more than the engine gives. Declare, over a MySQL connection,
`"unique": [["url", "meta"]]` where `meta` is a shape:

```
C0nn  @features/monitor/data/entries.store.json#collections/entries/unique/0/1
    'meta' is a shape; @storage-mysql/mysql.connection-kind.json constrains unique over string, number, boolean
    → wilanis describe @storage-mysql/mysql.connection-kind.json
```

The rule is RFC 0003's; what is new is that its message can name the kind and the kind's list, because the list is
written down. The same edit over the memory engine is not refused: memory constrains anything, and its block says
so.

What `describe` shows for the connection, one line more than RFC 0002 gave it:

```
$ wilanis describe @connections/entries.connection.json
connection  Entries
  kind          @storage-sqlite/sqlite.connection-kind.json  (granted by @storage-sqlite (@wilanis/plugin-storage-sqlite))
  capabilities  transactional DDL: yes; unique over: string, number, boolean; refs: yes
  settings      file  .wilanis/entries.sqlite
  stores        @monitor/data/entries.store.json (entries, notes)
```

MySQL is the same story with a URL. `example/connections/entries.connection.json` under a tree that has one:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Entries",
  "description": "The monitor's entries, in the team's MySQL.",
  "kind": "@storage-mysql/mysql.connection-kind.json",
  "settings": { "url": "{{secrets.entriesUrl}}", "pool": { "max": 10 } }
}
```

Its kind declares `"transactionalDdl": false`, and the one place that shows is `wilanis migrate --apply` (RFC 0017),
whose summary line reads `3 steps applied step by step` instead of `in one transaction`. Nothing an author writes
changes.

## Reference

### Documents and schemas

**No new kind.** One existing schema gains one block: `packages/core/schemas/connection-kind.schema.json` gains an
optional object `capabilities`, and a conditional that requires it where `storage` is true:

```
capabilities   object, additionalProperties false
  transactionalDdl  boolean   a migration plan applies in one transaction on this engine (RFC 0017); false: step by step
  unique            string[]  the field classes a `unique` may name (RFC 0003), from: string, number, boolean, shape, list, unknown; [] when the engine constrains nothing
  refs              boolean   the engine enforces `refs` (RFC 0003): a write naming a missing target and a remove of a referenced record are refused by the store
```

```json
"if": { "properties": { "storage": { "const": true } }, "required": ["storage"] },
"then": { "required": ["capabilities"] }
```

`ConnectionKindDoc` in `packages/core/src/model.ts` gains `capabilities?: StorageCapabilities`, and
`StorageCapabilities` is the one interface this RFC adds to core: `{ transactionalDdl: boolean; unique: FieldClass[];
refs: boolean }` with `FieldClass = 'string' | 'number' | 'boolean' | 'shape' | 'list' | 'unknown'`. The six words are
the six column classes RFC 0002's mapping already names (`string` → `text`, `number` → `double precision`, `boolean`
→ `boolean`, "a shape, a list, `unknown` → `jsonb`"); `blob` is not among them because no engine keeps one (X221,
and its siblings below). A field's class is answered by one function, `fieldClass(type)` in
`packages/core/src/types.ts`, so the compiler's rule and `describe` cannot disagree about which word a field is.

The block is required where `storage` is true, not merely allowed, for the reason RFC 0002 gave against per-feature
collection prefixes: an engine's limits would otherwise be a fact no document states. There is no default: a storage
kind without the block does not validate, and a plugin whose `docs/` carries one fails when the plugin loads, as any
plugin document that does not validate does. This is a broken plugin, never a broken tree.

Placement, `templates/CLAUDE.md`, `wilanis new`: nothing. A connection kind is a plugin's document; no author writes
one, and the template's rows describe what an author writes.

**The word, and RFC 0016's word.** RFC 0016 uses *capability* for an effect an environment permits, inherited from
the outside assessment that seeded both stubs. The two are not the same thing and this RFC does not pretend they are:
`profiles.<name>.permits` is what a profile allows a tree to do; `capabilities` on a storage kind is what an engine
can do. One is written by the tree's author about an environment; the other by a plugin's author about a database.
They never meet in a rule.

### Ports, operations and kinds granted

Nothing changes on `@storage/store.port.json` or `@storage/storage.port.json`: the operations, their `accepts` and
`returns`, `transactional: true` on the seven (RFC 0004), the `where` grammar. Every engine below answers them as the
shared suite says, and where a dialect's default disagrees with the suite -- MySQL's case-insensitive string
comparison, SQLite's case-insensitive `LIKE` -- the engine sets the dialect right, never the suite.

**Two existing kinds gain the block.** `@storage-memory/memory.connection-kind.json`:
`{ "transactionalDdl": true, "unique": ["string", "number", "boolean", "shape", "list", "unknown"], "refs": true }`,
every entry at its widest, which is the truth: it keeps any value, enforces `unique` and `refs` in `put` and `remove`
(RFC 0003), and has nothing to migrate (RFC 0017), so a plan of zero steps is trivially one transaction.
`@storage-postgres/postgres.connection-kind.json`: `{ "transactionalDdl": true, "unique": ["string", "number",
"boolean"], "refs": true }`. PostgreSQL *can* put a unique constraint on a `jsonb` column; this RFC says a storage kind
does not offer it, for the reason under *Guide*: two equal JSON documents is not a rule a domain holds, and every
engine saying the same three words means a store declaration carries from one engine to another unchanged.

**`@wilanis/plugin-storage-sqlite`**, `docs/plugin.json` grants `@storage-sqlite/sqlite.connection-kind.json`, shown
under *Guide*:

```
settings
  file    string, required    the database file, relative to the tree's root, created if absent
capabilities
  { "transactionalDdl": true, "unique": ["string", "number", "boolean"], "refs": true }
```

`file` is required, as `url` is on the postgres kind: a kind whose every setting is optional cannot say what it
needs. It is not a secret and reads none; a path is not what `{{secrets.*}}` is for. Relative paths resolve against
`PostLoadContext.root`, so a tree copied elsewhere carries its file. The plugin's own settings (`plugin.json →
settings`): `keyType` (string, optional, enum [`uuidv7`, `identity`], default `uuidv7`), as postgres has it, and
`busyTimeoutMs` (number, optional, default 5000: how long a writer waits for the file's lock before the node fails).
The driver is `better-sqlite3` behind Kysely's `SqliteDialect`, a dependency of this package alone.

**`@wilanis/plugin-storage-mysql`**, `docs/plugin.json` grants `@storage-mysql/mysql.connection-kind.json`:

```
settings
  url     string, secret, required    the connection URL, read as {{secrets.*}}; names the database
  pool    { max: number }, optional   the pool's size; default 10
capabilities
  { "transactionalDdl": false, "unique": ["string", "number", "boolean"], "refs": true }
```

No `schema` setting: a MySQL database *is* the schema, and the URL names it. The plugin's settings: `statementTimeout`
(number, optional, seconds) and `keyType`, as postgres has them. The driver is `mysql2` behind Kysely's
`MysqlDialect`. `transactionalDdl` is false because MySQL commits implicitly before and after every DDL statement;
it is the first engine where the word does work, which is why the MySQL package is specified here in full rather than
left to whoever asks for it.

**How a shape becomes a table**, per engine, in that engine's package and nowhere else. `@storage` never learns what a
column is (RFC 0002).

| Field | postgres (RFC 0002) | sqlite | mysql |
|---|---|---|---|
| `string` | `text` | `TEXT` | `TEXT`; `VARCHAR(768)` where the field is the key, in a `unique`, in a `refs`, or a scope (RFC 0015), since InnoDB indexes at most 3072 bytes and `utf8mb4` is four per character |
| `number` | `double precision` | `REAL` | `DOUBLE` |
| `boolean` | `boolean` | `INTEGER` holding 0 or 1, `CHECK (x IN (0, 1))` | `TINYINT(1)` |
| a shape, a list, `unknown` | `jsonb` | `TEXT` with `CHECK (json_valid(x))` | `JSON` |
| `blob` | refused, X221 | refused, X231 | refused, X241 |
| required | `NOT NULL` | `NOT NULL` | `NOT NULL` |
| key | `PRIMARY KEY` | `PRIMARY KEY` (`INTEGER PRIMARY KEY` for a `number` key under `identity`) | `PRIMARY KEY` |
| `unique` (RFC 0003) | one constraint | one constraint | one constraint |
| `refs` (RFC 0003) | `REFERENCES ... ON DELETE RESTRICT` | the same, with `PRAGMA foreign_keys = ON` on every connection the engine opens, since SQLite enforces nothing otherwise | the same, InnoDB |

Three dialect defaults disagree with the shared suite and are set right by the engine, so that `eq`, `unique`,
`contains` and `startsWith` mean what the memory engine means by them: MySQL text columns are created `COLLATE
utf8mb4_bin`, since the server's default collation compares case-insensitively and would make two records with
`"GET"` and `"get"` collide under a `unique`; the storage engine of every table is `InnoDB`, named in the `CREATE
TABLE`, since `refs` and transactions need it; and SQLite's `contains` and `startsWith` compile to `instr()` and
`substr()` rather than `LIKE`, whose ASCII case folding no suite case wants. Each of these is a line in the engine
and a case in the suite; none is a document, a rule or a capability.

`newKey` under `identity`: PostgreSQL reserves from a sequence (RFC 0002). SQLite has no sequences the engine can
draw from ahead of an insert, and MySQL's `AUTO_INCREMENT` answers only after one, so both keep one table,
`wilanis_keys` (`collection`, `next`), and reserve in a short transaction; the shared suite's `newKey` uniqueness
case is what judges it, and the table is created by `ensure` beside the engine's other bookkeeping tables (RFC 0010's
`wilanis_schedule`, RFC 0017's `wilanis_migrations`). Under `uuidv7` every engine generates the key in Node and the
table is never made.

**A capability that was in the stub and is not here.** The stub listed six words; this RFC keeps one of them and adds
two, and the reasons are the spec's cap on the list. A word earns a place in the block when a rule or a planner
reads it and would refuse or behave differently by it; a word that only says how an engine implements the same
behaviour is that engine's business and stays out.

- `transactions`: not a capability, the contract. RFC 0004 puts `begin` on `Engine` and both existing engines
  implement it; SQLite (`BEGIN IMMEDIATE`) and InnoDB do too. An engine that cannot open a transaction cannot be an
  engine, and RFC 0021's third open question -- whether a move over some connection must be refused for want of
  `atomic` -- is answered: no such connection exists.
- `returning`: MySQL has no `RETURNING`, and no document can tell. `put` answers "the record as stored", which is the
  record given (RFC 0003: a default never applies to what `put` writes); `patch` and `remove` read the row inside the
  same short transaction as the statement. The suite judges the answers, not the statements.
- `skipLocked`: RFC 0009 already has the word for whether a kind brokers, `delivery`, and a kind that cannot does not
  declare it. Whether a broker uses `FOR UPDATE SKIP LOCKED` (postgres, MySQL 8) or a single writer's `UPDATE ...
  RETURNING` (SQLite) is inside `broker.ts`. See *Runtime behaviour* for what the new kinds declare.
- `json`: every engine here keeps a shape, a list or `unknown` as JSON, and RFC 0002's grammar lets a filter test such
  a field only with `has`, so there is nothing an engine could lack that a document could ask for.
- `partialIndexes`: the stub imagined `unique` with a `where`. RFC 0003 accepted `unique` as lists of fields and settled
  *no `indexes`*; nothing in the language names a partial index, so no engine needs to say whether it has one.

### Checker rules

One rule gains its reading; six rules are new, in two bands; the compiler's families gain nothing. The count is the
design: a capability vocabulary that needed a family of rules over it would be a vocabulary the language was leaning
on too hard.

The compiler, RFC 0003's rule given its fact (its code is assigned when RFC 0003's implementing pull request lands):

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0nn (RFC 0003) | `checkStore`, `check/contracts.ts` (or `check/stores.ts` once split) | a `unique` entry names a field whose `fieldClass` is not in the connection's kind's `capabilities.unique`, or a collection declares `refs` and the kind's `capabilities.refs` is false; the kind is read through `scope.get('connection-kind', kind)` from the connection `Judge.connectionOf` resolves | `'<field>' is a <class>; <kind> constrains unique over <list>` / `<kind> does not enforce refs; check the target with a get, or move the store to a connection that does` |

Missing block on a storage kind: schema validation when the plugin loads (D001 family, existing), never a compiler
rule; the compiler may assume every kind it reads with `storage: true` carries one.

`@wilanis/plugin-storage-sqlite` (X23x), `packages/plugin-storage-sqlite/src/rules.ts`, the contract every engine
meets, in the shape RFC 0002 fixed for postgres:

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X231 | `rules.ts` | a collection kept over a sqlite connection has a `blob` field (bytes live in the blob registry) | store the handle's id as a string |
| X232 | same | a collection's key field is of a type this engine cannot key by (a shape, a list, `unknown`, boolean), or one `newKey` cannot answer under `keyType` (`identity` over a `string` key, `uuidv7` over a `number`) | set the plugin's `keyType`, or key by another field |
| X233 | same | a collection name is not a legal SQLite identifier, or two collections of one connection collide once folded to lower case (SQLite compares identifiers case-insensitively) | rename the collection |

`@wilanis/plugin-storage-mysql` (X24x), `packages/plugin-storage-mysql/src/rules.ts`:

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X241 | `rules.ts` | a collection kept over a mysql connection has a `blob` field | store the handle's id as a string |
| X242 | same | a collection's key field is of a type this engine cannot key by, or one `newKey` cannot answer under `keyType` (as X222) | set the plugin's `keyType`, or key by another field |
| X243 | same | a collection name is not a legal MySQL identifier, is longer than 64 characters, or two collections of one connection collide once folded to lower case (`lower_case_table_names` differs by host, so the engine assumes the strict case) | rename the collection |

No X rule reads the block. `@storage` has none to add either: the two facts a check-time rule reads are RFC 0003's,
judged in the compiler; the third, `transactionalDdl`, changes behaviour and not legality, so it is the planner's
(*Runtime behaviour*). The `unique` list is also not something an engine's rule repeats: an engine states it once in
its kind and the compiler refuses from there, or the same fact would live in two places.

### Runtime behaviour

**`capabilitiesOf`.** `@wilanis/plugin-storage` exports one function beside `engines(env)`, in
`src/capabilities.ts`: `capabilitiesOf(env, connection): StorageCapabilities`, the block of the kind the canonical
connection names, read through the registry. RFC 0017's planner calls it before `apply` and prints `in one
transaction` or `step by step` accordingly. `describe` does not call it: the runtime reads `capabilities` off the
loaded kind document (*Discoverability*), never a plugin's export, since the runtime sees a plugin through
`PluginModule` alone. No handler of `store.port.json` reads it: a capability never changes what `get`, `put` or
`find` mean.

**Registration and the version check.** Each new package's `postLoad` registers its engine exactly as RFC 0002 shows
-- `engines(ctx.env).register('@storage-sqlite/sqlite.connection-kind.json', makeSqliteEngine(ctx))` -- and, for
mysql, opens nothing until the first operation; its teardown destroys every pool it made. Then the one thing this RFC
adds to `postLoad`: before registering, an engine that has a server asks it its version and **fails the start** when
the server is older than what the kind's block assumes, with a message naming the version found and the version
required. The block is declared by the kind and not discovered from the server (*Open questions*), because
`wilanis check` runs with no connection open; the version check is what keeps a declaration honest against the
database actually reached. MySQL requires 8.0.16 (`SKIP LOCKED` for RFC 0009's broker since 8.0.1, functional
indexes since 8.0.13, enforced `CHECK` constraints since 8.0.16, `JSON`). PostgreSQL, retroactively, requires 12; RFC 0002's engine gains the same check in this RFC's first step. SQLite's
version is the package's own, since `better-sqlite3` bundles its library, and needs no check at run time: the
package's tests pin it (3.35 or later: `RETURNING` and `DROP COLUMN`).

**SQLite.** One `better-sqlite3` database per connection for every statement outside a scope, kept in a `WeakMap`
as postgres keeps its Kysely instance, opened on first use with `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys =
ON` and `PRAGMA busy_timeout = <busyTimeoutMs>`; the file's parent directory is created if absent, and the file too.
A `better-sqlite3` handle holds one transaction at a time and a `BEGIN` on a handle already inside one throws, so
`begin` (RFC 0004) opens a second handle on the same file with the same pragmas, runs `BEGIN IMMEDIATE` on it, and
closes it when the participant commits or rolls back: the transaction holds a handle the way postgres's holds a
connection (RFC 0004, *Who joins*), and a statement outside the scope never runs inside another run's transaction.
`BEGIN IMMEDIATE` takes the write lock at once, so a second atomic graph waits on the file, up to `busyTimeoutMs`,
rather than failing at commit; two concurrent atomic graphs therefore serialise at the file, which is what the atomic
suite's isolation case expects and what a single-file database is. The driver is synchronous: a statement runs to
completion on the event loop, and the engine checks `ctx.signal` (RFC 0012) between statements, not inside one. Over
a development database a statement is microseconds and this costs nothing; over a large file it is the price of
SQLite, said under *Drawbacks*.

**MySQL.** One pool per connection through `mysql2`, as postgres keeps one through `pg`. `begin` is `START
TRANSACTION`; `put` with `replace: false` is `INSERT IGNORE` and `conflict` is read off the affected row count;
`patch` and `remove` are an `UPDATE` or `DELETE` and a `SELECT` by key in one short transaction, since there is no
`RETURNING`. `apply` (RFC 0017) runs step by step, writing `wilanis_migrations` after each, because the kind says
`transactionalDdl: false`; the planner prints `applied step by step` and, on a failure, which step the record stands
at. `statementTimeout` becomes `SET SESSION MAX_EXECUTION_TIME`, which MySQL applies to reads alone; a write has no
server-side deadline, and the engine honours `ctx.signal` (RFC 0012) between statements, as every engine does, and
lets the statement in flight finish.

**What the new kinds declare beside `storage`.** RFC 0009's table broker and RFC 0010's lease keeper are "the storage
engine's": the postgres kind declares `delivery` and `leases` and registers both from `postLoad`. The sqlite and
mysql kinds do the same, in the last steps of the plan and blocked on those RFCs' postgres steps landing, so that
RFC 0009's promise -- "a tree with a store needs no second service" -- holds for a developer on one file as it does
in production. MySQL's broker is postgres's `SKIP LOCKED` receive; SQLite's is one `UPDATE ... WHERE id IN (SELECT ...
LIMIT n) RETURNING *` under `BEGIN IMMEDIATE`, which a single writer makes equivalent. Each is a page of the shared
broker and lease suites and nothing else. Until those steps land, the kinds declare `storage` alone and a tree names
`@queue-memory` for its queues in development, as RFC 0009 says.

**Rehearsal, fuzz, regress, `run --seed`.** Unchanged, and no engine is involved: every storage operation is an
effect, `stubEffects` answers it, and RFC 0002's rule that a rehearsal reaches no non-pure node is a fact of the
runtime this RFC neither touches nor wants to (*Open questions*, first).

**Start.** As RFC 0002: `postLoad` registers the engine (or fails the start on a server too old), the `prepare` step's
`ensure` creates what is missing, then the port opens. For SQLite the whole of "provisioning" is that the file now
exists.

### Discoverability

- `wilanis describe <connection>` gains the `capabilities` line under *Guide*: `transactional DDL: yes|no; unique
  over: <list or none>; refs: yes|no`, rendered by `describeCapabilities` in `packages/runtime/src/discovery.ts` from
  `capabilitiesOf`. `wilanis describe <connection-kind>` prints the same line under the kind's settings, and RFC
  0002's `granted by` stays where it is.
- `wilanis describe <store>` (RFC 0002) prints the connection's engine already; it gains nothing. A refusal is where
  a store's author meets a capability, and the refusal names the kind.
- `wilanis ls connection-kind` lists the two new kinds with their plugins, as it lists every kind a plugin grants.
- The viewer's connection-kind page (`renderDocPage`, `case 'connection-kind'` in `packages/view/client/index.html`)
  shows the block as three labelled facts under the settings, and a connection's page links to it.
- Each package's README says what its engine maps a shape to, the three facts it declares and why, and the server
  version it requires.

### Plugin contract

`PluginModule` in `packages/core/src/plugin.ts` is unchanged: both engines use `root`, `docs`, `handlers` (empty:
`@storage` owns the port), `check` and `postLoad` as they are. The `Engine` interface in
`packages/plugin-storage/src/engine.ts` is unchanged by this RFC; the members it has by then are RFC 0002's seven
and `ensure`, RFC 0004's `begin`, RFC 0015's `scope` parameter and RFC 0017's five, and both new engines implement
every one. What changes is the document a storage kind must carry (*Documents and schemas*) and one export of
`@wilanis/plugin-storage` (`capabilitiesOf`).

## Compatibility

One existing schema changes: `connection-kind.schema.json` gains the optional `capabilities` object and the
conditional that requires it where `storage` is true. Every kind document that omits `storage` validates and means
what it did -- `@http`'s, `@auth`'s, `@blob`'s kinds are untouched. For a kind marked `storage: true` the change is,
strictly, a tightening: such a document without the block no longer validates. In fact nothing breaks, because at the
address `main` serves no storage kind exists yet (RFC 0002 is accepted and unimplemented), and the three that will
exist are written in this repository and gain the block in this RFC's first step. Under RFC 0008 this is a v1 edit in
place, made while v1 may still change; after 1.0 the same tightening would be a `schemas-v2` matter, which is one
more reason it is done now. `ConnectionKindDoc` and the schema mirror each other as every kind's interface and schema
do, and `validate.ts` joins them.

IR v1 stays v1: no lowered form carries an engine, a kind or a capability. A tree's documents mean the same under
every engine; only what `ensure` and `apply` do differs, and that is what an engine is.

The example is unchanged in the repository: its `entries.connection.json` keeps the memory kind, so `npm test` needs
no native module and the tree behaves as RFC 0002 leaves it. The one-line swap under *Guide* is the example's README's
to show, and the sqlite package's test tree is where the file engine runs in CI.

## Tests

Every engine passes the same suite; that is what makes "this is an engine" one sentence with one meaning. The
sqlite package is the first engine to run it in every CI job without a service, which is the second half of this
RFC's motivation and is stated as a fact the workflow depends on.

`packages/core/test/validate.test.ts`: a connection-kind document with `storage: true` and the block validates; the
same without the block does not (the conditional); a block with a seventh word under `unique`, or an extra key, does
not; a kind without `storage` and without the block still validates (every existing kind).

`packages/plugin-storage/test/`:

- `capabilities.test.ts`: `capabilitiesOf` answers the memory kind's block for a connection of it, and throws naming
  the kind for a connection whose kind is not `storage`.
- `rules.test.ts` (RFC 0002 and RFC 0003's file) gains the C0nn sabotages this RFC gives a reading: a `unique`
  naming a shape field over the memory kind passes; the same over a small kind document the test ships with
  `unique: ["string"]` is refused naming the class and the list; `refs` over a kind with `refs: false` is refused.
  The test kind lives under the test directory, not under any plugin's `docs/`: no shipped kind constrains nothing.

`packages/plugin-storage-sqlite/test/`, all unconditional:

- `engine.test.ts`: RFC 0002's `suite.ts` against a file under the test's temporary directory; the file survives a
  second `loadTree` of the same tree (the point of the engine). No `:memory:` run: a transaction's handle would open
  a second, empty database (*Runtime behaviour*), and a database that forgets is the memory kind's.
- `atomic.test.ts`: RFC 0004's atomic suite, including two concurrent atomic graphs serialising at the file rather
  than one failing at commit.
- `constraints.test.ts`: RFC 0003's `ensure`, `unique` and `refs` cases, and that `PRAGMA foreign_keys` is on for
  every connection the engine opens (a `refs` violation is refused after a reopen).
- `scope.test.ts`, `planner.test.ts`: RFC 0015's scope cases and RFC 0017's plan, apply and drift cases, each behind
  that RFC's landing and unconditional once it has; a `retype` step rebuilds the table inside the one transaction
  and a failure midway leaves the file and the record as they were (`transactionalDdl: true`, proven).
- `rules.test.ts`: one sabotage per rule, X231 to X233.
- `pragmas.test.ts`: `contains` and `startsWith` are case-sensitive; `busyTimeoutMs` is honoured (a second writer
  waits, then fails the node with the lock message once the wait is up).
- `version.test.ts`: the bundled SQLite is 3.35 or later.

`packages/plugin-storage-mysql/test/`, behind `WILANIS_TEST_MYSQL_URL` and skipped when unset, as postgres is behind
its variable: `engine.test.ts` over the shared suite; `atomic.test.ts`; `constraints.test.ts` including that `"GET"`
and `"get"` are two records under a `unique` (the collation) and that a 769-character string in a `unique` field
fails the node before the write; `planner.test.ts` including a plan that fails at its second step leaving the record
at the first and the summary saying `step by step`; `rules.test.ts` for X241 to X243; `version.test.ts`: `postLoad`
against a server reporting an older version fails the start with the message, using `mysql2`'s connection wrapped to
lie about `SELECT VERSION()`. The `test` job in CI gains a MySQL service container so the variable is set there and
the suite runs on every push; a contributor without one still runs everything else.

`packages/plugin-storage-postgres/test/version.test.ts`: the same version check, retroactively, behind
`WILANIS_TEST_POSTGRES_URL`.

`packages/runtime/test/`: `describe` of a connection prints the capabilities line; `ls connection-kind` lists a kind
of a loaded engine plugin. `packages/view/test`: the kind page shows the three facts.

When RFC 0009 and RFC 0010's storage steps have landed, `broker.test.ts` and `leases.test.ts` in each new package run
those RFCs' shared suites, the sqlite ones unconditionally.

## Implementation plan

1. **The block, in core and on the three kinds that exist** (`area:core`, `area:plugin-storage`): `capabilities` and
   the conditional on `connection-kind.schema.json`, `StorageCapabilities` and `fieldClass` in core, the validate
   cases, the block on the memory and postgres kinds, `capabilitiesOf` in `@storage`, the postgres version check in
   its `postLoad`. Blocked on RFC 0002's steps 1, 4, 5 and 7.
2. **RFC 0003's rule reads it** (`area:compiler`): `checkStore` reads the kind through `Judge.connectionOf`, refuses
   over `unique` and `refs`, the two hints; the sabotages in `rules.test.ts` with the test-only kind. Blocked on RFC
   0003's `checkStore` extension.
3. **`describe` and the viewer** (`area:runtime`, `area:view`): `describeCapabilities`, the line on a connection and
   on a kind, the kind page. `good first issue` for the viewer page.
4. **`@wilanis/plugin-storage-sqlite`, the engine** (`area:plugin-storage`): the package, its kind with `file`, the
   plugin settings, `better-sqlite3` behind Kysely's dialect, the pragmas, the mapping, `ensure`, the seven
   operations, `instr`/`substr` for the string operators, `wilanis_keys` under `identity`, `engine.test.ts` over the
   shared suite unconditionally, `pragmas.test.ts`, `version.test.ts`. Workspace member; `npm run release` after
   `plugin-storage-postgres`.
5. **SQLite's rules** (`area:plugin-storage`): X231 to X233 and `rules.test.ts`. `good first issue` once step 4 lands:
   the postgres rules are the template, line for line.
6. **SQLite through the storage RFCs** (`area:plugin-storage`): `begin` and `atomic.test.ts` (RFC 0004),
   `constraints.test.ts` (RFC 0003), `scope.test.ts` (RFC 0015), the planner's five members with table rebuild for a
   `retype` and `planner.test.ts` (RFC 0017). Each sub-issue blocked on its RFC's `@storage` step; each makes that
   RFC's suite run in CI without a service for the first time.
7. **`@wilanis/plugin-storage-mysql`, the engine** (`area:plugin-storage`): the package, its kind with `url` and
   `pool`, `mysql2` behind Kysely's dialect, the version check, the mapping with `VARCHAR(768)` and `utf8mb4_bin`,
   `InnoDB` named, `INSERT IGNORE` and the short read-back transactions, `wilanis_keys`, `engine.test.ts` behind
   `WILANIS_TEST_MYSQL_URL`, the MySQL service in the CI `test` job. Scheduled by the roadmap, not by this RFC.
8. **MySQL's rules and its RFCs** (`area:plugin-storage`): X241 to X243; `begin`, constraints, scope, the step-by-step
   `apply` and the `step by step` summary line. `good first issue` for the rules once step 7 lands.
9. **Broker and leases on the new kinds** (`area:plugin-storage`): `delivery` and `leases` on both kinds,
   `broker.ts` and `leases.ts` in each package, the shared broker and lease suites. Blocked on RFC 0009's step 10 and
   RFC 0010's step 6.
10. **Documents**: each package's README (the mapping, the three facts and why, the version required, and for sqlite
    the one-line swap and `rm .wilanis/*.sqlite` as the whole reset procedure); the `@storage` README's paragraph on
    what an engine declares; the example's README showing the swap. `good first issue`.

## Drawbacks and alternatives

- **The matrix.** Every engine is a package, a README, a release entry and one run of every shared suite -- RFC 0002's
  port suite, RFC 0004's atomic, RFC 0003's constraints, RFC 0015's scope, RFC 0017's planner, and RFC 0009's and
  0010's when they land. Seven suites by four engines is the cost the stub warned of, and it is paid by design rather
  than by accident: the suites are the definition of a store, and an engine that ran fewer of them would be an engine
  in name. What keeps the product from growing along the other axis is the cap on the block: three words, each read
  by a rule that already exists, and a stated reason for every word the stub had that is not here.
- **A synchronous driver.** `better-sqlite3` blocks the event loop for the length of a statement and cannot be
  interrupted inside one; RFC 0012's cancellation reaches the engine between statements only. For the development
  database this RFC exists for, a statement is microseconds and the trade is right: the synchronous API is why the
  driver is fast and why its transactions are simple. A tree that serves production traffic from one SQLite file is
  not what this engine is for, and the kind's description says so. The alternative, `node:sqlite`, is in the runtime
  since Node 22.5 with no native build and the same synchronous shape; it is not chosen while its stability index is
  below stable, and switching later is a change inside one package that no document, rule or test outside it sees
  (the suite is the same). When it is stable, the switch is the right first issue of a release.
- **A native module in a workspace that had none.** `better-sqlite3` ships prebuilt binaries for every platform the
  workspace supports and compiles from source elsewhere. The cost lands on the trees that name the sqlite plugin and
  on this repository's CI, and on nobody else -- which is exactly the argument RFC 0002 made for one package per
  engine, and the first time it pays.
- **MySQL before anyone asked.** Specifying it costs a section and buys the first engine where `transactionalDdl` is
  false, so the planner's `step by step` path is written against a real database rather than imagined; the
  `VARCHAR(768)` rule and the collation are the kind of fact that is discovered late and expensively if the second
  SQL engine arrives after 1.0. Building it costs steps 7 and 8, scheduled by the roadmap.
- **`VARCHAR(768)` on constrained strings** means a MySQL store refuses a 769-character `url` under a `unique` that
  PostgreSQL and SQLite accept, at run time, by failing the node. The alternatives were worse: a prefix index
  (`UNIQUE (url(255))`) makes "unique" mean "unique in the first 255 characters", which is not what the document
  says; a hashed generated column keeps the meaning and hides a column no document names. A limit the engine states
  in its README and the suite pins is the honest one.
- **Declared, not discovered.** A block written in a kind document can be wrong about the server actually reached --
  an older MySQL, a PostgreSQL behind a pooler that breaks transactions. The version check at `postLoad` catches the
  first; the second is not this RFC's to catch and no capability would.
- **The word `capabilities`** collides with RFC 0016's. Renaming here (`engine`, `can`) was considered; the stub, RFC
  0017 and the outside assessment all use the word for this block, and one paragraph under *Documents and schemas*
  saying the two are different things costs less than a rename across three RFCs.

## Open questions

None before `accepted` that this RFC can see; the stub's three are answered here so the reasoning survives with the
spec.

**Settled here.**

- **Nothing reopens RFC 0002's rule that a rehearsal reaches no engine.** `wilanis run` against a SQLite file is a run,
  with a real store, and needs no rule; `rehearse` stubs every effect and needs no engine. There is no command
  between them and this RFC adds none: a "rehearse against a throwaway file" would be a run whose effects are
  forgotten afterwards, which is `rm .wilanis/*.sqlite`, and the sqlite README says exactly that.
- **Capabilities are declared by the kind, verified against the server at `postLoad`.** The checker runs with no
  connection open, so a discovered block could not be judged at check time, which is where every rule of this RFC
  lives; and a block that varies by server version would make the same tree pass on one database and refuse on
  another with no document changed. The engine asks the server its version before it registers and fails the start
  when the server is older than the block assumes. A capability is therefore the engine author's promise about every
  version the engine admits.
- **MySQL is specified now and built when scheduled.** The spec is what makes `transactionalDdl` a word with two
  values and finds the dialect facts (collation, index width, no `RETURNING`) while the interfaces are still cheap to
  change; the packaging waits for the roadmap. The RFC reaches `implemented` when steps 1 to 6 have landed; steps 7
  to 10 stay open sub-issues of #24.
- **Transactions are not negotiable.** `begin` is on `Engine` for every engine (RFC 0004), and an engine that cannot
  provide one is not an engine of this plugin. RFC 0021's question about a move on a connection that cannot carry
  `atomic` is thereby closed: there is none.
- **The example keeps the memory kind.** Its tests then need no native module, and which engine a fresh tree gets is
  the template's decision, not a side effect of an engine landing.

**Settled on acceptance.**

- **`describe` reads the document, not the plugin.** The draft had `describe` call `capabilitiesOf`;
  that is the runtime importing a plugin, against the one direction CLAUDE.md allows. The block is in the kind
  document the runtime already loaded, so `describeCapabilities` reads `doc.capabilities`, and `capabilitiesOf` stays
  what the planner inside `@storage` calls.
- **A SQLite transaction holds its own handle.** One handle per connection cannot carry two transactions, and a
  second `BEGIN` on it throws rather than waits; the "serialise at the file" promise holds only when `begin` opens a
  handle of its own. It follows that `:memory:` is not a supported `file`: a second handle on it is a second database.
- **MySQL's floor is 8.0.16**, not 8.0.1: functional indexes arrived in 8.0.13 and `CHECK` constraints are enforced
  from 8.0.16, and the block promises both.
- **RFC 0004's sentence** that an engine unable to `begin` "says so through its capabilities" is edited in the same
  pull request: every engine begins one, and RFC 0022 is where that became the contract.

**Left to implementation, deliberately.** The exact rebuild sequence for a SQLite `retype` (the documented
twelve steps, or the shorter `ALTER TABLE ... RENAME` dance, inside the one transaction either way); the
`busyTimeoutMs` default; and whether MySQL's `JSON` columns take `CHECK (JSON_VALID(x))` or rely on the type's own
validation. None changes a document, a rule, a schema or the plan; each is judged by the shared suite, and one that
turns out to need a rule gets it in that engine's band, the way any rule is added.
