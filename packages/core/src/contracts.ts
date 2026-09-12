/**
 * What a plugin's own port documents must say for themselves, judged when the plugin loads rather than when a
 * graph runs (D011). A `resolves` path is a small grammar, and a port document that writes one outside it --
 * a path that is not a path, on a field that is not static, or taking a key by an input the operation has not
 * got -- is a broken plugin, not a broken tree. What the path *finds* is a fact of the tree's own documents,
 * and is refused where the tree names them.
 */
import type { Fields, PortDoc } from './model.js';
import type { Refusal } from './registry.js';
import { parsePath, substituted } from './resolves.js';

const GRAMMAR =
  'a path is field names separated by dots, a segment optionally taking a key by another static input ([input]) or by a field beside the one just read ({sibling}): collections[collection].of, collections[collection].of{key}.type';

/** Every way one port document's `resolves` can be wrong, each named at the field that writes it. */
export function badResolves(doc: PortDoc, file: string): Refusal[] {
  return new Contract(doc, file).judge();
}

/** One port document held to what a contract may say about where its type variables come from. */
class Contract {
  private readonly out: Refusal[] = [];
  private at = '';
  private accepts: Fields = {};

  constructor(
    private readonly doc: PortDoc,
    private readonly file: string,
  ) {}

  judge(): Refusal[] {
    for (const [opName, op] of Object.entries(this.doc.operations)) {
      this.accepts = op.accepts ?? {};
      for (const [name, field] of Object.entries(this.accepts)) {
        if (!field.resolves) continue;
        this.at = `operations/${opName}/accepts/${name}/resolves`;
        this.oneField(name, field.resolves);
      }
    }
    return this.out;
  }

  /** One field that resolves: it is static, and every variable it binds names a path into the document. */
  private oneField(name: string, resolves: Record<string, string>): void {
    if (this.accepts[name].static !== true) this.notStatic(name);
    for (const [variable, expr] of Object.entries(resolves)) this.onePath(variable, expr);
  }

  private refuse(message: string, hint: string): void {
    this.out.push({ code: 'D011', file: this.file, at: this.at, message, hint });
  }

  /** A field that resolves a type is read before anything runs, so its own value must be a literal. */
  private notStatic(name: string): void {
    this.refuse(
      `'${name}' resolves a type but is not static`,
      `a resolved type is read before anything runs, so '${name}' must be a literal: add "static": true`,
    );
  }

  /** One variable's path: it parses, and every key it takes is a static input of the same operation. */
  private onePath(variable: string, expr: string): void {
    const path = parsePath(expr);
    if (typeof path === 'string') {
      this.refuse(`${variable} resolves through '${expr}': ${path}`, GRAMMAR);
      return;
    }
    for (const input of substituted(path)) this.byInput(variable, expr, input);
  }

  /** The input a segment takes its key by: an input of this operation, and a static one. */
  private byInput(variable: string, expr: string, input: string): void {
    const takes = `${variable} resolves through '${expr}', which takes a key by '${input}'`;
    const field = this.accepts[input];
    if (!field) {
      const names = Object.keys(this.accepts).join(', ') || 'none';
      this.refuse(`${takes}, not an input of this operation`, `accept '${input}', or name one of: ${names}`);
      return;
    }
    if (field.static === true) return;
    this.refuse(
      `${takes}, an input that is not static`,
      `mark '${input}' "static": true; a key is read before anything runs`,
    );
  }
}
