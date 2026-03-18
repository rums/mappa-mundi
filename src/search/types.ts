export interface SearchResult {
  regionId: string;
  moduleId?: string;
  relevanceScore: number;
  explanation: string;
  matchLayer: 'symbol' | 'region' | 'llm';
}

export interface SearchOptions {
  maxResults?: number;           // default: 20
  enableLLM?: boolean;           // default: true
  escalationThreshold?: number;  // default: 3
}
