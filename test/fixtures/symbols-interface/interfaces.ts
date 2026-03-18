// Basic interface with fields
export interface User {
  name: string;
  email: string;
}

// Empty interface
export interface Empty {}

// Interface extending another
export interface Admin extends User {
  role: string;
}

// Optional fields
export interface Config {
  host: string;
  port?: number;
}

// Method signatures on interface
export interface Validator {
  validate(): boolean;
  format(input: string): string;
}

// Index signature
export interface Dictionary {
  [key: string]: unknown;
}

// Generic interface
export interface Response<T> {
  data: T;
  status: number;
}

// Non-exported interface
interface Internal {
  secret: string;
}
