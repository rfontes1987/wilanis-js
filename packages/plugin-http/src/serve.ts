/**
 * server.port.json#listen: the socket this tree answers its http triggers on. The routes are read from `serving` on
 * every request rather than captured once, so a reload can put a new tree behind a socket that stays open.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BlobStore, Hold, Serving, TriggerDoc } from '@wilanis/core';
import type { Handler, Report } from '@wilanis/engine';
import { compileRoute, encode, type HttpSettings, parseCookies } from './answer.js';
import { json, mediaType } from './codecs.js';
import { doc, ROOT } from './paths.js';

/** What a tree hands a held operation. */
type ServeEnv = { serving?: Serving; hold?: Hold; plugins?: Record<string, Record<string, unknown>> };

/** A route that may answer: its trigger, what the trigger declares, and the pattern its path must match. */
interface Route {
  trigger: TriggerDoc;
  settings: HttpSettings;
  re: RegExp;
  keys: string[];
}

/** How an answer is written: the codec table to encode with, and the scope a blob answer streams from. */
interface Writer {
  serving: Serving;
  scope?: BlobStore;
}

/** What an answer says. */
interface Answer {
  status: number;
  body?: unknown;
  produces?: string;
  cookies?: string[];
}

/** A blob answer is piped from the registry to the socket; a value is encoded and sent whole. */
/** What the codec wrote, as an answer's body. */
type Written = { body: Buffer | Readable; contentType: string; length?: number; headers?: Record<string, string> };

/** The headers one answer goes out with. */
function headersFor(written: Written, cookies: string[] | undefined) {
  const length = written.length ?? (written.body instanceof Readable ? undefined : written.body.length);
  return {
    'content-type': written.contentType,
    ...(length !== undefined ? { 'content-length': length } : {}),
    ...(written.headers ?? {}),
    ...(cookies?.length ? { 'set-cookie': cookies } : {}),
  };
}

/** A blob answer is piped from the registry to the socket; a value is encoded and sent whole. */
async function write(response: ServerResponse, { serving, scope }: Writer, answer: Answer) {
  const produces = answer.produces ?? 'application/json';
  const codec = serving.codecs(ROOT)[produces.toLowerCase()] ?? json;
  const written: Written =
    answer.body === undefined
      ? { body: Buffer.alloc(0), contentType: produces, length: 0 }
      : ((await codec.encode(answer.body, undefined, scope ?? serving.blobs)) as Written);
  response.writeHead(answer.status, headersFor(written, answer.cookies));
  if (written.body instanceof Readable) await pipeline(written.body, response);
  else response.end(written.body);
}

/** Every route this tree answers, read afresh so a reload is seen. */
const routesOf = (serving: Serving): Route[] =>
  serving.triggers(doc('http.trigger-kind.json')).map(trigger => ({
    trigger,
    settings: trigger.settings as unknown as HttpSettings,
    ...compileRoute((trigger.settings as unknown as HttpSettings).route),
  }));

/** The request's headers, lowercased, as a graph reads them. */
function headersOf(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers))
    if (typeof value === 'string') headers[name.toLowerCase()] = value;
  return headers;
}

/** The parts the route captured from the path. */
function paramsOf(route: Route, pathname: string): Record<string, string> {
  const found = route.re.exec(pathname);
  const params: Record<string, string> = {};
  if (!found) return params;
  route.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(found[index + 1] ?? '');
  });
  return params;
}

/** The query, by name. */
function queryOf(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, name) => {
    query[name] = value;
  });
  return query;
}

/** Whether the request carries a body at all. */
const hasBody = (headers: Record<string, string>) =>
  Number(headers['content-length'] ?? 0) > 0 || (headers['transfer-encoding'] ?? '').includes('chunked');

/** The body the route's codec reads from the request stream, or why it could not be read. */
async function readBody(
  request: IncomingMessage,
  route: Route,
  headers: Record<string, string>,
  { serving, scope }: Writer & { scope: BlobStore },
): Promise<{ body: unknown } | { refuse: Answer }> {
  const settings = route.settings;
  // a route that declares what it consumes takes nothing else; without a declaration the sender's content type decides
  const sent = headers['content-type'] ? mediaType(headers['content-type']) : undefined;
  if (settings.consumes && sent && sent !== mediaType(settings.consumes))
    return { refuse: { status: 415, body: { error: `this route consumes ${settings.consumes}, not ${sent}` } } };
  const contentType = settings.consumes ?? headers['content-type'] ?? 'application/json';
  const codec = serving.codecs(ROOT)[mediaType(contentType)];
  if (!codec) return { refuse: { status: 415, body: { error: `no codec for '${mediaType(contentType)}'` } } };
  // settings.body names the body's edge shape; without it the body IS the input. Either way the
  // declared shape judges what arrives, so a closed shape still refuses an undeclared field.
  const declared = settings.body === route.trigger.in || !settings.body ? serving.types(route.trigger).in : undefined;
  // the request stream itself goes to the codec: a blob body is written to the registry as it arrives
  try {
    return { body: await codec.decode(request, headers['content-type'] ?? contentType, declared, scope) };
  } catch (error) {
    return { refuse: { status: 400, body: { error: (error as Error).message } } };
  }
}

