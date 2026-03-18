# Spec 11: Analysis API — Project Scan Orchestrator

> GitHub Issue: #11
> Dependencies: All previous specs (#1-10)
> Status: ready for TDD

## Intent

Build the REST API that ties together structural scanning, LLM interpretation, caching, layer computation, and search into a unified backend. This is the single surface the web frontend talks to.

## Scope

### In Scope
- 6 REST endpoints (see below)
- Async pattern for long-running operations (scan, refresh)
- Project context management (single active project per server)
- Error handling with consistent response format
- Integration with all upstream modules

### Out of Scope
- Authentication/authorization (localhost-only for v1)
- Multi-project concurrent support (single project at a time)
- WebSocket push (defer to v2)
- Rate limiting
- HTTPS (run behind a reverse proxy if needed)

## API Endpoints

```
POST /api/scan          — Start a project scan
GET  /api/jobs/:jobId   — Poll async job status
GET  /api/zoom/:regionId — Get sub-regions for a region
GET  /api/layers         — List available layers
GET  /api/layers/:layerId — Get layer scores
GET  /api/search         — Search the semantic map
POST /api/refresh        — Re-scan and invalidate cache
```

## Request/Response Schemas

```typescript
// POST /api/scan
// Request:
{ projectPath: string }
// Response (202):
{ jobId: string, status: "queued" }

// GET /api/jobs/:jobId
// Response (200 - pending):
{ jobId: string, status: "running", startedAt: string }
// Response (200 - complete):
{ jobId: string, status: "completed", result: SemanticMap }
// Response (200 - failed):
{ jobId: string, status: "failed", error: string }

// GET /api/zoom/:regionId
// Response (200 - cached):
{ level: SemanticZoomLevel, cached: true }
// Response (202 - generating):
{ jobId: string, status: "generating" }

// GET /api/layers
// Response (200):
{ layers: Array<{ id: string, name: string, description: string }> }

// GET /api/layers/:layerId?regionId=X&depth=N
// Response (200):
{ layerId: string, moduleScores: Record<string, LayerScore>, regionScores?: Record<string, LayerScore> }

// GET /api/search?q=query&maxResults=20&enableLLM=true
// Response (200):
{ results: SearchResult[], query: string }

// POST /api/refresh
// Response (202):
{ jobId: string, status: "queued" }

// Error response (all endpoints):
{ error: { code: string, message: string, details?: unknown } }
```

## Design Decisions

1. **Single active project**: server holds one scanned project in memory. `POST /api/scan` replaces any existing project. Simplifies state management for v1.
2. **Async scan and refresh**: both return 202 with a jobId. Client polls `GET /api/jobs/:jobId`. Jobs have states: `queued → running → completed | failed`.
3. **Zoom can be sync or async**: if cached, returns immediately (200). If LLM generation needed, returns 202 with jobId for polling.
4. **Layer endpoint scoping**: `GET /api/layers/:layerId` accepts optional `regionId` query param to scope scores to a specific region's modules. Without it, returns scores for all modules.
5. **Job lifecycle**: completed/failed jobs are retained for 5 minutes, then cleaned up. Polling an expired job returns 404.
6. **Project path validation**: `POST /api/scan` validates that the path exists, is a directory, and contains at least one `.ts`/`.js` file. Path traversal attempts (e.g., `../../etc`) are rejected.
7. **Scan pipeline**: `POST /api/scan` orchestrates: structural scan (Specs #1-3) → top-level clustering (Spec #5) → cache initial zoom level (Spec #4).
8. **Refresh pipeline**: `POST /api/refresh` re-runs structural scan, computes new sourceHashes, invalidates changed cache entries (Spec #4), re-clusters only if structural data changed significantly.
9. **CORS**: enabled for `localhost:*` origins by default.
10. **Framework**: Fastify (fast, TypeScript-native, schema validation built-in).

## Acceptance Criteria

1. `POST /api/scan` with valid path returns 202 with jobId
2. `GET /api/jobs/:jobId` returns job status (running/completed/failed)
3. Completed scan job result contains a valid SemanticMap
4. `GET /api/zoom/:regionId` returns cached sub-regions (200) or triggers generation (202)
5. `GET /api/layers` lists all registered layers
6. `GET /api/layers/:layerId` returns scores for all modules
7. `GET /api/layers/:layerId?regionId=X` returns scores scoped to region's modules
8. `GET /api/search?q=authentication` returns ranked SearchResults
9. `POST /api/refresh` returns 202 and re-scans
10. Invalid project path → 400 with descriptive error
11. Unknown regionId → 404
12. Unknown layerId → 404
13. Unknown jobId → 404
14. Scan already in progress + new scan request → 409 conflict
15. All error responses follow consistent `{ error: { code, message } }` format

## Test Plan

### Behavior 1: Scan lifecycle
- POST /api/scan with valid path → 202 with jobId
- GET /api/jobs/:jobId while running → status: "running"
- GET /api/jobs/:jobId after completion → status: "completed" with SemanticMap
- POST /api/scan with nonexistent path → 400
- POST /api/scan with file (not directory) → 400
- POST /api/scan while scan in progress → 409

### Behavior 2: Job polling
- Poll running job → status: running
- Poll completed job → status: completed with result
- Poll failed job → status: failed with error
- Poll unknown jobId → 404
- Poll expired job (>5 min) → 404

### Behavior 3: Zoom endpoint
- Zoom into region with cached data → 200 with SemanticZoomLevel
- Zoom into region without cache → 202 with jobId (triggers LLM)
- Zoom with unknown regionId → 404
- Zoom before scan → 400 "no project scanned"

### Behavior 4: Layers endpoint
- GET /api/layers → list of available layers with metadata
- GET /api/layers/:layerId → all module scores
- GET /api/layers/:layerId?regionId=X → scores scoped to region
- Unknown layerId → 404
- Layer requiring external data (coverage report) not available → 200 with empty scores + warning

### Behavior 5: Search endpoint
- GET /api/search?q=authentication → ranked results
- GET /api/search?q= (empty) → empty results
- GET /api/search?q=xyz&enableLLM=false → only symbol/region results
- GET /api/search?q=xyz&maxResults=5 → at most 5 results
- Search before scan → 400 "no project scanned"

### Behavior 6: Refresh
- POST /api/refresh → 202 with jobId
- After refresh, changed regions have fresh data
- Refresh before initial scan → 400

### Behavior 7: Error handling
- All 400/404/409/500 responses match error schema
- Unhandled exception → 500 with generic message (no stack traces in response)
- Malformed JSON body → 400

## Implementation Notes

- Framework: Fastify with `@fastify/cors`
- Entry point: `src/api/server.ts`
- Job queue: in-memory Map of jobId → { status, result, startedAt, completedAt }
- Layout:
  ```
  src/
    api/
      server.ts           — Fastify app setup, CORS, error handler
      routes/
        scan.ts           — POST /api/scan
        jobs.ts           — GET /api/jobs/:jobId
        zoom.ts           — GET /api/zoom/:regionId
        layers.ts         — GET /api/layers, GET /api/layers/:layerId
        search.ts         — GET /api/search
        refresh.ts        — POST /api/refresh
      middleware/
        error-handler.ts  — consistent error response formatting
        validate-project.ts — project path validation
      orchestrator.ts     — scan/refresh pipeline coordination
  ```
