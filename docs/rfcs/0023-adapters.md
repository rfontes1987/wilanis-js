# RFC 0023: Adapters: search, email, payment

- **Status:** accepted
- **Areas:** three new packages (`area:plugin-email`, `area:plugin-payment`, `area:plugin-search`) and the example tree;
  nothing in core, the compiler, the runtime or the view
- **Schemas:** none change
- **Packages:** `@wilanis/plugin-email`, `@wilanis/plugin-payment`, `@wilanis/plugin-search`
- **Tracking issue:** #25
- **Depends on:** RFC 0011 for the two words every port here declares, `idempotent` and `key`, and for the rules that
  accept a retry over a keyed charge and refuse one over a mail: nothing here lands before its step 1 puts the words on
  `port.schema.json`. RFC 0030 takes the cache this RFC's stub held, and says why it is one word and not three nodes.
  RFC 0005 is the precedent this RFC declines to follow for a mail's memory, and says why. RFC 0009's queue, RFC 0014's
  `catch` and RFC 0021's lifecycle are what a tree reaches for around these effects; each is named where it applies, and
  none is needed to accept.

## Summary

A tree can send a mail, take a payment and search an index, each through a port a plugin
grants, over a connection of a kind that plugin grants, from a data graph, listed in `feature.json → effects` like any
effect. Three packages, one per service, each the shape `packages/plugin-http` already has: `docs/plugin.json`, one port
document, one connection kind per provider that needs no driver of its own, handlers in `src/`, a `check` for what only
that plugin can judge, and a `test/` that runs against a fake provider in every CI job and against the real one behind
an environment variable. What is new to the platform is not a mechanism but a contract said once, **what an adapter
is**: a port whose every operation says what repeating it does (RFC 0011), a connection kind whose secrets are marked
`secret`, a development kind that needs no account, and a maintenance bar a package meets or leaves the release order.
The example mails its one-time code instead of printing it; payment and search are specified in full and built when a
tree asks. A cache is not an adapter but a word on a node, and is RFC 0030's.

## Motivation

A tree talks to the world through connections, and today the world is HTTP (`@http`), files (`@blob`), a directory
(`@auth`) and, with RFC 0002, a database. Everything else a backend does -- send a receipt, charge a card, find
the entries whose URL mentions a word -- can be done today through
`@http/http.port.json#request` with an edge shape per response, and that stays available. But three things go wrong
when it is the only way.

**The checker cannot see what repeating does.** RFC 0011 gives an operation the words `idempotent` and `key`, and
`@http/http.port.json#request` declares itself idempotent for `GET`, `HEAD`, `PUT` and `DELETE` and nothing else: a
`POST` to a payment API is never retried, and a `POST` to a payment API *with an `Idempotency-Key` header* is not either,
because the key sits inside `headers` where no rule reads it (RFC 0011, *Drawbacks*, last item). RFC 0011 names the
payment adapter as the place where "a port whose contract has the key as a field of its own" declares it. Until it
exists, the one operation an author most needs to retry safely is the one the checker refuses to.

**A secret is a header.** An API key passed as `headers: { "authorization": "Bearer {{secrets.stripe}}" }` on the
connection is read as a secret (C001) and redacted where it appears; but which header is the credential, and that a
card token in a request body is one too, is nothing the http kind can say. A connection kind whose `secretKey` is
marked `secret: true`, and a port whose `source` is, says it once for every report and trace (`redact.ts`).

**The example prints its one-time code.** `libraries/access/features/access/edge/issue-otp.trigger.json` fires
`access.port.json#deliverCode`, whose graph gives the challenge its code and hands it back, and the CLI kind prints
whatever the trigger's `out` holds. Every document involved says this "stands in for delivery: a real tree binds
`deliverCode` to a graph that mails or texts the code". There is nothing in the workspace such a graph could run.