/** The request a graph reads, or why this one cannot be answered. */
async function requestOf(
  incoming: IncomingMessage,
  url: URL,
  route: Route,
  writer: Writer & { scope: BlobStore },
): Promise<{ request: Record<string, unknown> } | { refuse: Answer }> {
  const headers = headersOf(incoming);
  const carries = hasBody(headers);
  if (route.settings.body && !carries) return { refuse: { status: 400, body: { error: 'a body is required' } } };
  let body: unknown;
  if (carries) {
    const read = await readBody(incoming, route, headers, writer);
    if ('refuse' in read) return read;
    body = read.body;
  }
  return {
    request: {
      method: incoming.method,
      path: url.pathname,
      headers,
      query: queryOf(url),
      params: paramsOf(route, url.pathname),
      cookies: parseCookies(headers.cookie),
      ...(body !== undefined ? { body } : {}),
    },
  };
}

/** What one request is answered with: the route fires, gated by the runtime, and its report is encoded. */
async function answerFor(
  incoming: IncomingMessage,
  writer: Writer & { scope: BlobStore },
): Promise<Answer & { report?: Report; fired?: string }> {
  const url = new URL(incoming.url ?? '/', 'http://local');
  const route = routesOf(writer.serving).find(
    one => one.settings.method === incoming.method && one.re.test(url.pathname),
  );
  if (!route) return { status: 404, body: { error: `no trigger for ${incoming.method} ${url.pathname}` } };
  const produces = route.settings.produces ?? 'application/json';
  const read = await requestOf(incoming, url, route, writer);
  if ('refuse' in read) return { ...read.refuse, produces };
  const built = writer.serving.inputFor(route.trigger, read.request);
  if ('error' in built) return { status: 400, body: { error: built.error }, produces };
  // the runtime gates the run: the guard identifies the caller and the trigger's policies decide before the operation fires
  const report = await writer.serving.fire({
    trigger: route.trigger,
    input: built.input,
    request: read.request,
    blobs: writer.scope,
  });
  const encoded = encode(route.trigger, report);
  return { ...encoded, produces, report, fired: route.trigger.fire.run };
}

/**
 * Open the port and answer this tree's http triggers until the process stops. A project's startup list names
 * it; nothing here starts on its own.
 */
export const listen: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as ServeEnv;
  const serving = env.serving;
  if (!serving || !env.hold)
    throw new Error(
      `'${doc('server.port.json')}#listen' starts a server, so it runs from a project's startup list -- not from a graph`,
    );
  const { log } = serving;
  const settings = env.plugins?.[ROOT] ?? {};
  const port = Number(input.port ?? settings.port ?? 8080);

  const server = createServer(async (incoming, response) => {
    const started = Date.now();
    // one blob scope per request: what the body's codec and the graph store through it is released once answered
    const scope = serving.blobs.scope();
    const writer = { serving, scope };
    try {
      const answer = await answerFor(incoming, writer);
      if (answer.report)
        log(
          `${incoming.method} ${new URL(incoming.url ?? '/', 'http://local').pathname} → ${answer.status} (${Date.now() - started}ms, ${answer.fired} ${answer.report.status})`,
        );
      await write(response, writer, answer);
    } catch (error) {
      log(`error: ${(error as Error).message}`);
      if (!response.headersSent)
        await write(response, writer, { status: 500, body: { error: (error as Error).message } });
      else response.destroy();
    } finally {
      await scope.release();
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, () => {
      server.off('error', fail);
      ok();
    });
  });
  const routes = routesOf(serving);
  log(
    `http: listening on :${port} -- ${routes.map(one => `${one.settings.method} ${one.settings.route} → ${one.trigger.fire.run}`).join(', ')}`,
  );
  env.hold({ label: `http :${port}`, stop: () => new Promise<void>(ok => server.close(() => ok())) });
  return { port, routes: routes.length };
};
