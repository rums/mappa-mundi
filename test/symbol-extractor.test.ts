import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { extractSymbols } from '../src/symbol-extractor';
import type { SymbolInfo } from '../src/types';

const fixture = (name: string, file: string) =>
  resolve(__dirname, 'fixtures', name, file);

// Helper to find a symbol by name in the extracted results
function findSymbol(symbols: SymbolInfo[], name: string): SymbolInfo | undefined {
  return symbols.find(s => s.name === name);
}

describe('Symbol Extractor: Interface Extraction', () => {
  it('should extract basic interface with fields', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const user = findSymbol(symbols, 'User');

    expect(user).toBeDefined();
    expect(user!.kind).toBe('interface');
    expect(user!.exported).toBe(true);
    expect(user!.signature).toBe('{ name: string; email: string }');
  });

  it('should extract empty interface', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const empty = findSymbol(symbols, 'Empty');

    expect(empty).toBeDefined();
    expect(empty!.kind).toBe('interface');
    expect(empty!.signature).toBe('{}');
  });

  it('should extract interface extending another', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const admin = findSymbol(symbols, 'Admin');

    expect(admin).toBeDefined();
    expect(admin!.kind).toBe('interface');
    expect(admin!.exported).toBe(true);
    // Should include own fields (role) — the extends relationship is structural context
    expect(admin!.signature).toContain('role: string');
  });

  it('should extract optional fields in interface', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const config = findSymbol(symbols, 'Config');

    expect(config).toBeDefined();
    expect(config!.kind).toBe('interface');
    expect(config!.signature).toContain('host: string');
    expect(config!.signature).toContain('port?: number');
  });

  it('should extract method signatures on interface', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const validator = findSymbol(symbols, 'Validator');

    expect(validator).toBeDefined();
    expect(validator!.kind).toBe('interface');
    expect(validator!.signature).toContain('validate(): boolean');
    expect(validator!.signature).toContain('format(input: string): string');
  });

  it('should extract index signature on interface', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const dict = findSymbol(symbols, 'Dictionary');

    expect(dict).toBeDefined();
    expect(dict!.kind).toBe('interface');
    expect(dict!.signature).toContain('[key: string]: unknown');
  });

  it('should extract generic interface with type parameters in signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const response = findSymbol(symbols, 'Response');

    expect(response).toBeDefined();
    expect(response!.kind).toBe('interface');
    // AC 9: Generic type parameters appear in signatures
    expect(response!.signature).toContain('<T>');
    expect(response!.signature).toContain('data: T');
  });

  it('should extract non-exported interface with exported false', async () => {
    const symbols = await extractSymbols(fixture('symbols-interface', 'interfaces.ts'));
    const internal = findSymbol(symbols, 'Internal');

    expect(internal).toBeDefined();
    expect(internal!.kind).toBe('interface');
    expect(internal!.exported).toBe(false);
  });
});

