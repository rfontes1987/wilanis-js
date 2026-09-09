# RFC 0010: Scheduled triggers

- **Status:** draft (stub)
- **Milestone:** Production grade
- **Areas:** `area:runtime`
- **Tracking issue:** #NNN
- **Depends on:** none

## Summary

A trigger kind that fires on a schedule: a cron expression or an interval in its settings, a startup step
that `holds` the scheduler, and the same `fire` into a domain port operation every other trigger has.

## Motivation

A nightly digest, an hourly import, a cleanup of expired sessions: every service has a few of these, and
today the only way to run one is an external cron calling `wilanis run` on a CLI trigger. That works but
leaves the schedule outside the tree, invisible to `wilanis map`, the viewer and the manifest (RFC 0026).
The schedule belongs in the document that fires.

## Sketch

The closest precedent is the command trigger kind, `packages/runtime/docs/cli/cli.trigger-kind.json`: a
kind with almost no settings whose context hands what the caller gave. A `@schedule/schedule.trigger-kind.json`
ships with the runtime beside `@std` and `@cli`, since it carries no external dependency. Its `settings`
carry one of `cron` or `every`, and a `timezone`; its `context` hands `request.scheduled` (the tick's time),
`request.fired` (the actual time) and `request.missed` (ticks skipped since the last run). A trigger of this
kind has no policies: nobody is calling.

```json
{ "label": "Nightly digest", "kind": "@schedule/schedule.trigger-kind.json",
  "settings": { "cron": "0 3 * * *", "timezone": "UTC" },
  "in": "@monitor/edge/DigestRequest.shape.json", "out": "@monitor/edge/Digest.shape.json",
  "fire": { "run": "@monitor/domain/monitor.port.json#digest", "in": { "since": "{{request.scheduled}}" } } }
```

`@schedule/scheduler.port.json#run` is a `holds` operation a startup step names; it reads `env.serving` to
find every scheduled trigger in the tree and hands back its teardown. A tree that does not list it runs no
schedule, in keeping with "what a tree starts is declared". The engine stays clockless: the time is an input
handed by the kind, never read by a node, so `rehearse` and `regress` replay a tick deterministically.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds a trigger kind under `packages/runtime/docs/`; no schema changes. IR v1 unaffected.

## Drawbacks and alternatives

A schedule inside the tree runs once per process, so two instances fire twice; the honest answer until
RFC 0009 lands is that a scheduled trigger belongs on one instance, and the manifest says so. The
alternative kept the schedule out of the tree and documented the external cron; it loses discoverability.

## Open questions

- Overlap: when a tick fires while the previous run is still going, skip, queue or run concurrently? A
  setting, with a default the RFC must choose.
- Missed ticks after downtime: fire once with `request.missed`, fire each, or drop? The context field above
  assumes "once, and say how many".
- Multiple instances: is a lease in the storage plugin (RFC 0002) the way one instance wins, and does that
  make this RFC depend on 0002?
