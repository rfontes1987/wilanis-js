# board

A wilanis project: a task board whose routes talk to a PostgREST-shaped database API. Everything in this
directory is JSON; `package.json` installs the runtime and the one plugin package it uses.

```
npm install
npm run check            # wilanis check .
npm run rehearse         # every trigger once, effects stubbed
npm run digest           # wilanis run @tasks/triggers/digest.trigger.json .
BOARD_DB_KEY=... BOARD_JWT_SECRET=... npm run serve
```

Inside the wilanis workspace this directory is a workspace member and resolves the packages locally.
Copied elsewhere, the same `package.json` installs them from npm.