This RFC does not try to solve: a message queue (RFC 0009), a scheduler (RFC 0010), a lock or a lease (RFC 0010's
keeper); a cache (RFC 0030: one word on a data node, a data graph or an operation, over the one connection a project
names, lowered to the nodes it stands for; this RFC's stub held it and this RFC gives it up); a saga across a payment, a
shipment and a mail (RFC 0021 declines the construct and says how a record's lifecycle does the work); SMS, push or chat
delivery of a code (the same shape as mail, a package each, none asked for);
a payment *webhook* arriving from the provider (an http trigger with a signature to verify, which is the guard's
business under RFC 0020 and a later note on `@payment`); and a search *index declaration* as a document kind, which
would be a store's twin under RFC 0002 and is deliberately not added (*Drawbacks*).

## Guide-level explanation

**Adapter.** A plugin that reaches one kind of external service: a port with the operations the service is for, a
connection kind per provider with the provider's settings and secrets, and a development kind that runs with no
account. Every operation of an adapter's port is an effect (a data graph runs it, `feature.json → effects` lists it,
`rehearse` stubs it) and says, as RFC 0011 asks, what happens when it is called twice. `wilanis describe` prints
`granted by @<root> (@wilanis/plugin-<name>)` for each, as it does for `@http`.

### The one-time code, mailed

The example includes `@wilanis/access`, whose `deliverCode` answers the code to whoever runs the command. The example
does not rebind it: a binding meets a whole port, and nine of the ten operations are right as they are. It adds a
feature of its own, `example/features/codes/`, that asks access for the code and mails it. A connection:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Outgoing mail",
  "description": "Where the monitor's mail goes. In development every message is written under .wilanis/mail as one .eml file and one log line, and nothing leaves the machine; a deployment names the smtp kind or a provider's here.",
  "kind": "@email/log.connection-kind.json",
  "settings": { "from": "monitor@example.test", "dir": ".wilanis/mail" }
}
```

The data graph that sends, `example/features/codes/data/mail-code.graph.json`:

```json
{
  "$schema": "@wilanis/graph.schema.json",
  "label": "Mail a code",
  "description": "Data graph behind codes.mail: one message with the code and when it expires. The mail's id is answered so the caller can find it in the log; the code is not.",
  "in": "@codes/domain/CodeToMail.shape.json",
  "out": { "type": "@codes/domain/Mailed.shape.json", "from": ["sent"] },
  "nodes": [
    { "type": "@wilanis/node/run.schema.json", "id": "mailed", "label": "Send it",
      "run": "@email/email.port.json#send",
      "in": { "connection": "@connections/mail.connection.json", "to": ["{{in.to}}"],
              "subject": "Your monitor code",
              "text": "Your one-time code is {{in.code}}. It expires at {{in.expiresAt}}." } },
    { "type": "@wilanis/node/run.schema.json", "id": "sent", "label": "Which mail",
      "run": "@std/object.port.json#make",
      "in": { "value": { "id": "{{mailed.id}}" }, "type": "@codes/domain/Mailed.shape.json" } }
  ]
}
```

Around it, the pieces the layers ask for and nothing more: `domain/codes.port.json` with `deliver` (a challenge id and
an address in; the mail's id out) and `mail`; `domain/deliver-code.graph.json`, a domain graph whose `issued` node runs
`@access/domain/access.port.json#deliverCode` and whose `mailed` node runs `codes.port.json#mail` with the code it got;
`data/codes.binding.json` binding `deliver` to that graph and `mail` to the one above; `edge/mail-otp.trigger.json`, a
command reading `--challenge-id` and `--to`; and `feature.json` with `effects: ["@email/email.port.json#send"]` and
`dependsOn: ["access"]`; `project.json` gains the alias `@codes`. The profile `live` binds
`@codes/domain/codes.port.json` to the binding, and the `@auth`
settings' `challenge.methods.otp.obtain` now reads
`wilanis run @codes/edge/mail-otp.trigger.json --challenge-id={id} --to=<your address>`. The included `issue-otp`
command still exists and still prints, which is the access tree's development story and stays so; the host's `obtain`
text is the one a challenged caller sees. A real tree reads the address from its directory rather than a flag;
`@auth/Identity.shape.json` carries none today, and giving it one is the access library's step, not this RFC's.

`send` declares neither `idempotent` nor `key`, because no mail transport recognises a repeat, so RFC 0011 refuses a
retry over `mailed`:

```
G0n2  @features/codes/data/mail-code.graph.json#nodes/mailed
    retry over '@email/email.port.json#send', which declares neither idempotent nor key
    → a mail that failed may have been sent; drop retry, or record what was sent in a store and check it first
```

That hint is the whole of this RFC's position on mail and repetition: the tree says what was sent, in a store the
checker can see, or it does not retry. A worker that sends receipts off RFC 0009's queue does exactly that.

### A payment, the worked example of `key`

The monitor sells nothing, and a feature invented to exercise a plugin is the kind of feature `CLAUDE.md` says not to
add. The payment plugin's worked example is therefore the small tree under its own `test/tree/`, an `orders` feature
whose data graph charges:

```json
{ "type": "@wilanis/node/run.schema.json", "id": "charged", "label": "Charge the card",
  "run": "@payment/payment.port.json#charge",
  "retry": { "times": 2, "backoffMs": 500 },
  "in": { "connection": "@connections/payments.connection.json",
          "amount": "{{in.amountMinor}}", "currency": "eur", "source": "{{in.paymentMethod}}",
          "key": "order-{{in.orderId}}", "description": "Order {{in.orderId}}" } }
```

The retry is accepted: `charge` declares `"key": "key"`, the site gives it, and RFC 0011's `Judge.idempotentAt` answers
that the call is safe to repeat. The provider recognises the second try by the key and answers the first charge again;
the sandbox kind the tests run against does the same, which is how the promise is proven without an account. Write
`"key": "order"` instead -- a literal -- and the plugin refuses:

