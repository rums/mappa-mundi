# Spec 12: API Server Entry Point & Dev Script

> GitHub Issue: #35
> Dependencies: Spec #11 (Analysis API)
> Status: ready for TDD

## Intent

Create a runnable entry point for the Fastify API server so it can be started independently and alongside the Vite dev server. Currently `src/api/server.ts` exports `createApp()` but nothing calls it.

## Scope

### In Scope
- Server entry point (`src/api/main.ts`)
- npm scripts for running the API
- Vite proxy configuration for dev
- Graceful shutdown handling
- Configurable port via environment variable

### Out of Scope
- Production deployment (PM2, Docker, etc.)
- HTTPS/TLS termination
- Daemonization or process management
- Log rotation or structured logging

## Server Entry Point

### `src/api/main.ts`

```typescript
// Import createApp from server.ts
// Listen on configurable port (default 3001)
// Log startup URL
// Handle SIGINT/SIGTERM for graceful shutdown
// Exit non-zero on startup errors
```

**Port configuration:**
- Default: `3001`
- Override: `PORT` environment variable
- Host: `0.0.0.0` (accessible from Vite proxy)

**Graceful shutdown:**
- On SIGINT or SIGTERM: call `app.close()`, then `process.exit(0)`
- Log "shutting down..." message

**Error handling:**
- Port already in use → log error, exit 1
- Other startup errors → log error, exit 1

## npm Scripts

```json
{
  "start:api": "tsx src/api/main.ts",
  "dev:api": "tsx watch src/api/main.ts",
  "dev:full": "concurrently \"npm run dev\" \"npm run dev:api\""
}
```

**New devDependency:** `concurrently` (for `dev:full` script)
**Existing devDependency:** `tsx` (already available or add if needed)

## Vite Proxy Configuration

In `vite.config.ts` (create or extend):

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

This allows the React dev server (port 5173) to forward `/api/*` requests to Fastify (port 3001).

## Test Strategy

### Unit tests for `src/api/main.ts`
- Server starts and listens on default port
- Server respects `PORT` environment variable
- Server responds to requests after startup
- Graceful shutdown closes connections
- Startup error (invalid port) exits non-zero

### Integration smoke test
- Start server, hit `GET /api/layers`, verify JSON response
- Start server, hit unknown route, verify 404

## Acceptance Criteria
- `npm run start:api` boots the server, responds to HTTP requests on port 3001
- `PORT=4000 npm run start:api` listens on 4000
- SIGINT gracefully shuts down without hanging
- Vite dev server proxies `/api/*` to the API server
- `npm run dev:full` starts both servers concurrently
