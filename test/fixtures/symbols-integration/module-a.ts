import { helper } from './module-b';

export interface User {
  name: string;
}

export function greet(user: User): string {
  return helper(user.name);
}

export type Status = 'active' | 'inactive';