```
X0n2  @features/orders/data/charge.graph.json#nodes/charged/in/key
    key is the literal "order": every charge this node makes would be one charge
    → read the key from the order ({{in.orderId}}), so each order is charged once and each retry of it is not
```

`charge` **reports** a decline, it does not fail on one: `status` is `succeeded`, `pending` or `declined`, and a
`switch` on it routes to the refusal the domain declares (`card_declined`), the way `get-row.graph.json` decides what a
404 means. A network fault, a timeout or an unknown key is a fault, and RFC 0014's `catch` is how a graph says what
*no answer* means. `source` is marked `secret`, so a payment method token never appears in a report or a trace at any
level.

### Search

A search index is the last of the four and the one no tree has asked for. Its shape is fixed here so that when one
does, the package is a week and not a design: `@search/index.port.json` with `index` (put one record of a shape under
a key, into a named index), `remove` and `query` (a text query and a filter, answering the hits typed as the shape),
all `idempotent: true`, over `@search/memory.connection-kind.json` for development and a Meilisearch kind for a
cluster, since Meilisearch is open source and runs on the local cluster the roadmap already stands up (RFC 0024). The
example is unchanged by this RFC; a `q` on `GET /monitor` is the demo of the milestone that picks search up.

### What `describe` says

```
$ wilanis describe @payment/payment.port.json
port  @payment/payment.port.json
  file        node_modules/@wilanis/plugin-payment/docs/payment.port.json
  granted by  @payment  (@wilanis/plugin-payment)
  Taking and returning money through a provider. ...

  #charge (key: key): Charge a payment method once per key. ...
  #refund (key: key): Return some or all of a charge, once per key. ...
  #get (idempotent): One charge by the provider's id. ...
```

The `(key: key)` and `(idempotent)` marks are RFC 0011's `operationLine`; `granted by` is what `grantLine` prints for
every native document today.

## Reference

### Documents and schemas

**None.** No document kind, no field on an existing kind, nothing in `packages/core/schemas/`. The words an adapter's
ports use, `idempotent` and `key`, are RFC 0011's and land with it. A connection kind is a plugin's document, so
placement, `templates/CLAUDE.md` and `wilanis new` gain nothing; the template's paragraph on effects already says that a
data graph lists what it reaches.

What every adapter's documents have in common is stated here once, and each package's `docs/` meets it; RFC 0027's
fitness directory is where it becomes a claim the tests hold, if the maintainer decides so (*Open questions*). RFC 0030's
`@cache` meets the same list:

- every operation of the port is an effect (no `pure`), and declares `idempotent` (true or an expression) or `key`, or
  neither with a sentence in its `description` saying why a repeat is not recognised;
- every operation accepts `connection` as `static: true`, described as "a connection of a kind this plugin grants";
- every credential in a connection kind's settings is `secret: true`, and so is every accepted field that is one (a
  payment method token, a password);
- one kind of the plugin runs with no account and no server, and its `description` says it is the development one;
- no operation accepts or answers a `blob` except where the bytes are the point (a mail's `attachments`), and then it
  streams them from the registry and never buffers them (`fitness/a-blob-is-never-read-whole.fitness.ts` already
  holds this).

### Ports, operations and kinds granted

Every package: `docs/plugin.json` (label, description, `grants.ports`, `grants.connectionKinds`, `grants.shapes`, and
plugin `settings` where said), `docs/<name>.port.json`, one `docs/<kind>.connection-kind.json` per kind. The X code
placeholders (`X0n1`) follow RFC 0009's convention: each plugin takes a band of its own when it lands, as RFC 0002
gave `@storage` X2xx.

**`@wilanis/plugin-email`, root `@email`.** `docs/email.port.json`, "Send mail through a connection. `send` executes
and reports: which recipients the transport accepted and which it rejected are answered, not thrown, the way `@http`
answers a status. It fails only on the unexpected: the transport unreachable, a refused login, a body it cannot build."

| Operation | Accepts | Returns | Declares |
|---|---|---|---|
| `send` | `connection` (static), `to` (string[]), `cc`, `bcc` (string[], optional), `replyTo` (string, optional), `from` (string, optional: "absent: the connection's"), `subject` (string), `text` (string, optional), `html` (string, optional), `attachments` (`blob[]`, optional), `headers` (open object of strings, optional) | `{ id: string, accepted: string[], rejected: string[] }` | neither; description: "no transport recognises a repeat; a tree that must not send twice records what it sent in a store and checks it first" |

`id` is the transport's message id, or one the plugin minted for a kind that has none, and it is what the log line
carries. An attachment streams from the blob registry into the transport as the body is written; the handle's
`filename` and `contentType` name the part. Kinds: `docs/log.connection-kind.json`, settings `from` (string,
required), `dir` (string, optional: a directory relative to the tree's root where each message is written as
`<id>.eml`; absent: the log line alone), the development kind, no secret, nothing leaves the process;
`docs/smtp.connection-kind.json`, settings `host` (string), `port` (number, optional, default 587), `secure` (boolean,
optional: TLS from the first byte; default false, STARTTLS when offered), `username` (string, optional), `password`
(string, optional, `secret`), `from` (string), `timeoutMs` (number, optional). The transport is `nodemailer`, this
package's one dependency. A provider that speaks HTTP (Postmark, Resend, SendGrid) is a kind in this package when a
tree asks, implemented on `fetch`, one file each; a provider that brings an SDK (SES) is a package of its own.

**`@wilanis/plugin-payment`, root `@payment`.** `docs/payment.port.json`, "Taking and returning money through a
provider. A charge or a refund is recognised by its `key`: the same key is the same charge, however many times the call
is made, which is what lets a retry be safe. A decline is reported in `status`, never thrown; a fault is the provider
unreachable or a key the provider knows with different inputs." Shapes, layer `edge`: `docs/Charge.shape.json` (`id`,
`status` enum `succeeded | pending | declined`, `amount`, `currency`, `declineCode?`, `description?`, `createdAt`) and
`docs/Refund.shape.json` (`id`, `charge`, `status` enum `succeeded | pending | failed`, `amount`, `createdAt`).

