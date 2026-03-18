import { fileURLToPath } from 'url';
import { createApp } from './server.js';
import type { AddressInfo } from 'net';

export async function startServer() {
  const portStr = process.env.PORT;
  let port = 3001;
  const host = '0.0.0.0';

  if (portStr !== undefined) {
    const parsed = Number(portStr);
    if (!Number.isFinite(parsed) || parsed !== Math.floor(parsed)) {
      throw new Error(`Invalid port: ${portStr}`);
    }
    if (parsed < 0 || parsed > 65535) {
      throw new Error(`Port out of range: ${parsed}`);
    }
    port = parsed;
  }

  const app = await createApp();
  await app.listen({ port, host });

  const address = app.server.address() as AddressInfo;

  return { app, address };
}

// Entry point guard: start the server when run directly
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startServer()
    .then(({ app, address }) => {
      console.log(`API server listening on http://${address.address}:${address.port}`);

      const shutdown = async (signal: string) => {
        console.log(`Received ${signal}, shutting down…`);
        await app.close();
        process.exit(0);
      };

      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
