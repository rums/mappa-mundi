export function useSearch() {
  return {
    query: '',
    setQuery: (_q: string) => {},
    results: [] as Array<{
      id: string;
      name: string;
      kind: 'module' | 'symbol' | 'region';
      score: number;
      context?: string;
    }>,
    loading: false,
    error: null as string | null,
    search: (_q: string) => {},
  };
}