| Operation | Accepts | Returns | Declares |
|---|---|---|---|
| `charge` | `connection` (static), `amount` (number: minor units, a whole number above 0), `currency` (string: three letters, lower case), `source` (string, `secret`: "a payment method token the provider's client minted; never a card number"), `key` (string: "the idempotency key; one per thing being paid for, read from it"), `description` (string, optional), `metadata` (open object of strings, optional) | `@payment/Charge.shape.json` | `key: "key"` |
| `refund` | `connection`, `charge` (string: a charge id), `amount` (number, optional: "absent: what remains"), `key` (string) | `@payment/Refund.shape.json` | `key: "key"` |
| `get` | `connection`, `id` (string) | `@payment/Charge.shape.json` | `idempotent: true` |

Kinds: `docs/sandbox.connection-kind.json`, settings `declines` (string[], optional, default `["tok_declined"]`: the
source tokens that decline, with `declineCode: "generic_decline"`), `pending` (string[], optional: the tokens that
answer `pending`): charges kept in one map per connection per process, keyed by `key`, so a second `charge` with the
same key answers the first charge and the same key with a different `amount` is a fault, exactly as the reference
provider behaves; the development kind and the one the shared suite runs against. `docs/stripe.connection-kind.json`,
settings `secretKey` (string, `secret`), `apiVersion` (string, optional), `timeoutMs` (number, optional): PaymentIntents
created and confirmed in one call with the `Idempotency-Key` header set to `key`, `requires_action` answered as
`pending`, a card error as `declined` with the provider's `decline_code`; a refund is a Refund object with the same
header; `get` retrieves the intent. The API is plain HTTPS and form encoding, so the kind is a file in this package
with no SDK. Stripe is the reference because it is the provider whose idempotency contract RFC 0011 modelled `key`
on, and because its test mode is free and needs no business; another provider is a kind here (plain HTTP) or a
package (an SDK), on the same suite.

**`@wilanis/plugin-search`, root `@search`.** `docs/index.port.json`, "Records of a shape in a named index, found by
text. `index` and `remove` are safe to repeat; `query` reads the index as it stands."

| Operation | Accepts | Returns | Declares |
|---|---|---|---|
| `index` | `connection` (static), `index` (string, static: the index name), `key` (string), `record` (`$R`), `type` (type, binds `$R`) | `{ key: string }` | `idempotent: true` |
| `remove` | `connection`, `index` (static), `key` | `{ removed: boolean }` | `idempotent: true` |
| `query` | `connection`, `index` (static), `q` (string), `filter` (open object, optional: field → value equality), `limit` (number, optional, default 20), `type` (binds `$R`) | `{ hits: $R[], total: number }` | `idempotent: true` |

Kinds: `docs/memory.connection-kind.json`, no settings: one map of indexes per connection per process, matching a
query by case-folded substring over every string field, the development kind and the suite's; `docs/meilisearch.connection-kind.json`,
settings `url` (string), `apiKey` (string, `secret`, optional), `timeoutMs` (number, optional): one Meilisearch index
per `index` name, `key` as the primary key, `filter` as a Meilisearch filter over attributes the plugin marks
filterable on first use. Plain HTTP, no SDK.

### Checker rules

