import { describe, it, expect } from 'vitest';
import { splitTokens, tokenMatch } from '../../src/search/tokenizer';

// ─── Behavior: Token Splitting ──────────────────────────────────────────────

describe('Tokenizer: splitTokens', () => {
  it('should split camelCase into tokens', () => {
    expect(splitTokens('validateJWT')).toEqual(['validate', 'JWT']);
  });

  it('should split snake_case into tokens', () => {
    expect(splitTokens('validate_jwt')).toEqual(['validate', 'jwt']);
  });

  it('should split kebab-case into tokens', () => {
    expect(splitTokens('validate-jwt')).toEqual(['validate', 'jwt']);
  });

  it('should split PascalCase into tokens', () => {
    expect(splitTokens('AuthenticationSystem')).toEqual(['Authentication', 'System']);
  });

  it('should handle consecutive uppercase (acronyms)', () => {
    // "validateJWT" → ["validate", "JWT"]
    // "JWTValidator" → ["JWT", "Validator"]
    expect(splitTokens('JWTValidator')).toEqual(['JWT', 'Validator']);
  });

  it('should return single token for simple words', () => {
    expect(splitTokens('auth')).toEqual(['auth']);
  });

  it('should handle empty string', () => {
    expect(splitTokens('')).toEqual([]);
  });

  it('should handle mixed delimiters', () => {
    expect(splitTokens('my_camelCase-name')).toEqual(['my', 'camel', 'Case', 'name']);
  });
});

// ─── Behavior: Token Matching ───────────────────────────────────────────────

describe('Tokenizer: tokenMatch', () => {
  it('should return score 1.0 for exact match', () => {
    const score = tokenMatch('validateJWT', 'validateJWT');
    expect(score).toBe(1.0);
  });

  it('should return partial score for partial token overlap', () => {
    const score = tokenMatch('validate', 'validateJWT');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1.0);
  });

  it('should be case insensitive', () => {
    const score = tokenMatch('validatejwt', 'validateJWT');
    expect(score).toBeGreaterThan(0);
  });

  it('should return 0 for no token overlap', () => {
    const score = tokenMatch('database', 'validateJWT');
    expect(score).toBe(0);
  });

  it('should match single query token against multi-token name', () => {
    // "JWT" should match "validateJWT"
    const score = tokenMatch('JWT', 'validateJWT');
    expect(score).toBeGreaterThan(0);
  });

  it('should match multi-word query against name tokens', () => {
    const score = tokenMatch('validate JWT', 'validateJWT');
    expect(score).toBe(1.0);
  });
});
