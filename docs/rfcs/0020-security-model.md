# RFC 0020: The security model: what is guaranteed, what is enforced, what is the application's

- **Status:** draft (stub)
- **Milestone:** 1.0: published
- **Areas:** `area:process`, `area:compiler`, `area:runtime`
- **Tracking issue:** #NNN
- **Depends on:** RFC 0007 (invariants), RFC 0016 (capabilities)

## Summary

A document, not code, published with 1.0: three lists saying what the checker guarantees about any tree it
accepts, what the runtime enforces while it runs, and what remains the application's responsibility. The
clearer the boundary, the easier it is to trust a tree an agent wrote.

## Motivation

The README states pieces of the model in passing: a JSON file cannot open a socket, a feature reaches only
the effects it allows, a trigger with no policies is public, validating a credential happens in the guard and
never in a graph. A reviewer, an auditor or a contributor deciding where a new check belongs has no one page
that says which of these are proofs and which are promises. The report's item 23 asks for exactly this
page, and it belongs with the first published version because it is the claim the version makes.

## Sketch

`docs/security-model.md`, with three sections and one sentence per line:

- **Guaranteed by the checker** (a tree that passes `wilanis check` has these properties, and a test in
  `packages/runtime/test/example.test.ts` sabotages each): every reference resolves; every value fits the
  type declared for it; a document's layer is its directory; a domain graph reaches no effect; a data graph
  reaches only the effects its feature allows; every trigger maps every refusal it can reach; `request.*` is
  read in three places only; a `required` resolver is guaranteed by a policy or a kind; the invariants of
  RFC 0007 that the checker proves; the permits of RFC 0016.
- **Enforced by the runtime** (true of every run, not proved of the tree): the guard verifies a credential
  before any graph runs; a secret is redacted from every report; a blob's bytes never enter the engine; the
  deadline and limits of RFC 0012; what a startup step refuses stops the start.
- **The application's** (nothing above helps): a business invariant the checker cannot express; the
  behaviour of an external system a connection reaches; the truth of a directory the guard trusts; the
  contents of a raw storage operation (RFC 0002's escape hatch).

Then the one statement the whole model rests on: a document can never run code. There is no node that
evaluates a string, no plugin hook a document reaches, and adding one is a change to this document first.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

A document. Every later RFC that adds a guarantee or an enforcement adds a line here.

## Drawbacks and alternatives

A published model is a promise that can be broken by a bug, and the page must say what a reader should do
when it is (a security contact, a disclosure policy). The alternative is to keep the claims scattered in the
README, which is where they are.

## Open questions

- Does the model name threats it does not address (a compromised plugin package, a hostile include) as a
  fourth list, or leave the supply chain to `CONTRIBUTING.md`?
- Is each guaranteed line tied to its refusal code in the text, so the page doubles as the index of codes?
- Who may change the page: is an edit to it an RFC of its own?
