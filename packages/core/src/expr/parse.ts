/** A recursive-descent parser for the grammar in ast.ts, over the tokens lex.ts produces. */
import { COMPARISONS, type Expr, ExprError } from './ast.js';
import { lex, type Token } from './lex.js';

/** The AST an expression source says, or an ExprError naming where it stops being one. */
export function parse(src: string): Expr {
  return new Parser(src).parse();
}

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(private readonly src: string) {
    this.tokens = lex(src);
  }

  parse(): Expr {
    const expr = this.or();
    if (this.index !== this.tokens.length) throw new ExprError(`trailing tokens in '${this.src}'`);
    return expr;
  }

  // ---- tokens -------------------------------------------------------------------------------------

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private take(): Token | undefined {
    return this.tokens[this.index++];
  }

  private isOp(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === 'op' && token.value === value;
  }

  private isWord(value: string): boolean {
    const token = this.peek();
    return token?.kind === 'id' && token.value === value;
  }

  private expect(value: string): void {
    if (!this.isOp(value)) throw new ExprError(`expected '${value}' at token ${this.index} in '${this.src}'`);
    this.index++;
  }

  // ---- the grammar --------------------------------------------------------------------------------

  private or(): Expr {
    let left = this.and();
    while (this.isOp('||')) {
      this.index++;
      left = { kind: 'bin', op: '||', left, right: this.and() };
    }
    return left;
  }

  private and(): Expr {
    let left = this.unary();
    while (this.isOp('&&')) {
      this.index++;
      left = { kind: 'bin', op: '&&', left, right: this.unary() };
    }
    return left;
  }

  private unary(): Expr {
    if (!this.isOp('!')) return this.comparison();
    this.index++;
    return { kind: 'not', arg: this.unary() };
  }

  private comparison(): Expr {
    const left = this.primary();
    const op = COMPARISONS.find(candidate => this.isOp(candidate));
    if (op) {
      this.index++;
      return { kind: 'bin', op, left, right: this.primary() };
    }
    if (this.isWord('in')) {
      this.index++;
      return { kind: 'bin', op: 'in', left, right: this.primary() };
    }
    return left;
  }

  private primary(): Expr {
    const token = this.peek();
    if (!token) throw new ExprError(`unexpected end of '${this.src}'`);
    if (token.kind === 'num' || token.kind === 'str') {
      this.index++;
      return { kind: 'lit', value: token.value };
    }
    if (token.kind === 'op' && token.value === '(') {
      this.index++;
      const inner = this.or();
      this.expect(')');
      return inner;
    }
    if (token.kind === 'id') return this.word(token.value);
    throw new ExprError(`unexpected '${token.value}' in '${this.src}'`);
  }

  /** An identifier starts a literal boolean, a has(...) or len(...) call, or a path. */
  private word(value: string): Expr {
    if (value === 'true' || value === 'false') {
      this.index++;
      return { kind: 'lit', value: value === 'true' };
    }
    const call = (value === 'has' || value === 'len') && this.isOp('(', 1);
    if (!call) return { kind: 'path', path: this.path() };
    this.index += 2;
    const expr: Expr = value === 'has' ? { kind: 'has', path: this.path() } : { kind: 'len', arg: this.or() };
    this.expect(')');
    return expr;
  }

  private path(): string[] {
    const first = this.take();
    if (first?.kind !== 'id') throw new ExprError(`expected a path in '${this.src}'`);
    const path = [first.value];
    while (this.isOp('.')) {
      this.index++;
      const next = this.take();
      if (!next || (next.kind !== 'id' && next.kind !== 'num')) throw new ExprError(`bad path in '${this.src}'`);
      path.push(String(next.value));
    }
    return path;
  }
}
