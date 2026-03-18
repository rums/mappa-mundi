// Union type alias
export type Status = 'active' | 'inactive';

// Complex mapped type
export type Readonly<T> = {
  readonly [P in keyof T]: T[P];
};

// Typed const
export const MAX_RETRIES: number = 100;

// Untyped const (inferred)
export const DEFAULT_NAME = 'world';

// Typed variable with complex type
export const handlers: Map<string, Handler> = new Map();

// Destructured export (individual variable entries)
export const { a, b } = { a: 1, b: 2 };

// Non-exported variable
const internal = 42;

// Non-exported type
type PrivateType = string | number;

interface Handler {
  handle(): void;
}
