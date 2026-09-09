/**
 * The runtime's blob registry: one directory, one file per blob, streamed in and streamed out, so a file's
 * bytes are held once, on disk, and never as a value. A handle names a file only while this store holds it:
 * a handle written into a request by hand opens nothing.
 */

import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BlobHandle, BlobScope, BlobStore } from '@wilanis/core';

const ID = /^[0-9a-f-]{36}$/;

/** A directory named against a root, unless it is already absolute. */
const absoluteOr = (root: string, dir: string) => (isAbsolute(dir) ? dir : resolve(root, dir));

export class FileBlobStore implements BlobStore {
  /** Every handle this store holds, by id: the size counted as it was written. */
  private held = new Map<string, BlobHandle>();
  readonly dir: string;

  /** `dir` relative to `root` or absolute; absent, a fresh directory under the system temp dir. */
  constructor(root: string, dir?: string) {
    this.dir = dir ? absoluteOr(root, dir) : join(tmpdir(), `wilanis-blobs-${process.pid}-${randomUUID().slice(0, 8)}`);
    mkdirSync(this.dir, { recursive: true });
  }

  async put(source: Readable | Buffer | string, meta: { contentType: string; filename?: string }): Promise<BlobHandle> {
    const id = randomUUID();
    let size = 0;
    const counted = Readable.from(
      source instanceof Readable ? source : [typeof source === 'string' ? Buffer.from(source) : source],
    );
    counted.on('data', (chunk: Buffer | string) => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    });
    await pipeline(counted, createWriteStream(join(this.dir, id)));
    const handle: BlobHandle = {
      id,
      contentType: meta.contentType,
      size,
      ...(meta.filename ? { filename: meta.filename } : {}),
    };
    this.held.set(id, handle);
    return handle;
  }

  open(handle: BlobHandle): Readable {
    if (!ID.test(handle.id) || !this.held.has(handle.id)) throw new Error(`no blob '${handle.id}' in the registry`);
    return createReadStream(join(this.dir, handle.id));
  }

  async drop(handle: BlobHandle): Promise<void> {
    if (!this.held.delete(handle.id)) return;
    await unlink(join(this.dir, handle.id)).catch(() => undefined);
  }

  scope(): BlobScope {
    const mine: BlobHandle[] = [];
    const parent = this;
    return {
      async put(source, meta) {
        const handle = await parent.put(source, meta);
        mine.push(handle);
        return handle;
      },
      open: handle => parent.open(handle),
      drop: handle => parent.drop(handle),
      scope: () => parent.scope(),
      async release() {
        for (const handle of mine.splice(0)) await parent.drop(handle);
      },
    };
  }

  /** Remove the directory and everything in it. */
  destroy(): void {
    this.held.clear();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
