# @wilanis/plugin-auth

The `@auth` plugin for wilanis: the one plugin that identifies callers. It verifies a credential against a
directory, issues the tree's own tokens, keeps sessions with typed attributes and one-time challenges, and
guards every trigger that attaches a policy. What a caller may *do* is never decided here: that is a
policy's graph, and the graph never sees a raw credential.

```
npm install @wilanis/plugin-auth
```

```json
{ "use": "@auth", "from": "@wilanis/plugin-auth", "settings": {
    "tokens": { "issuer": "monitor", "audience": "monitor-api", "secret": "{{secrets.jwt}}", "accessTtl": 900, "refreshTtl": 604800 },
    "session": "@access/domain/Session.shape.json",
    "challenge": { "methods": { "otp": { "obtain": "wilanis run @access/edge/issue-otp.trigger.json --challenge-id={id}" } } } } }
```

## How a call is gated

A trigger attaches the **policies** that gate it, in order, and where it attaches one it gives the guard the
**credentials** it verifies, read from the kind's context like any input:

```json
"policies": [
  { "policy": "@access/edge/employees-only.policy.json",
    "in": { "token": ["{{request.headers.authorization}}", "{{request.cookies.session}}"] } },
  "@access/edge/can-record.policy.json"
]
```

`token` and `challenge` are the credentials this plugin's `plugin.json` declares, each with the type an
attachment must give and what it yields once verified (`principal` and `session` from a token, `challenge`
from an answer). A list is the places a credential may sit, the first present wins; a policy written bare
reuses what an earlier attachment gave. A trigger with no policies is public. On every fire of a gated
trigger, for every trigger kind alike, the runtime calls this plugin's guard:

1. **identify.** The token (a `Bearer ` prefix is stripped) is verified as one of *our* tokens -- signature,
   issuer, audience, expiry, a session that has not ended -- and the context gains `request.principal`
   (`subject`, `realm`, `roles`, `claims`) and `request.session` (`id`, `attributes`). A challenge answer
   (`{ "id": "{{request.flags['challenge-id']}}", "code": "{{request.flags.code}}" }`) is verified and handed as
   `request.challenge`. A credential that is there and does not verify is refused with `invalid_credential`,
   which every trigger giving one maps like any other reason (T005). No credential is not an error: the caller
   is anonymous, and the policies decide what that means.
2. **decide.** Each policy fires its domain operation with what it reads from the request
   (`{{request.principal}}`), and the graph behind it allows by answering or refuses with a reason;
   the policy's `outcomes` say whether that reason is a `deny` or a `challenge`.
3. **challenge.** When an outcome challenges, the guard opens a challenge -- an id, the method, an expiry,
   bound to the caller when one is known -- and the refusal carries it to the caller with `how`: what to do
   to obtain a code (the method's `obtain` text) and where this trigger reads the answer, in the kind's own
   words (`--challenge-id=K7Q2-M9XA --code=<code>`, or the headers).
4. **settle.** Once the operation ran, a challenge answered on that call is spent.

## Ports

- `@auth/identity.port.json#verify` judges a username and password against a directory connection and
  answers `status` (`verified`, `rejected`, `unavailable`) with the `identity` (`subject`, `name`, `groups`)
  when verified. The graph decides what a rejection means (`bad_credentials`), the way it decides what a 404 means.
- `@auth/token.port.json#issue` signs an access token (HS256, `sub`, `realm`, `roles`, `sid`) and opens its
  session with the attributes given; `#refresh` trades a refresh token for a new pair, spending the old one.
- `@auth/session.port.json#get`, `#set`, `#remove`, `#end` read and write a session's attributes -- typed by the
  shape `settings.session` names, judged at run time and by the checker (X103) -- and end a session, after
  which its tokens no longer verify. The session id reaches a data graph as `{{sid}}` through a resolvers
  document reading `request.session.id`, declared `required` and proven by the policy that gates the trigger (A006).
- `@auth/challenge.port.json#issue` gives an open challenge its code. A tree binds the domain operation that
  calls it to whatever delivers the code: printed in the example, mailed in production.

## Directories

- `@auth/directory.connection-kind.json`: the accounts written in the connection itself (username, `password`
  or `passwordHash` as `scrypt:<salt>:<hash>`, name, groups). Development and tests.
- `@auth/oidc.connection-kind.json`: an OpenID Connect issuer asked with the password grant; the identity
  token it answers is verified against its published keys, and the identity read from it. The caller then
  holds *our* token, never the issuer's.

A production profile binds the same domain port to another directory, and nothing else in the tree changes.

## Rules

X101 `settings.session` names no shape · X102 a challenge by an undeclared method, or a challenging policy on a
trigger no attachment of which gives a challenge answer · X103 a session write with a key the session shape
does not declare, or another type. The checker's own A004 and A005 judge the attachments: a credential the
guard does not verify or the kind cannot hand, and a policy reading the caller on a trigger that gives nothing.

Sessions and challenges are files under `settings.store.dir` (default `.wilanis/auth`), so a server and the
`wilanis run` processes of the same tree share them. Depends on `@wilanis/core`, `@wilanis/engine` and `jose`.

Part of [wilanis](https://github.com/rfontes1987/wilanis-js). Apache-2.0.
