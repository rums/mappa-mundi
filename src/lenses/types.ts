/**
 * Semantic lens types.
 *
 * A "compound lens" controls how atoms are grouped into semantic regions
 * (injected into the clustering LLM prompt).
 *
 * A "layer lens" is an LLM-powered analysis layer that scores each
 * compound on a 0-1 scale using a custom prompt.
 */

export type LensType = 'compound' | 'layer';

export interface Lens {
  id: string;
  name: string;
  type: LensType;
  prompt: string;
  createdAt: string;
  builtIn: boolean;
}
