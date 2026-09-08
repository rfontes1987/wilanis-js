# @wilanis/access

A wilanis tree to include: who is calling, and what they may do. Two sign-in routes that verify a credential
against directories and both end in the tree's *own* token; refresh and sign-out; preferences kept in a
session with typed attributes; the policies other features gate their triggers with; and the command that
gives a one-time challenge its code. Pure JSON, judged by `wilanis check` like anything else in the host.

```
npm install @wilanis/access @wilanis/plugin-auth @wilanis/plugin-http
```

```json
"includes": [{ "from": "@wilanis/access", "features": ["access"] }]
```

## What the host does

1. **Bind `@access/domain/identity.port.json`** to its directories, in a feature of its own. The port has four
   operations: `verifyCustomer` and `verifyEmployee` (a directory's verdict on a credential), `issue` and
   `refresh` (the tree's tokens). One delegation each is enough:

   ```json
   { "port": "@access/domain/identity.port.json", "operations": {
       "verifyCustomer": { "run": "@auth/identity.port.json#verify", "in": { "connection": "@connections/customers.connection.json" } },
       "verifyEmployee": { "run": "@auth/identity.port.json#verify", "in": { "connection": "@connections/employees.connection.json" } },
       "issue": { "run": "@auth/token.port.json#issue" },
       "refresh": { "run": "@auth/token.port.json#refresh" } } }
   ```

   The connections are the host's, of any directory kind `@auth` grants: accounts written in the connection
   for development, an OIDC issuer for production. `wilanis check` says B002 until the port is bound.

2. **Configure `@auth`** in `project.json`, with the session shape this tree ships and the `otp` method:

   ```json
   { "use": "@auth", "from": "@wilanis/plugin-auth", "settings": {
       "tokens": { "issuer": "...", "audience": "...", "secret": "{{secrets.jwt}}" },
       "session": "@access/domain/Session.shape.json",
       "challenge": { "methods": { "otp": { "obtain": "wilanis run @access/edge/issue-otp.trigger.json --challenge-id={id}" } } } } }
   ```

3. **Gate triggers** with the policies this tree exports, giving the guard the token where the trigger reads it:

   ```json
   "policies": [
     { "policy": "@access/edge/employees-only.policy.json", "in": { "token": "{{request.headers.authorization}}" } },
     "@access/edge/can-record.policy.json"
   ]
   ```

   `signed-in` allows any caller the token names; `employees-only` allows realm `employee`; `can-record`
   allows the `recorder` role; `otp-verified` allows a challenge answered on the call and challenges otherwise
   (`"in": { "challenge": { "id": "{{request.flags['challenge-id']}}", "code": "{{request.flags.code}}" } }`).
   A feature that attaches them declares `"dependsOn": ["access"]`.

## What it ships

- `POST /api/v1/auth-customers`, `POST /api/v1/auth-employees`: a username and password in, our token pair out,
  the access token also set as the `session` cookie. The sign-in graphs decide the realm (`customer`,
  `employee`) and write the directory's groups as roles; 401 as `bad_credentials`, 503 as `directory_unavailable`.
- `POST /api/v1/token/refresh`, `POST /api/v1/sign-out`, `GET|PUT /api/v1/me/preferences`.
- `Session.shape.json`: `displayName` and `realm` written at sign-in, `theme` written by the preferences route.
  `wilanis describe @access/domain/Session.shape.json` lists who writes what.
- `wilanis run @access/edge/issue-otp.trigger.json --challenge-id=XXXX-XXXX`: gives an open challenge its code
  and prints it. A production profile binds `access.port.json#deliverCode` to whatever delivers the code instead.

## On its own

This directory is a complete tree: `features/access-dev` binds `identity.port.json` to the directories written in
`connections/` (bo / bo-pass holds `recorder`, cy / cy-pass only `viewer`, ana / ana-pass is a customer), so
`wilanis check .`, `wilanis rehearse .` and `wilanis start .` work here with `MONITOR_JWT_SECRET` set. A host
that includes `["access"]` gets none of that: the dev feature and the connections stay behind.

Part of [wilanis](https://github.com/rfontes1987/wilanis-js). Apache-2.0.
