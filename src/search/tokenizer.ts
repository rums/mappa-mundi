/**
 * Split a name into tokens based on camelCase, PascalCase, snake_case, and kebab-case.
 */
export function splitTokens(name: string): string[] {
  if (!name) return [];

  // First split on underscores and hyphens
  const parts = name.split(/[_\-]/);
  const tokens: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    // Split camelCase/PascalCase
    // Handle sequences like "validateJWT" -> ["validate", "JWT"]
    // and "JWTValidator" -> ["JWT", "Validator"]
    const camelTokens = part.match(/[A-Z]{2,}(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]{2,}|[A-Z]/g);
    if (camelTokens) {
      tokens.push(...camelTokens);
    } else {
      tokens.push(part);
    }
  }

  return tokens;
}

/**
 * Compute a 0-1 match score based on token overlap between query and name.
 * Score = proportion of name tokens matched by query tokens (case insensitive).
 */
export function tokenMatch(query: string, name: string): number {
  // Split query by spaces first, then split each part into tokens
  const queryParts = query.split(/\s+/).filter(Boolean);
  const queryTokens: string[] = [];
  for (const part of queryParts) {
    queryTokens.push(...splitTokens(part));
  }

  const nameTokens = splitTokens(name);

  if (nameTokens.length === 0 || queryTokens.length === 0) return 0;

  const queryLower = queryTokens.map(t => t.toLowerCase());
  const nameLower = nameTokens.map(t => t.toLowerCase());

  let matched = 0;
  for (const nt of nameLower) {
    if (queryLower.some(qt => qt === nt)) {
      matched++;
    }
  }

  if (matched > 0) {
    return matched / nameLower.length;
  }

  // Fallback: check if the full query (lowercased, joined) equals full name (lowercased, joined)
  // This handles cases like 'validatejwt' vs 'validateJWT' where token splits differ
  const queryJoined = queryLower.join('');
  const nameJoined = nameLower.join('');
  if (queryJoined === nameJoined) {
    return 1.0;
  }

  // Check if any query token is a substring containing multiple name tokens
  for (const qt of queryLower) {
    let remaining = qt;
    let subMatched = 0;
    for (const nt of nameLower) {
      if (remaining.includes(nt)) {
        remaining = remaining.replace(nt, '');
        subMatched++;
      }
    }
    if (subMatched > 0 && remaining.length === 0) {
      return subMatched / nameLower.length;
    }
  }

  return 0;
}
