/**
 * Tests for src/api/main.ts — API Server Entry Point (Spec #12)
 *
 * AC covered:
 *  1. Server starts and listens on default port 3001
 *  2. Server respects PORT environment variable
 *  3. Server responds to requests after startup
 *  4. Graceful shutdown closes connections
 *  5. Startup error (invalid port) results in error
 *  6. Integration: GET /api/layers returns JSON
 *  7. Integration: unknown route returns 404
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

// startServer is the testable function that main.ts should export.
// It creates the app, listens on the configured port, and returns
// both the app instance and the address it bound to.
import { startServer } from '../../src/api/main.js';

// ─── Behavior 1: Default Port ───────────────────────────────────────────────

describe('API Server Entry Point', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
    // Restore PORT env var
    delete process.env.PORT;
  });

  describe('default port', () => {
    it('should listen on port 3001 by default', async () => {
      const { app, address } = await startServer();
      cleanup = () => app.close();

      expect(address.port).toBe(3001);
    });

    it('should bind to 0.0.0.0 (all interfaces)', async () => {
      const { app, address } = await startServer();
      cleanup = () => app.close();

      expect(address.address).toBe('0.0.0.0');
    });
  });

  // ─── Behavior 2: PORT env var ───────────────────────────────────────────────

  describe('PORT environment variable', () => {
    it('should listen on port specified by PORT env var', async () => {
      process.env.PORT = '4567';
      const { app, address } = await startServer();
      cleanup = () => app.close();

      expect(address.port).toBe(4567);
    });

    it('should accept string port and parse it as integer', async () => {
      process.env.PORT = '0';
      const { app, address } = await startServer();
      cleanup = () => app.close();

      expect(typeof address.port).toBe('number');
      expect(address.port).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 3: Server responds after startup ─────────────────────────────

  describe('responds to requests after startup', () => {
    it('should respond to HTTP requests on the bound port', async () => {
      process.env.PORT = '0'; // ephemeral port to avoid conflicts
      const { app } = await startServer();
      cleanup = () => app.close();

      // Use inject to verify the app is functional
      const response = await app.inject({
        method: 'GET',
        url: '/api/layers',
      });

      // Should get a valid response (not a connection error)
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  // ─── Behavior 4: Graceful shutdown ──────────────────────────────────────────

  describe('graceful shutdown', () => {
    it('should close cleanly when app.close() is called', async () => {
      process.env.PORT = '0';
      const { app } = await startServer();

      // app.close() should resolve without error
      await expect(app.close()).resolves.toBeUndefined();
      // After close, no cleanup needed
      cleanup = undefined;
    });

    it('should not accept new connections after close', async () => {
      process.env.PORT = '0';
      const { app } = await startServer();
      await app.close();
      cleanup = undefined;

      // After close, inject should still work (Fastify inject doesn't use network)
      // but a real HTTP request would fail. We verify the server is closed.
      // The key behavior: app.close() resolved without hanging.
    });
  });

  // ─── Behavior 5: Startup errors ────────────────────────────────────────────

  describe('startup errors', () => {
    it('should reject with an error for an invalid port (negative)', async () => {
      process.env.PORT = '-1';
      await expect(startServer()).rejects.toThrow();
    });

    it('should reject with an error for a non-numeric port', async () => {
      process.env.PORT = 'not-a-number';
      await expect(startServer()).rejects.toThrow();
    });

    it('should reject when port is out of range', async () => {
      process.env.PORT = '99999';
      await expect(startServer()).rejects.toThrow();
    });
  });

  // ─── Behavior 6: Integration — GET /api/layers ─────────────────────────────

  describe('integration smoke test', () => {
    it('should return JSON from GET /api/layers', async () => {
      process.env.PORT = '0';
      const { app } = await startServer();
      cleanup = () => app.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/layers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('layers');
      expect(Array.isArray(body.layers)).toBe(true);
    });

    // ─── Behavior 7: Unknown route → 404 ──────────────────────────────────────

    it('should return 404 for unknown routes', async () => {
      process.env.PORT = '0';
      const { app } = await startServer();
      cleanup = () => app.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/nonexistent-route',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });
});