describe('Symbol Extractor: Function Extraction', () => {
  it('should extract basic exported function with params and return type', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const auth = findSymbol(symbols, 'authenticate');

    expect(auth).toBeDefined();
    expect(auth!.kind).toBe('function');
    expect(auth!.exported).toBe(true);
    expect(auth!.signature).toBe('(token: string): Promise<User>');
  });

  it('should extract function with no parameters', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const ver = findSymbol(symbols, 'getVersion');

    expect(ver).toBeDefined();
    expect(ver!.kind).toBe('function');
    expect(ver!.signature).toBe('(): string');
  });

  it('should extract function with no return type annotation', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const doSomething = findSymbol(symbols, 'doSomething');

    expect(doSomething).toBeDefined();
    expect(doSomething!.kind).toBe('function');
    // No return type annotation — signature should reflect that
    expect(doSomething!.signature).toMatch(/^\(\):/);
  });

  it('should extract function with default parameter (type preserved, default omitted)', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const greet = findSymbol(symbols, 'greet');

    expect(greet).toBeDefined();
    expect(greet!.kind).toBe('function');
    // Default value should not appear in signature, but type should
    expect(greet!.signature).toContain('name: string');
    expect(greet!.signature).not.toContain("'world'");
  });

  it('should extract function with rest parameters', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const concat = findSymbol(symbols, 'concat');

    expect(concat).toBeDefined();
    expect(concat!.kind).toBe('function');
    expect(concat!.signature).toContain('...args: string[]');
  });

  it('should extract async function', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const fetchData = findSymbol(symbols, 'fetchData');

    expect(fetchData).toBeDefined();
    expect(fetchData!.kind).toBe('function');
    expect(fetchData!.signature).toContain('Promise<Data>');
  });

  it('should extract generic function with type parameters in signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const identity = findSymbol(symbols, 'identity');

    expect(identity).toBeDefined();
    expect(identity!.kind).toBe('function');
    // AC 9: Generic type parameters appear in signatures
    expect(identity!.signature).toBe('<T>(x: T): T');
  });

  it('should extract non-exported function with exported false', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const helper = findSymbol(symbols, 'helper');

    expect(helper).toBeDefined();
    expect(helper!.kind).toBe('function');
    expect(helper!.exported).toBe(false);
  });

  it('should extract overloaded function as single entry with implementation signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const parseSymbols = symbols.filter(s => s.name === 'parse');

    // DD 4: single SymbolInfo entry for overloaded functions
    expect(parseSymbols).toHaveLength(1);
    expect(parseSymbols[0].kind).toBe('function');
    // Implementation signature: (input: string | number): string | number
    expect(parseSymbols[0].signature).toContain('string | number');
  });

  it('should extract arrow function as const with kind variable, not function', async () => {
    const symbols = await extractSymbols(fixture('symbols-function', 'functions.ts'));
    const transform = findSymbol(symbols, 'transform');

    expect(transform).toBeDefined();
    // DD 6: Arrow functions as const get kind 'variable', not 'function'
    expect(transform!.kind).toBe('variable');
    expect(transform!.exported).toBe(true);
  });
});

describe('Symbol Extractor: Class Extraction', () => {
  it('should extract class with public members only in signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-class', 'classes.ts'));
    const userService = findSymbol(symbols, 'UserService');

    expect(userService).toBeDefined();
    expect(userService!.kind).toBe('class');
    expect(userService!.exported).toBe(true);

    // DD 5: Only public members in signature
    expect(userService!.signature).toContain('constructor(name: string)');
    expect(userService!.signature).toContain('name: string');
    expect(userService!.signature).toContain('validate(): boolean');

    // Private and protected should NOT be in signature
    expect(userService!.signature).not.toContain('secret');
    expect(userService!.signature).not.toContain('doInternal');
    expect(userService!.signature).not.toContain('internal');
    expect(userService!.signature).not.toContain('onInit');
  });

  it('should exclude private constructor parameter properties from signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-class', 'classes.ts'));
    const config = findSymbol(symbols, 'Config');

    expect(config).toBeDefined();
    expect(config!.kind).toBe('class');

    // Public parameter property is included
    expect(config!.signature).toContain('host: string');
    // Private/protected parameter properties excluded
    expect(config!.signature).not.toContain('port');
    expect(config!.signature).not.toContain('scheme');
  });

  it('should extract abstract class with abstract methods', async () => {
    const symbols = await extractSymbols(fixture('symbols-class', 'classes.ts'));
    const base = findSymbol(symbols, 'BaseEntity');

    expect(base).toBeDefined();
    expect(base!.kind).toBe('class');
    expect(base!.signature).toContain('getId(): string');
    expect(base!.signature).toContain('toString(): string');
  });

  it('should include static members in signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-class', 'classes.ts'));
    const math = findSymbol(symbols, 'MathUtils');

    expect(math).toBeDefined();
    expect(math!.kind).toBe('class');
    expect(math!.signature).toContain('static');
    expect(math!.signature).toContain('PI');
    expect(math!.signature).toContain('add');
  });

  it('should represent getter/setter as property in signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-class', 'classes.ts'));
    const temp = findSymbol(symbols, 'Temperature');

    expect(temp).toBeDefined();
    expect(temp!.kind).toBe('class');
    // Getter/setter should appear as property
    expect(temp!.signature).toContain('fahrenheit');
    // Private member excluded
    expect(temp!.signature).not.toContain('_celsius');
  });

  it('should extract generic class with type parameters in signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-class', 'classes.ts'));
    const container = findSymbol(symbols, 'Container');

    expect(container).toBeDefined();
    expect(container!.kind).toBe('class');
    expect(container!.signature).toContain('<T>');
    expect(container!.signature).toContain('add(item: T): void');
    expect(container!.signature).toContain('get(index: number): T');
  });
});

