/**
 * Reading this repository's TypeScript as text. A fitness function judges the source a pull request writes,
 * never the `dist` a build produces, so every reader here parses a file with Babel's parser and answers one
 * question about it: which modules it imports, what it exports, and whether each export says what it answers.
 * The node types are derived from the parser's own return type, so `@babel/parser` is the only dependency.
 */
import { readdirSync, readFileSync, type Stats, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';

type Program = ReturnType<typeof parse>['program'];
type Statement = Program['body'][number];
type Named = Extract<Statement, { type: 'ExportNamedDeclaration' }>;
type Klass = Extract<Statement, { type: 'ClassDeclaration' }>;
type Vars = Extract<Statement, { type: 'VariableDeclaration' }>;
type Method = Extract<Klass['body']['body'][number], { type: 'ClassMethod' }>;
type Key = Method['key'];
type Commented = { leadingComments?: ReadonlyArray<{ type: string }> | null };

/** Every `.ts` file under a directory, repository-relative and sorted, with declaration files left out. */
export function sourceFiles(dir: string): string[] {
  return entriesUnder(dir, ['.ts']).filter(file => !file.endsWith('.d.ts'));
}

/** A repository file's text, read as UTF-8. */
export function textOf(file: string): string {
  return readFileSync(file, 'utf8');
}

/** The top-level statements of a file's text, with the comments that lead each one attached. */
function statementsOf(text: string): Statement[] {
  return parse(text, { sourceType: 'module', plugins: ['typescript'], attachComment: true }).program.body;
}

/** The module specifiers a file's text imports or re-exports, in source order, static strings only. */
export function importsOf(text: string): string[] {
  return statementsOf(text).flatMap(specifierOf);
}

/** An exported declaration: the name it binds, and whether a doc comment leads it. */
export interface Export {
  name: string;
  documented: boolean;
}

/** Every function, arrow constant, class and public method a file's text exports, each with its doc comment. */
export function exportsOf(text: string): Export[] {
  return statementsOf(text).flatMap(statement =>
    statement.type === 'ExportNamedDeclaration' ? exportedNames(statement) : [],
  );
}

/** The one module specifier a statement names, or nothing where it names none. */
function specifierOf(statement: Statement): string[] {
  const imports = statement.type === 'ImportDeclaration';
  const reexports = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration';
  const source = imports || reexports ? statement.source : null;
  return source ? [source.value] : [];
}

/** The callable names an `export` statement binds, each with whether a doc comment leads it. */
function exportedNames(statement: Named): Export[] {
  const declaration = statement.declaration;
  if (!declaration) return [];
  const documented = hasDoc(statement);
  if (declaration.type === 'FunctionDeclaration') return [{ name: nameOf(declaration.id), documented }];
  if (declaration.type === 'ClassDeclaration') return classExports(declaration, documented);
  if (declaration.type === 'VariableDeclaration') return arrowExports(declaration, documented);
  return [];
}

/** The class itself and every public method it declares, each documented by the comment that leads it. */
function classExports(declaration: Klass, documented: boolean): Export[] {
  const name = nameOf(declaration.id);
  const methods = declaration.body.body.flatMap(member =>
    member.type === 'ClassMethod' && member.accessibility !== 'private' && member.kind !== 'constructor'
      ? [{ name: `${name}.${memberName(member.key)}`, documented: hasDoc(member) }]
      : [],
  );
  return [{ name, documented }, ...methods];
}

/** Every arrow-function constant an exported `const` binds; a plain value export answers nothing. */
function arrowExports(declaration: Vars, documented: boolean): Export[] {
  return declaration.declarations.flatMap(declarator => {
    const init = declarator.init?.type;
    const isFunction = init === 'ArrowFunctionExpression' || init === 'FunctionExpression';
    return isFunction && declarator.id.type === 'Identifier' ? [{ name: declarator.id.name, documented }] : [];
  });
}

/** Whether a block comment leads a node, which is how this repository says what a function answers. */
function hasDoc(node: Commented): boolean {
  return (node.leadingComments ?? []).some(comment => comment.type === 'CommentBlock');
}

/** The name an identifier binds, or `<anonymous>` where a declaration binds none. */
function nameOf(id: { name: string } | null | undefined): string {
  return id?.name ?? '<anonymous>';
}

/** The name a class member's key holds, whether written plainly or as a string. */
function memberName(key: Key): string {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  return '<computed>';
}

/** Two directory entries in name order, for a stable walk over a file system that promises none. */
function byName(one: { name: string }, other: { name: string }): number {
  return one.name < other.name ? -1 : 1;
}

/** Every fitness function in the suite, so a claim about the suite's own shape reads the directory it is in. */
export function fitnessFiles(): string[] {
  return sourceFiles('fitness').filter(file => file.endsWith('.fitness.ts'));
}

/** The bare package a specifier names -- `@scope/name` or `name` -- or null where it is relative. */
export function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null);
}

/** Every directory under `packages/`, repository-relative and sorted, so a claim reads the workspace. */
export function packageDirs(): string[] {
  return readdirSync('packages', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `packages/${entry.name}`)
    .sort();
}

/** Whether a file is there, for a claim that asks what a package ships rather than what it says. */
export function fileExists(path: string): boolean {
  return statOf(path)?.isFile() ?? false;
}

/** Whether a directory is there, for a claim about where something lives. */
export function dirExists(path: string): boolean {
  return statOf(path)?.isDirectory() ?? false;
}

/** What the file system says about a path, or null where it says nothing. */
function statOf(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/** The names a directory holds, sorted, or nothing where the directory is not there. */
export function entriesOf(dir: string): string[] {
  if (!dirExists(dir)) return [];
  return readdirSync(dir).slice().sort();
}

/** Every file under a directory whose name ends in one of these suffixes, repository-relative and sorted. */
export function entriesUnder(dir: string, suffixes: string[]): string[] {
  if (!dirExists(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort(byName)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...entriesUnder(path, suffixes));
    else if (suffixes.some(suffix => entry.name.endsWith(suffix))) found.push(path);
  }
  return found;
}
