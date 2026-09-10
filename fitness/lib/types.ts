/**
 * Reading a TypeScript declaration's own shape. A claim that pins a type to a decision -- a member that must
 * not drift back to optional, a parameter a rule may not omit -- asks this file what a declaration says, and
 * never what a value at run time holds. Babel's parser answers both forms a declaration takes here: an
 * interface, and the alias of a function type whose parameters are the members.
 */
import { parse } from '@babel/parser';

type Program = ReturnType<typeof parse>['program'];
type Statement = Program['body'][number];
type Interface = Extract<Statement, { type: 'TSInterfaceDeclaration' }>;
type Alias = Extract<Statement, { type: 'TSTypeAliasDeclaration' }>;
type Member = Interface['body']['body'][number];
type Fn = Extract<Alias['typeAnnotation'], { type: 'TSFunctionType' }>;
type Parameter = Fn['params'][number];

/** The top-level statements of a file's text, with an exported declaration unwrapped to the thing declared. */
function declarationsOf(text: string): Statement[] {
  const body = parse(text, { sourceType: 'module', plugins: ['typescript'] }).program.body;
  return body.flatMap(statement =>
    statement.type === 'ExportNamedDeclaration' && statement.declaration ? [statement.declaration] : [statement],
  );
}

/** The members a named interface or function-type alias declares optional, in source order. */
export function optionalMembersOf(text: string, name: string): string[] {
  for (const declaration of declarationsOf(text)) {
    if (declaration.type === 'TSInterfaceDeclaration' && declaration.id.name === name) {
      return declaration.body.body.flatMap(optionalMember);
    }
    if (declaration.type === 'TSTypeAliasDeclaration' && declaration.id.name === name) {
      return optionalParameters(declaration);
    }
  }
  return [];
}

/** The name of one interface member where it is declared optional, or nothing where it is required. */
function optionalMember(member: Member): string[] {
  if (member.type !== 'TSPropertySignature' && member.type !== 'TSMethodSignature') return [];
  if (!member.optional) return [];
  return member.key.type === 'Identifier' ? [member.key.name] : [];
}

/** The parameters an alias of a function type declares optional, which is how a curried refuser says so. */
function optionalParameters(alias: Alias): string[] {
  const annotation = alias.typeAnnotation;
  if (annotation.type !== 'TSFunctionType') return [];
  return parametersOf(annotation).flatMap(optionalParameter);
}

/**
 * A function type's parameters. The parser's types name them `params` and a build of it answers `parameters`,
 * so this reads whichever is there and the claim holds under `npm run fitness` and under plain node alike.
 */
function parametersOf(annotation: Fn): Parameter[] {
  const either = annotation as Fn & { parameters?: Parameter[] };
  return either.params ?? either.parameters ?? [];
}

/** One parameter's name where it is optional or admits undefined, since either lets a caller pass nothing. */
function optionalParameter(parameter: Parameter): string[] {
  if (parameter.type !== 'Identifier') return [];
  const admits = parameter.optional === true || namesUndefined(parameter.typeAnnotation);
  return admits ? [parameter.name] : [];
}

/** Whether a type annotation admits `undefined`, whether written `x?: T` or `x: T | undefined`. */
function namesUndefined(annotation: Parameter['typeAnnotation']): boolean {
  if (annotation?.type !== 'TSTypeAnnotation') return false;
  const type = annotation.typeAnnotation;
  if (type.type !== 'TSUnionType') return false;
  return type.types.some((each: { type: string }) => each.type === 'TSUndefinedKeyword');
}