The compiler gains none. Everything an adapter can be wrong about at check time is a fact only that plugin has -- which
kinds are its, what a key means to a charge, what one shape per index means -- and lives in its `check`, refused as
X against the calling document at the input's path. What every rule shares, "the `connection` this site names is of a
kind this plugin grants", is the same shape in three packages and is judged from the plugin's own manifest
(`plugin.json → grants.connectionKinds`, read through `scope`), so no marker on the connection kind schema is needed
while every kind a plugin serves is its own. A site whose `connection` is a read rather than a literal is P001's
already (`static: true`).

`@email`, `packages/plugin-email/src/rules.ts`:

| Code | Refuses when | Hint |
|---|---|---|
| X0n1 | a `send` site's `connection` names a connection whose kind is not one `@email` grants | `name a connection of @email/log.connection-kind.json or @email/smtp.connection-kind.json` |
| X0n2 | a `send` site gives neither `text` nor `html` | `a mail has a body: write text, html, or both` |
| X0n3 | a literal address at a `send` site (`to`, `cc`, `bcc`, `replyTo`, `from`) or on a connection (`from`) is not `<local>@<domain>` | `write an address, or read one: {{in.to}}` |
| X0n4 | a connection of the smtp kind gives `username` without `password` or the reverse, or a `port` outside 1..65535 | `a login is a username and a password; port is 1 to 65535` |

`@payment`, `packages/plugin-payment/src/rules.ts`:

| Code | Refuses when | Hint |
|---|---|---|
| X0n1 | a payment operation's `connection` names a connection whose kind is not one `@payment` grants | `name a connection of @payment/sandbox.connection-kind.json or @payment/stripe.connection-kind.json` |
| X0n2 | the `key` at a `charge` or `refund` site is a literal | `read the key from what is being paid for ({{in.orderId}}), so each is charged once and each retry of it is not` |
| X0n3 | a literal `amount` is not a whole number above 0, or a literal `currency` is not three lower-case letters | `amount is minor units, a whole number above 0; currency is an ISO 4217 code in lower case: eur` |
| X0n4 | a `charge` site reads `source` from a field whose name suggests a card number (`card`, `pan`, `cardNumber`), at any depth of the path | `source is a token the provider's client minted; a card number never enters a tree` |

X0n4 is a heuristic and is said to be one in its message; it exists because the mistake it catches is the one that
costs a business its provider, and the cost of a false refusal is renaming a field.

`@search`, `packages/plugin-search/src/rules.ts`:

