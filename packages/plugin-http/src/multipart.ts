/**
 * multipart/form-data, walked once. Text fields become strings. A file part is streamed into the registry as its bytes
 * arrive and becomes a blob handle: the part's filename and content type, the size as counted. Only the window that
 * might straddle a boundary is ever held, so a file never sits in memory beside the store.
 */
import { PassThrough } from 'node:stream';
import type { BlobStore } from '@wilanis/core';

const CRLF2 = Buffer.from('\r\n\r\n');

/** Where the walk is: before the first boundary, reading a part's headers, or streaming a part's body. */
type State = 'preamble' | 'headers' | 'body';

/**
 * The parts of one multipart body, fed the stream's chunks. It holds the fields it has read, the promises of the
 * blobs still being written, and only as much of the stream as might straddle a boundary.
 */
export class MultipartParts {
  private readonly delimiter: Buffer;
  private readonly fields: Record<string, unknown> = {};
  private readonly pending: Promise<void>[] = [];
  private state: State = 'preamble';
  private window: Buffer = Buffer.alloc(0);
  private name: string | undefined;
  private sink: PassThrough | undefined;
  private textChunks: Buffer[] = [];

  constructor(
    boundary: string,
    private readonly blobs: BlobStore,
  ) {
    this.delimiter = Buffer.from(`\r\n--${boundary}`);
  }

  /** Take a chunk of the stream, reading every part it completes. */
  feed(chunk: Buffer) {
    this.window = this.window.length ? Buffer.concat([this.window, chunk]) : chunk;
    for (;;) {
      if (this.state === 'preamble' && !this.skipPreamble()) break;
      if (this.state === 'headers' && !this.readHeaders()) break;
      if (!this.readBody()) break;
    }
  }

  /** The fields, once the stream has ended and every blob has been written. */
  async end(): Promise<Record<string, unknown>> {
    if (this.state === 'body') this.finishPart();
    await Promise.all(this.pending);
    return this.fields;
  }

  /** The first boundary has no leading CRLF; the window starts with "--boundary". */
  private skipPreamble(): boolean {
    const first = this.window.indexOf(this.delimiter.subarray(2));
    if (first < 0) {
      this.window = this.window.subarray(Math.max(0, this.window.length - this.delimiter.length));
      return false;
    }
    this.window = this.window.subarray(first + this.delimiter.length - 2);
    this.state = 'headers';
    return true;
  }

  /** A part's headers, up to the blank line; false when the closing boundary was reached or more is needed. */
  private readHeaders(): boolean {
    if (this.window.subarray(0, 2).toString() === '--') {
      this.window = Buffer.alloc(0);
      return false;
    }
    const end = this.window.indexOf(CRLF2);
    if (end < 0) return false;
    this.startPart(this.window.subarray(0, end).toString('latin1'));
    this.window = this.window.subarray(end + 4);
    this.state = 'body';
    return true;
  }

  /** Everything up to the next delimiter belongs to the part; what might be the start of one is kept. */
  private readBody(): boolean {
    const at = this.window.indexOf(this.delimiter);
    if (at < 0) {
      const safe = this.window.length - (this.delimiter.length - 1);
      if (safe > 0) {
        this.take(this.window.subarray(0, safe));
        this.window = this.window.subarray(safe);
      }
      return false;
    }
    this.take(this.window.subarray(0, at));
    this.finishPart();
    this.window = this.window.subarray(at + this.delimiter.length);
    this.state = 'headers';
    return true;
  }

  /** A part begins: a file part streams into the registry, a text part is collected. */
  private startPart(head: string) {
    this.name = /name="([^"]+)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    const partType = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
    if (filename === undefined || this.name === undefined) return;
    const sink = new PassThrough();
    this.sink = sink;
    const field = this.name;
    this.pending.push(
      this.blobs.put(sink, { contentType: partType ?? 'application/octet-stream', filename }).then(handle => {
        this.fields[field] = handle;
      }),
    );
  }

  /** Bytes of the part being read. */
  private take(chunk: Buffer) {
    if (this.sink) this.sink.write(chunk);
    else this.textChunks.push(chunk);
  }

  /** A part ends: a file's stream is closed, a text field is decoded. */
  private finishPart() {
    if (this.sink) this.sink.end();
    else if (this.name !== undefined) this.fields[this.name] = Buffer.concat(this.textChunks).toString('utf8');
    this.sink = undefined;
    this.name = undefined;
    this.textChunks = [];
  }
}