describe('Symbol Extractor: Enum Extraction', () => {
  it('should extract basic enum with member names in signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-enum', 'enums.ts'));
    const direction = findSymbol(symbols, 'Direction');

    expect(direction).toBeDefined();
    expect(direction!.kind).toBe('enum');
    expect(direction!.exported).toBe(true);
    expect(direction!.signature).toBe('{ Up, Down, Left, Right }');
  });

  it('should extract string enum', async () => {
    const symbols = await extractSymbols(fixture('symbols-enum', 'enums.ts'));
    const color = findSymbol(symbols, 'Color');

    expect(color).toBeDefined();
    expect(color!.kind).toBe('enum');
    expect(color!.signature).toBe('{ Red, Green, Blue }');
  });

  it('should extract const enum as kind enum', async () => {
    const symbols = await extractSymbols(fixture('symbols-enum', 'enums.ts'));
    const flags = findSymbol(symbols, 'Flags');

    expect(flags).toBeDefined();
    // DD 1: const enum is also captured as kind 'enum'
    expect(flags!.kind).toBe('enum');
    expect(flags!.signature).toBe('{ A, B, C }');
  });
});

describe('Symbol Extractor: Type Alias and Variable Extraction', () => {
  it('should extract union type alias with right-hand side as signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-type-variable', 'types-and-vars.ts'));
    const status = findSymbol(symbols, 'Status');

    expect(status).toBeDefined();
    expect(status!.kind).toBe('type');
    expect(status!.exported).toBe(true);
    expect(status!.signature).toBe("'active' | 'inactive'");
  });

  it('should extract typed const with type annotation as signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-type-variable', 'types-and-vars.ts'));
    const maxRetries = findSymbol(symbols, 'MAX_RETRIES');

    expect(maxRetries).toBeDefined();
    expect(maxRetries!.kind).toBe('variable');
    expect(maxRetries!.exported).toBe(true);
    expect(maxRetries!.signature).toBe('number');
  });

  it('should extract untyped const with (inferred) as signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-type-variable', 'types-and-vars.ts'));
    const defaultName = findSymbol(symbols, 'DEFAULT_NAME');

    expect(defaultName).toBeDefined();
    expect(defaultName!.kind).toBe('variable');
    // DD 7: Variables without type annotation captured with signature '(inferred)'
    expect(defaultName!.signature).toBe('(inferred)');
  });

  it('should extract typed variable with complex type as signature', async () => {
    const symbols = await extractSymbols(fixture('symbols-type-variable', 'types-and-vars.ts'));
    const handlers = findSymbol(symbols, 'handlers');

    expect(handlers).toBeDefined();
    expect(handlers!.kind).toBe('variable');
    expect(handlers!.signature).toBe('Map<string, Handler>');
  });

  it('should extract destructured export as individual variable entries', async () => {
    const symbols = await extractSymbols(fixture('symbols-type-variable', 'types-and-vars.ts'));
    const a = findSymbol(symbols, 'a');
    const b = findSymbol(symbols, 'b');

    expect(a).toBeDefined();
    expect(a!.kind).toBe('variable');
    expect(a!.exported).toBe(true);

    expect(b).toBeDefined();
    expect(b!.kind).toBe('variable');
    expect(b!.exported).toBe(true);
  });

  it('should extract non-exported variable with exported false', async () => {
    const symbols = await extractSymbols(fixture('symbols-type-variable', 'types-and-vars.ts'));
    const internal = findSymbol(symbols, 'internal');

    expect(internal).toBeDefined();
    expect(internal!.kind).toBe('variable');
    expect(internal!.exported).toBe(false);
  });

  it('should extract non-exported type alias with exported false', async () => {
    const symbols = await extractSymbols(fixture('symbols-type-variable', 'types-and-vars.ts'));
    const privateType = findSymbol(symbols, 'PrivateType');

    expect(privateType).toBeDefined();
    expect(privateType!.kind).toBe('type');
    expect(privateType!.exported).toBe(false);
  });
});

describe('Symbol Extractor: Empty and Edge Cases', () => {
  it('should return empty array for file with no declarations', async () => {
    const symbols = await extractSymbols(fixture('symbols-empty', 'empty.ts'));

    expect(symbols).toEqual([]);
  });

  it('should return empty array for syntax error file', async () => {
    const symbols = await extractSymbols(fixture('..', 'syntax-error', 'bad.ts'));

    expect(symbols).toEqual([]);
  });
});
