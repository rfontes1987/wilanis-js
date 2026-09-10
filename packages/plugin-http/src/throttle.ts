/**
 * The pacing behind a connection's `throttle` setting: at most `concurrency` requests in flight at once, at
 * most `perSecond` started in any one second. A request past either limit waits its turn; nothing is dropped.
 * One gate per connection, so every node that names the connection shares the same limit.
 */
export interface ThrottleSettings {
  concurrency?: number;
  perSecond?: number;
}

/** One connection's gate: it holds back a request until both limits allow it, and lets waiting ones through in turn. */
export class Throttle {
  private inFlight = 0;
  /** Requests waiting for a slot, woken one at a time as slots free up. */
  private waiting: (() => void)[] = [];
  /** When the requests of the last second started, oldest first. */
  private started: number[] = [];
  readonly concurrency: number;
  readonly perSecond: number;

  constructor(settings: ThrottleSettings = {}) {
    this.concurrency = settings.concurrency ?? Infinity;
    this.perSecond = settings.perSecond ?? Infinity;
  }

  /** Whether these settings would build the same gate. */
  same(settings: ThrottleSettings = {}): boolean {
    return (
      (settings.concurrency ?? Infinity) === this.concurrency && (settings.perSecond ?? Infinity) === this.perSecond
    );
  }

  /** How long until one more request may start: 0 now, Infinity once a slot frees up, else the milliseconds to wait. */
  private delay(now: number): number {
    if (this.inFlight >= this.concurrency) return Infinity;
    if (this.perSecond !== Infinity) {
      this.started = this.started.filter(at => now - at < 1000);
      if (this.started.length >= this.perSecond) return this.started[0] + 1000 - now;
    }
    return 0;
  }

  /** Run `fn` once the gate lets it through; the slot is held until it settles. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    for (;;) {
      const wait = this.delay(Date.now());
      if (wait === 0) break;
      if (wait === Infinity) await new Promise<void>(freed => this.waiting.push(freed));
      else await new Promise<void>(done => setTimeout(done, wait));
    }
    this.inFlight++;
    this.started.push(Date.now());
    try {
      return await fn();
    } finally {
      this.inFlight--;
      this.waiting.shift()?.();
    }
  }
}

/** Every gate in play, per environment then per connection, so a gate outlives the calls that share it. */
const gates = new WeakMap<object, Map<string, Throttle>>();
/** The gate of one connection under one environment: built on first use, rebuilt when its settings change. */
export function throttleFor(env: object, connection: string, settings: ThrottleSettings | undefined): Throttle {
  let byConn = gates.get(env);
  if (!byConn) {
    byConn = new Map();
    gates.set(env, byConn);
  }
  let gate = byConn.get(connection);
  if (!gate?.same(settings)) {
    gate = new Throttle(settings);
    byConn.set(connection, gate);
  }
  return gate;
}
