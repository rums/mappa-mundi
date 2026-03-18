// Basic exported function
export function authenticate(token: string): Promise<User> {
  return {} as any;
}

// Function with no parameters
export function getVersion(): string {
  return '1.0';
}

// Function with no return type annotation
export function doSomething() {
  console.log('hi');
}

// Default parameter values
export function greet(name: string = 'world'): string {
  return `Hello ${name}`;
}

// Rest parameters
export function concat(...args: string[]): string {
  return args.join('');
}

// Async function
export async function fetchData(): Promise<Data> {
  return {} as any;
}

// Generic function
export function identity<T>(x: T): T {
  return x;
}

// Non-exported function
function helper(): void {
  // internal
}

// Overloaded function
export function parse(input: string): number;
export function parse(input: number): string;
export function parse(input: string | number): string | number {
  return typeof input === 'string' ? parseInt(input) : String(input);
}

// Arrow function as const (should be variable, not function)
export const transform = (x: string): string => x.toUpperCase();

interface User { name: string }
interface Data { value: number }
