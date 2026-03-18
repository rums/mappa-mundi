# Spec 14: Client API Hooks

> GitHub Issue: #37
> Dependencies: Spec #11 (API types), Spec #13 (App shell to mount in)
> Status: ready for TDD

## Intent

Create React hooks that encapsulate all client-side API communication, providing clean interfaces for components to consume server data without embedding fetch logic.

## Scope

### In Scope
- Base fetch utility with error handling
- Hooks for scan, job polling, zoom, layers, and search
- Request cancellation (AbortController)
- Polling with cleanup on unmount
- TypeScript types matching API response shapes

### Out of Scope
- Caching layer (React Query, SWR) — keep it simple with useState/useEffect
- Optimistic updates
- Offline support
- WebSocket connections
- Retry logic (keep simple — fail and surface error)

## File Structure

```
src/hooks/
  useApi.ts          — base fetch utility
  useScan.ts         — scan + job polling
  useZoomLevel.ts    — fetch sub-level by regionId
  useLayers.ts       — list layers + fetch scores
  useSearch.ts       — debounced search with cancellation
```

## API Utility

### `src/hooks/useApi.ts`

```typescript
// Base URL: '' (relative — Vite proxy handles /api routing)
//
// fetchJson<T>(url: string, options?: RequestInit): Promise<T>
//   - Calls fetch(url, options)
//   - If !response.ok: throw ApiError with status + body message
//   - Parse and return JSON
//
// ApiError class:
//   - status: number
//   - message: string
//   - code?: string (from server error response)
```

## Hooks

### `src/hooks/useScan.ts`

```typescript
interface UseScanResult {
  scan: (projectPath: string) => Promise<void>;
  refresh: () => Promise<void>;
  status: 'idle' | 'scanning' | 'completed' | 'failed';
  data: SemanticZoomLevel | null;   // from completed job result
  error: string | null;
}
```

**Behavior:**
- `scan(path)` → POST `/api/scan` → receives `{ jobId }` → starts polling
- `refresh()` → POST `/api/refresh` → receives `{ jobId }` → starts polling
- Poll `GET /api/jobs/:jobId` every 1000ms while status is `queued` or `running`
- On `completed`: extract `result` field → set `data`, stop polling
- On `failed`: extract `error` field → set `error`, stop polling
- Cleanup: clear polling interval on unmount
- Calling `scan()` while already scanning: cancel previous poll, start new

### `src/hooks/useZoomLevel.ts`

```typescript
interface UseZoomLevelResult {
  data: SemanticZoomLevel | null;
  loading: boolean;
  error: string | null;
}

function useZoomLevel(regionId: string | null): UseZoomLevelResult
```

**Behavior:**
- When `regionId` is null → return `{ data: null, loading: false, error: null }`
- When `regionId` changes → fetch `GET /api/zoom/:regionId`
- Set `loading = true` during fetch
- On success → `data = response.level`
- On error → `error = message`
- Cancel in-flight request if regionId changes (AbortController)

### `src/hooks/useLayers.ts`

```typescript
interface UseLayersResult {
  layers: Array<{ id: string; name: string; description: string }>;
  activeLayerId: string | null;
  activateLayer: (id: string) => void;
  deactivateLayer: () => void;
  scores: Map<string, LayerScore> | null;
  scoresLoading: boolean;
}
```

**Behavior:**
- On mount → fetch `GET /api/layers` → populate `layers` list
- `activateLayer(id)` → set `activeLayerId`, fetch `GET /api/layers/:id` → populate `scores`
- `deactivateLayer()` → clear `activeLayerId` and `scores`
- `scoresLoading` is true while fetching layer scores
- Cancel in-flight score request if layer changes (AbortController)

### `src/hooks/useSearch.ts`

```typescript
interface UseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  search: (q: string) => void;  // immediate search (bypass debounce)
}
```

**Behavior:**
- `setQuery(q)` → update query state, debounce 300ms, then auto-search
- `search(q)` → immediate fetch `GET /api/search?q=encodeURIComponent(q)&maxResults=20`
- Cancel in-flight request on new search (AbortController)
- Empty query → clear results, don't fetch
- On success → populate `results`
- On error → set `error`

## Type Definitions

Import existing types from `src/types.ts`:
- `SemanticZoomLevel`, `Region`, `Relationship`
- `LayerScore` from `src/layers/types.ts`

Define search response type locally if not already in types:
```typescript
interface SearchResult {
  id: string;
  name: string;
  kind: 'module' | 'symbol' | 'region';
  score: number;
  context?: string;
}
```

## Test Strategy

All hooks tested with mocked `fetch` (vi.stubGlobal or msw-style mocking).

### useScan tests
- Initial state is idle with null data
- scan() posts to /api/scan and starts polling
- Polling fetches job status repeatedly
- Stops polling when job completes, sets data
- Stops polling when job fails, sets error
- Cleans up polling interval on unmount
- New scan() cancels previous polling

### useZoomLevel tests
- Returns null data when regionId is null
- Fetches zoom level when regionId provided
- Updates when regionId changes
- Handles fetch errors
- Cancels in-flight request on regionId change

### useLayers tests
- Fetches layer list on mount
- activateLayer fetches scores
- deactivateLayer clears scores
- Handles fetch errors for both list and scores

### useSearch tests
- Empty query returns no results
- setQuery debounces before searching
- search() fetches immediately
- Cancels previous in-flight request
- Handles fetch errors

## Acceptance Criteria
- All hooks are independently importable and testable
- No fetch calls leak after component unmount
- AbortController cancels stale requests
- Error states are always surfaced (never swallowed)
- TypeScript types match API response shapes exactly
- Zero coupling to specific UI components
