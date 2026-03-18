import { parseSync } from '@swc/core';
import { readFileSync } from 'fs';
import type { SymbolInfo } from './types.js';

export async function extractSymbols(filePath: string): Promise<SymbolInfo[]> {
  let code: string;
  try {
    code = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  if (!code.trim()) {
    return [];
  }

  let ast: any;
  try {
    ast = parseSync(code, {
      syntax: 'typescript',
      tsx: filePath.endsWith('.tsx'),
    });
  } catch {
    return [];
  }

  // SWC spans are cumulative across parseSync calls in the same process.
  // Compute the offset so we can extract source text from spans.
  // ast.span.start is 1-based, so the offset to subtract is (ast.span.start - 1).
  const offset = ast.span.start - 1;

  const symbols: SymbolInfo[] = [];
  const seenFunctions = new Map<string, boolean>();

  for (const node of ast.body) {
    const exported = node.type === 'ExportDeclaration';
    const decl = exported ? node.declaration : node;

    if (!decl) continue;

    switch (decl.type) {
      case 'TsInterfaceDeclaration':
        symbols.push(extractInterface(decl, code, offset, exported));
        break;

      case 'FunctionDeclaration':
        handleFunction(decl, code, offset, exported, symbols, seenFunctions);
        break;

      case 'ClassDeclaration':
        symbols.push(extractClass(decl, code, offset, exported));
        break;

      case 'TsEnumDeclaration':
        symbols.push(extractEnum(decl, exported));
        break;

      case 'TsTypeAliasDeclaration':
        symbols.push(extractTypeAlias(decl, code, offset, exported));
        break;

      case 'VariableDeclaration':
        extractVariables(decl, code, offset, exported, symbols);
        break;
    }
  }

  return symbols;
}

/** Extract text from source code using an SWC span, adjusting for the global offset. */
function src(span: any, code: string, offset: number): string {
  return code.substring(span.start - offset - 1, span.end - offset - 1);
}

/** Serialize a type annotation node to its string representation. */
function serializeType(node: any, code: string, offset: number): string {
  if (!node) return 'void';

  switch (node.type) {
    case 'TsTypeAnnotation':
      return serializeType(node.typeAnnotation, code, offset);

    case 'TsKeywordType':
      return node.kind; // 'string', 'number', 'boolean', 'void', 'any', 'unknown', etc.

    case 'TsTypeReference': {
      const name = serializeEntityName(node.typeName);
      if (node.typeParams) {
        const params = node.typeParams.params.map((p: any) => serializeType(p, code, offset)).join(', ');
        return `${name}<${params}>`;
      }
      return name;
    }

    case 'TsUnionType': {
      return node.types.map((t: any) => serializeType(t, code, offset)).join(' | ');
    }

    case 'TsIntersectionType': {
      return node.types.map((t: any) => serializeType(t, code, offset)).join(' & ');
    }

    case 'TsArrayType': {
      const elemType = serializeType(node.elemType, code, offset);
      return `${elemType}[]`;
    }

    case 'TsLiteralType': {
      const lit = node.literal;
      if (lit.type === 'StringLiteral') return `'${lit.value}'`;
      if (lit.type === 'NumericLiteral') return String(lit.value);
      if (lit.type === 'BooleanLiteral') return String(lit.value);
      return src(lit.span, code, offset);
    }

    case 'TsParenthesizedType':
      return `(${serializeType(node.typeAnnotation, code, offset)})`;

    case 'TsFunctionType': {
      const params = node.params.map((p: any) => serializeFnParam(p, code, offset)).join(', ');
      const ret = serializeType(node.typeAnnotation, code, offset);
      return `(${params}) => ${ret}`;
    }

    case 'TsTypeLiteral': {
      const members = node.members.map((m: any) => serializeTypeMember(m, code, offset)).join('; ');
      return `{ ${members} }`;
    }

    case 'TsTupleType': {
      const elems = node.elemTypes.map((e: any) => serializeType(e.ty || e, code, offset)).join(', ');
      return `[${elems}]`;
    }

    case 'TsConditionalType': {
      const check = serializeType(node.checkType, code, offset);
      const ext = serializeType(node.extendsType, code, offset);
      const tru = serializeType(node.trueType, code, offset);
      const fal = serializeType(node.falseType, code, offset);
      return `${check} extends ${ext} ? ${tru} : ${fal}`;
    }

    case 'TsMappedType': {
      // Fall back to source text for complex mapped types
      return src(node.span, code, offset);
    }

    case 'TsIndexedAccessType': {
      const obj = serializeType(node.objectType, code, offset);
      const idx = serializeType(node.indexType, code, offset);
      return `${obj}[${idx}]`;
    }

    case 'TsTypeOperator': {
      const inner = serializeType(node.typeAnnotation, code, offset);
      return `${node.op} ${inner}`;
    }

    case 'TsOptionalType':
      return `${serializeType(node.typeAnnotation, code, offset)}?`;

    case 'TsRestType':
      return `...${serializeType(node.typeAnnotation, code, offset)}`;

    case 'TsThisType':
      return 'this';

    case 'TsTypeQuery': {
      return `typeof ${serializeEntityName(node.exprName)}`;
    }

    case 'TsImportType': {
      return src(node.span, code, offset);
    }

    default:
      // Fallback: try to extract from source
      if (node.span) {
        return src(node.span, code, offset);
      }
      return 'unknown';
  }
}

function serializeEntityName(node: any): string {
  if (node.type === 'Identifier') return node.value;
  if (node.type === 'TsQualifiedName') {
    return `${serializeEntityName(node.left)}.${node.right.value}`;
  }
  return node.value || '';
}

function serializeTypeMember(member: any, code: string, offset: number): string {
  if (member.type === 'TsPropertySignature') {
    const key = member.key.value;
    const opt = member.optional ? '?' : '';
    const type = member.typeAnnotation ? serializeType(member.typeAnnotation, code, offset) : 'any';
    return `${key}${opt}: ${type}`;
  }
  if (member.type === 'TsMethodSignature') {
    const key = member.key.value;
    const params = member.params.map((p: any) => serializeFnParam(p, code, offset)).join(', ');
    const ret = member.typeAnn ? serializeType(member.typeAnn, code, offset) : 'void';
    return `${key}(${params}): ${ret}`;
  }
  if (member.type === 'TsIndexSignature') {
    const param = member.params[0];
    const paramName = param.value;
    const paramType = serializeType(param.typeAnnotation, code, offset);
    const retType = serializeType(member.typeAnnotation, code, offset);
    return `[${paramName}: ${paramType}]: ${retType}`;
  }
  return '';
}

function serializeFnParam(param: any, code: string, offset: number): string {
  if (param.type === 'Identifier') {
    const name = param.value;
    if (param.typeAnnotation) {
      const type = serializeType(param.typeAnnotation, code, offset);
      return `${name}: ${type}`;
    }
    return name;
  }
  return '';
}

function formatTypeParams(typeParams: any, code: string, offset: number): string {
  if (!typeParams) return '';
  const params = typeParams.parameters.map((p: any) => {
    let result = p.name.value;
    if (p.constraint) {
      result += ` extends ${serializeType(p.constraint, code, offset)}`;
    }
    if (p.default) {
      result += ` = ${serializeType(p.default, code, offset)}`;
    }
    return result;
  });
  return `<${params.join(', ')}>`;
}

function extractInterface(decl: any, code: string, offset: number, exported: boolean): SymbolInfo {
  const name = decl.id.value;
  const typeParams = formatTypeParams(decl.typeParams, code, offset);
  const members = decl.body.body.map((m: any) => formatInterfaceMember(m, code, offset));
  const body = members.length > 0 ? `{ ${members.join('; ')} }` : '{}';
  const signature = typeParams ? `${typeParams} ${body}` : body;

  return { name, kind: 'interface', signature, exported };
}

function formatInterfaceMember(member: any, code: string, offset: number): string {
  return serializeTypeMember(member, code, offset);
}

function handleFunction(
  decl: any,
  code: string,
  offset: number,
  exported: boolean,
  symbols: SymbolInfo[],
  seenFunctions: Map<string, boolean>
): void {
  const name = decl.identifier.value;
  const hasBody = !!decl.body;

  if (!hasBody) {
    if (!seenFunctions.has(name)) {
      seenFunctions.set(name, false);
    }
    return;
  }

  if (seenFunctions.has(name) && seenFunctions.get(name) === true) {
    return;
  }

  seenFunctions.set(name, true);

  const typeParams = formatTypeParams(decl.typeParameters, code, offset);
  const params = decl.params.map((p: any) => formatFunctionParam(p, code, offset)).join(', ');
  const retType = decl.returnType ? serializeType(decl.returnType, code, offset) : 'void';
  const signature = `${typeParams}(${params}): ${retType}`;

  symbols.push({ name, kind: 'function', signature, exported });
}

function extractClass(decl: any, code: string, offset: number, exported: boolean): SymbolInfo {
  const name = decl.identifier.value;
  const typeParams = formatTypeParams(decl.typeParams, code, offset);
  const members: string[] = [];
  const seenGetterSetter = new Set<string>();

  for (const member of decl.body) {
    if (member.type === 'Constructor') {
      const ctorParams: string[] = [];
      const publicParamProps: string[] = [];

      for (const param of member.params) {
        if (param.type === 'TsParameterProperty') {
          const accessibility = param.accessibility || 'public';
          const paramIdent = param.param;
          const paramName = paramIdent.value;
          const paramType = paramIdent.typeAnnotation ? serializeType(paramIdent.typeAnnotation, code, offset) : 'any';

          // Only include public parameter properties in constructor signature
          if (accessibility === 'public') {
            ctorParams.push(`${paramName}: ${paramType}`);
            publicParamProps.push(`${paramName}: ${paramType}`);
          }
        } else {
          ctorParams.push(formatFunctionParam(param, code, offset));
        }
      }

      members.push(`constructor(${ctorParams.join(', ')})`);
      for (const prop of publicParamProps) {
        members.push(prop);
      }
      continue;
    }

    if (member.type === 'ClassProperty') {
      const accessibility = member.accessibility || null;
      if (accessibility === 'private' || accessibility === 'protected') continue;

      const key = member.key.value;
      const isStatic = member.isStatic ? 'static ' : '';
      const type = member.typeAnnotation ? serializeType(member.typeAnnotation, code, offset) : '(inferred)';
      members.push(`${isStatic}${key}: ${type}`);
      continue;
    }

    if (member.type === 'ClassMethod') {
      const accessibility = member.accessibility || null;
      if (accessibility === 'private' || accessibility === 'protected') continue;

      const key = member.key.value;
      const kind = member.kind;

      if (kind === 'getter' || kind === 'setter') {
        if (seenGetterSetter.has(key)) continue;
        seenGetterSetter.add(key);
        members.push(key);
        continue;
      }

      const isStatic = member.isStatic ? 'static ' : '';
      const fn = member.function;
      const params = fn.params.map((p: any) => formatFunctionParam(p, code, offset)).join(', ');
      const retType = fn.returnType ? serializeType(fn.returnType, code, offset) : 'void';
      members.push(`${isStatic}${key}(${params}): ${retType}`);
    }
  }

  const signature = `${typeParams}{ ${members.join('; ')} }`;
  return { name, kind: 'class', signature, exported };
}

function extractEnum(decl: any, exported: boolean): SymbolInfo {
  const name = decl.id.value;
  const memberNames = decl.members.map((m: any) => m.id.value);
  const signature = `{ ${memberNames.join(', ')} }`;
  return { name, kind: 'enum', signature, exported };
}

function extractTypeAlias(decl: any, code: string, offset: number, exported: boolean): SymbolInfo {
  const name = decl.id.value;
  const signature = serializeType(decl.typeAnnotation, code, offset);
  return { name, kind: 'type', signature, exported };
}

function extractVariables(decl: any, code: string, offset: number, exported: boolean, symbols: SymbolInfo[]): void {
  for (const declarator of decl.declarations) {
    const id = declarator.id;

    if (id.type === 'Identifier') {
      const name = id.value;
      let signature: string;

      if (id.typeAnnotation) {
        signature = serializeType(id.typeAnnotation, code, offset);
      } else {
        signature = '(inferred)';
      }

      symbols.push({ name, kind: 'variable', signature, exported });
    } else if (id.type === 'ObjectPattern') {
      for (const prop of id.properties) {
        const propName = prop.value?.value || prop.key?.value;
        if (propName) {
          symbols.push({ name: propName, kind: 'variable', signature: '(inferred)', exported });
        }
      }
    }
  }
}

function formatFunctionParam(param: any, code: string, offset: number): string {
  const pat = param.type === 'Parameter' ? param.pat : param;

  if (pat.type === 'Identifier') {
    const name = pat.value;
    if (pat.typeAnnotation) {
      const type = serializeType(pat.typeAnnotation, code, offset);
      return `${name}: ${type}`;
    }
    return name;
  }

  if (pat.type === 'AssignmentPattern') {
    const left = pat.left;
    if (left.type === 'Identifier') {
      const name = left.value;
      if (left.typeAnnotation) {
        const type = serializeType(left.typeAnnotation, code, offset);
        return `${name}: ${type}`;
      }
      return name;
    }
  }

  if (pat.type === 'RestElement') {
    const arg = pat.argument;
    const name = arg.value;
    // Type annotation can be on the RestElement itself or on the argument
    const typeAnn = pat.typeAnnotation || arg.typeAnnotation;
    if (typeAnn) {
      const type = serializeType(typeAnn, code, offset);
      return `...${name}: ${type}`;
    }
    return `...${name}`;
  }

  return '';
}
