import type { Lens } from './types.js';

/**
 * Built-in lenses that ship with Mappa Mundi.
 * Users can delete these from their local store, but they'll
 * reappear on next startup unless explicitly hidden.
 */

export const BUILTIN_COMPOUND_LENSES: Omit<Lens, 'createdAt'>[] = [
  {
    id: 'compound-architectural-layer',
    name: 'Architectural Layers',
    type: 'compound',
    prompt:
      'Group the code into architectural layers: presentation/UI, business logic/domain, data access/infrastructure, and shared utilities. Prioritize separation of concerns over directory structure.',
    builtIn: true,
  },
  {
    id: 'compound-data-flow',
    name: 'Data Flow Stages',
    type: 'compound',
    prompt:
      'Group the code by data flow stage: input/ingestion, transformation/processing, storage/persistence, and output/rendering. Follow how data moves through the system.',
    builtIn: true,
  },
  {
    id: 'compound-team-ownership',
    name: 'Team Ownership',
    type: 'compound',
    prompt:
      'Group the code by likely team ownership boundaries. Modules that would naturally be owned by the same team (based on domain cohesion, shared conventions, and coupling) should be grouped together.',
    builtIn: true,
  },
  {
    id: 'compound-security-domain',
    name: 'Security Domains',
    type: 'compound',
    prompt:
      'Group the code by security domain: public-facing/untrusted input, authentication/authorization, internal/trusted processing, and sensitive data handling. Highlight trust boundaries.',
    builtIn: true,
  },
];

export const BUILTIN_LAYER_LENSES: Omit<Lens, 'createdAt'>[] = [
  {
    id: 'layer-change-risk',
    name: 'Change Risk',
    type: 'layer',
    prompt:
      'Rate each region by how risky it would be to change. Consider: number of dependents, complexity of logic, lack of tests, and how central it is to the system. Score 0 = safe to change, 1 = very risky.',
    builtIn: true,
  },
  {
    id: 'layer-api-surface',
    name: 'API Surface Exposure',
    type: 'layer',
    prompt:
      'Rate each region by how much public API surface it exposes. Consider: number of exported symbols, whether it defines interfaces consumed by external code, and how many other regions depend on its exports. Score 0 = internal/private, 1 = heavily exposed.',
    builtIn: true,
  },
  {
    id: 'layer-tech-debt',
    name: 'Technical Debt',
    type: 'layer',
    prompt:
      'Rate each region by apparent technical debt. Consider: code duplication hints, overly complex logic, poor separation of concerns, inconsistent patterns, and workarounds. Score 0 = clean, 1 = heavy debt.',
    builtIn: true,
  },
];

export const ALL_BUILTIN_LENSES = [
  ...BUILTIN_COMPOUND_LENSES,
  ...BUILTIN_LAYER_LENSES,
];