| Code | Refuses when | Hint |
|---|---|---|
| X0n1 | a search operation's `connection` names a connection whose kind is not one `@search` grants | `name a connection of @search/memory.connection-kind.json or @search/meilisearch.connection-kind.json` |
| X0n2 | two sites of one connection name the same `index` with different `type`s | `one index holds one shape; name a second index, or the same shape` |
| X0n3 | an `index` or `query` site's `type` is not a shape, or is a shape holding a `blob` | `an index holds records of one shape; index the handle's id, not the file` |
| X0n4 | a literal `index` name does not match `^[a-z][a-z0-9_-]{0,63}$` (Meilisearch's rule, applied to every kind so a tree carries between them) | `rename the index: lower case, digits, - and _, 64 characters at most` |

### Runtime behaviour

**Handlers.** Each package registers `'<port>#<op>'` handlers as `@http` does, reads the connection through the same
`env.connections[canon(named)]` lookup and refuses at run time with the same two errors (`unknown connection`, `is
<kind>, not <kind>`) for the case X0n1 could not see -- a connection replaced under a reload -- and reads the kind off
the connection to pick the implementation: `log.ts` or `smtp.ts`; `sandbox.ts` or `stripe.ts`; `memory.ts` or
`meilisearch.ts`. Every handler reads `ctx.signal` and stops when it
fires, so RFC 0011's `timeoutMs` and RFC 0012's deadline reach the transport; the http-speaking kinds compose it
with the connection's own `timeoutMs` as `send` in `packages/plugin-http/src/request.ts` does after RFC 0011.

**What is reported and what is thrown.** The rule is `@http`'s, applied three times: the service *answering* is an
answer, whatever it says; the service *not answering* is a fault. A rejected recipient is in `rejected`; a decline is
`status: declined`; an empty result is `hits: []`. A refused login, a socket that never opened, a 5xx from a provider's
API, a Stripe key the provider knows with different inputs (its `idempotency_error`) throw, the node faults, and
RFC 0014's `catch` is how a graph routes that. No handler here throws `Refusal`: a reason is the graph's to give, and
the operations of these ports are not marked `refuses`.

**Idempotency, made real by the kind.** The words on the port are promises the handler keeps. The sandbox payment kind
keeps `key → charge` and answers the stored charge for a repeat, faulting on a repeat with different inputs; the Stripe
kind sends the key as the `Idempotency-Key` header and lets the provider keep the promise. `search.index` under one key
replaces the record. `email.send` promises nothing, and the RFC's one sentence on how a tree gets the promise anyway is
the hint under *Guide*.

**Secrets.** A connection's `secret` settings arrive substituted (`{{secrets.*}}`, C001) and a handler never reads
`process.env`. `source` on `charge` is `secret: true`, so `redact.ts` strips it from every report and every trace level,
`wilanis.in` at `full` included; the `.eml` the log kind writes holds the message and nothing of the connection.

**Blobs.** `attachments` are handles; `smtp.ts` hands `nodemailer` a `Readable` from `blobs.open(handle)` per part and
`log.ts` streams each into the `.eml`. Neither reads a blob whole; the fitness function that holds this for `@blob`
gains the email package in its `gather`.

**`postLoad`.** The email and search packages have none: a map is made on first use, and an SMTP connection is
opened per message and closed after it (a pool is *Open questions*, third). The payment package's `postLoad` does one
thing for the Stripe kind: it asks the provider for the account behind `secretKey` and fails the start when the key is
a live key and the tree names a sandbox connection anywhere, or the reverse -- the one check that keeps a laptop
from charging a customer. It is a start-time check because it needs the network, and `wilanis check` runs with none.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** Unchanged, and this RFC adds no plugin stub hook. `stubEffects` in
`packages/runtime/src/stubbing.ts` replaces every effectful native handler before the plugin's is consulted
(`nativeHandler` in `packages/compiler/src/compiler.ts`), answering a value of the declared `returns`; so a stubbed
`charge` answers each of the three statuses on some seed, and the
solver (RFC 0018) reaches every branch a switch over them has. What the stub cannot model, the key's promise and a
decline for one token, is not a rehearsal's business: it is the sandbox *kind*'s, a real handler under `run` and
`start` and in the tests. RFC 0018 says nothing reaches a plugin during rehearsal, and this RFC keeps it so.

**`start`.** A tree that names an adapter and no connection of its kinds starts as today: no plugin here holds
anything. The example's startup gains no step; mail is sent when a command asks.

### Discoverability

- `wilanis describe <port>`: `granted by @<root> (@wilanis/plugin-<name>)` from `grantLine`, and RFC 0011's
  `(idempotent)` and `(key: <field>)` marks per operation; nothing new is printed.
- `wilanis describe <connection>`: the kind and its plugin, as today; a `secret` setting is a `{{secrets.*}}` read in
  the document, so what `describe` prints of it is the secret's name, as for `@auth`'s `clientSecret`.
- `wilanis ls connection-kind` lists the six kinds with their plugins.
- `wilanis map`: unchanged; a connection and a port are documents it already lists.
- The viewer's port and connection-kind pages (`renderDocPage`) show them with no change: the fields they carry are
  fields every port and kind has.
- Each package's README says: what the port answers and what it throws, each kind's settings and which is the
  development one, how the real-provider suite is run and by whom, and the owner who answers for the package.

### Plugin contract

`PluginModule`, `PluginCheckContext` and `PostLoadContext` in `packages/core/src/plugin.ts` are unchanged. Every
package uses `root`, `docs`, `handlers`, `check` and, for payment, `postLoad`. No `guard`, no `triggers`, no `codecs`.
The one contract this RFC adds is in prose, under *Documents and schemas*: what an adapter's documents say.

## Compatibility

Adds packages. Nothing in `packages/core/schemas/` changes, and IR v1 is untouched: a lowered graph carries an
operation path and its inputs, as it does for `@http`. The words `idempotent` and `key` that every port here declares
are RFC 0011's change, made once there; an adapter published before that change would not validate, which is why the
plan's first step is blocked on RFC 0011's. A tree that names none of the four plugins is unaffected in every way.

The example changes: a plugin entry, an alias, one connection, a feature and one edited `obtain` string.
It is a workspace member and not a published package, so nothing downstream sees the change; its tests are the
RFC's proof that the adapters compose with the http, blob and auth plugins already there. `@wilanis/access` is
unchanged: its `deliverCode` still answers the code, its `issue-otp` command still prints it, and its README's one
sentence about production delivery now has something to point at.

## Tests

Every adapter has a **shared suite** the way RFC 0002's engines do, one `test/suite.ts` per package, run against the
development kind in every CI job and against the real provider behind a variable, skipped when unset. That is the
maintenance bar the stub asked for, made mechanical: a kind is an implementation of the suite, or it is not a kind.

`packages/plugin-email/test/`:

- `log.test.ts`: `send` writes `<id>.eml` under `dir` with the recipients, subject and body, streams an attachment
  into it, answers every recipient as `accepted` and the same `id` the file is named by; without `dir`, one log line.
- `smtp.test.ts`: the suite against an in-process SMTP server (`smtp-server`, a devDependency of this package alone,
  in `test/harness.ts` as `fakeUpstream` is `@http`'s): a message is received whole with its attachment's bytes; a
  recipient the server rejects appears in `rejected`; a refused login faults; `ctx.signal` aborted mid-send faults;
  `from` on the site wins over the connection's.
- `otp.test.ts`: the example copied the way `localCopy` in `packages/plugin-http/test/harness.ts` copies it, with
  the mail connection's `dir` under the copy: fire `hello-gated` and receive the challenge; run `mail-otp` with the
  challenge id; read the code from the one `.eml` written; fire `hello-gated` again with `--challenge-id` and
  `--code` and receive the greeting; the report of `mail-otp` carries the mail's id and not the code.
- `rules.test.ts`: X0n1 to X0n4.

`packages/plugin-payment/test/`:

- `suite.ts`, run by `sandbox.test.ts` unconditionally and by `stripe.test.ts` behind `WILANIS_TEST_STRIPE_KEY` (a
  test-mode key; the suite refuses to run with a live one): `charge` answers `succeeded` with an id; the same key
  twice answers the same id and the provider holds one charge; the same key with a different amount faults; a
  declining token answers `declined` with a code and no charge stands; a pending token answers `pending`; `refund` of
  the whole and of a part, and a refund past what remains faults; `get` of a charge and of an unknown id (a fault);
  `source` is absent from the node's report.
- `tree.test.ts`: the `orders` tree under `test/tree/` checks clean, its `charged` node with the guide's retry is
  accepted, and a scripted sandbox that faults once makes the node `done` with one attempt and one charge.
- `postload.test.ts`: a Stripe connection with a live-shaped key beside a sandbox connection fails the start with the
  message; a test key does not (the account call answered by a fake in the harness).
- `rules.test.ts`: X0n1 to X0n4, over the `orders` tree.

`packages/plugin-search/test/`: `suite.ts` run by `memory.test.ts` unconditionally and `meilisearch.test.ts` behind
`WILANIS_TEST_MEILISEARCH_URL` (a service container in the CI `test` job, as RFC 0022 adds MySQL): `index` then `query`
finds by a word in any string field and not by a word in none; `filter` narrows; `limit` and `total`; `remove` then
`query` misses; `index` under one key twice is one record; two indexes are disjoint; a record that does not conform
faults. `rules.test.ts`: X0n1 to X0n4.

`packages/runtime/test/example.test.ts`: the example still checks clean with the codes feature; `describe` of the
email port prints `granted by @email`. `packages/core/test/validate.test.ts`: nothing; no schema changed.

## Implementation plan

Each step is one pull request and one sub-issue of #25. Steps 1 and 2 are the example's demo and make the RFC
`implemented`; 3 to 7 are specified here and scheduled by the roadmap, which gives this RFC a milestone when someone
picks it up (the demo: a challenged `hello` is unlocked from a code read out of `.wilanis/mail`).

1. **`@wilanis/plugin-email`** (`area:plugin-email`): the package, the port, the log and smtp kinds on `nodemailer`,
   streaming attachments, `log.test.ts`, `smtp.test.ts` with the in-process server, X0n1 to X0n4, a README. Added to
   `npm run release` after `plugin-auth`.
2. **The example mails the code** (`example/`): `mail.connection.json`, `features/codes/` as under *Guide*, the
   profile's binding, the `obtain` string, `otp.test.ts`. The fitness function on whole blob reads gains the email
   package.
3. **`@wilanis/plugin-payment`, the contract** (`area:plugin-payment`): the package, the port, the two shapes, the
   sandbox kind, `suite.ts` and `sandbox.test.ts`, the `orders` tree and `tree.test.ts`, X0n1 to X0n4, a README.
   Blocked on RFC 0011's step 1 (`key` on the port schema).
4. **The Stripe kind** (`area:plugin-payment`): `stripe.ts` on `fetch`, the idempotency header, the status mapping,
   the `postLoad` account check and `postload.test.ts`, `stripe.test.ts` behind the variable, the README's mapping
   table and the release checklist line ("the Stripe suite ran against test mode for this release, by <owner>").
5. **`@wilanis/plugin-search`, the contract** (`area:plugin-search`): the package, the port, the memory kind,
   `suite.ts` and `memory.test.ts`, X0n1 to X0n4, a README.
6. **The Meilisearch kind** (`area:plugin-search`): `meilisearch.ts` on `fetch`, filterable attributes on first use,
   the service container in CI, `meilisearch.test.ts`.
7. **Documents**: each README's owner line and how-to-run-the-real-suite section; the root README's sentence on
   adapters beside the plugin list; `docs/roadmap.md` gains the milestone when the maintainer schedules it.
   `good first issue`.
## Drawbacks and alternatives

- **Three packages to keep.** Each is a README, a release entry, a real-provider suite someone must run, and a
  dependency a tree installs. The stub said an abandoned adapter is worse than none; this RFC's answer is the shared
  suite and the owner line: a kind that does not pass the suite is not released, and a package whose owner line is
  empty is dropped from `npm run release` at the next release rather than shipped as a promise nobody keeps. The
  alternative -- `http.request` with an edge shape per response -- remains the right first move for any service not
  listed here, and the READMEs say so.
- **Mail declares neither `idempotent` nor `key`.** A `key` on `send` would need the plugin to remember what it sent,
  which is state, which RFC 0005 says lives behind a port the host binds: a required `@email/sent.port.json`, a
  binding to `@storage`, and a store the host declares -- for a promise SMTP itself cannot keep. The tree that needs
  it writes the store and the check as two nodes it can read; the checker sees both; and RFC 0011's refusal of a
  retry over `send` is what makes the author write them.
- **Stripe in the base package.** A provider kind in the same package as the contract is against RFC 0002's grain,
  where every engine is a package. The difference is the driver: an engine brings one, and the trees that name the
  memory engine should not install PostgreSQL's; the Stripe kind is one file on `fetch` and brings nothing. The line
  is stated once under *Ports*: a kind that needs no dependency beyond the package's own is a file in it, a kind that
  brings a client library is a package. SES and Elasticsearch are packages by that line; Postmark, Resend and
  Meilisearch are files.
- **Search before anyone asked.** Specifying it costs a section and settles the two decisions that would otherwise be
  made in a hurry: no index document kind (a store's twin would need RFC 0002's whole apparatus, `ensure` included,
  for a service that rebuilds from the store it mirrors), and one shape per index, judged across sites (X0n2) rather
  than declared. Building it costs steps 7 and 8, scheduled by the roadmap.
- **X0n4 on payment is a heuristic.** Refusing a field by its name is not the checker's style; every other rule here
  reads a fact. It stays because a card number in a tree is the one mistake with a regulatory cost, the message says
  it is a heuristic, and the fix is a rename.
- **No plugin stub hook.** A payment stub that modelled the key's promise during rehearsal would need
  `PluginModule.stub`, the first hook a document does not name. The sandbox kind does the modelling under `run`,
  `start` and the tests, and rehearsal keeps RFC 0018's rule that nothing reaches a plugin.
- **The `postLoad` account check needs the network at start.** A tree behind a firewall that blocks the provider
  fails to start rather than failing its first charge. That is the right failure, and the check is one request.

## Open questions

None before `accepted`.

**Settled here, so the reasoning survives the stub.**

- **A cache is not an adapter.** The stub held one; this RFC gives it to RFC 0030, where it is one word on a data
  node, a data graph or an operation, lowered to the nodes it stands for, over the one connection a project names.
  What stays here is the adapter contract, which RFC 0030's plugin meets.
- **One `@email` port, kinds per provider, the split by dependency.** The stub asked whether providers are kinds of one
  plugin, as `@auth` has `directory` and `oidc`, or a plugin each. Both, by one rule: a provider that needs only
  `fetch` is a kind in the package; one that brings a client library is a package registering against the same port.
  The port is one because the contract is one -- a mail is a mail whoever carries it -- and a tree swaps providers by
  swapping a connection's `kind`, as it swaps engines.
- **Stripe is the reference, and the suite assumes no account.** The sandbox kind runs the suite in every job; the
  Stripe kind runs it in test mode behind a variable a maintainer holds, before a release, and the README's owner
  line says who. CI carries no provider credentials.
- **Search has a shape and no schedule.** The port, the two kinds and the four rules are fixed above; the package is
  built when a tree asks, and the example stays as it is until then.

**Left to implementation, deliberately:** how a kind shipped by another package says which port it serves. Every
X0n1 here reads the plugin's own `grants.connectionKinds`, which is enough while every kind an adapter serves ships in
its package, and every kind this RFC specifies does. The first that does not -- an SES kind for `@email`, an
Elasticsearch kind for `@search`, RFC 0030's Redis kind -- needs a fact a document states, and the recommended shape
is one field on `connection-kind.schema.json`, `serves` (a port path), that says the same thing for every adapter
and, retroactively, for `@http` and `@auth`, making the run-time check in every `connectionOf` a check-time one; a
marker per adapter (`email: true`, three booleans by the end) is the alternative. It is a core schema edit and a
pull request of its own when that first kind is written, and nothing specified here waits on it. Also: whether the
smtp kind pools connections or opens one per message (one per message first; a pool when a tree sends enough to
notice, and then a setting on the kind); whether the log kind's `.eml` is RFC 5322 enough for a mail client to open
(the test opens it with `mailparser`, which settles it);
the Meilisearch filterable-attributes call's timing; and whether the three X0n1 rules and the "adapter contract" list
under *Documents and schemas* become a fitness function (RFC 0027), which is the maintainer's `Decision:` to write.
