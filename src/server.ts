import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

const { httpServer } = createApp({ corsOrigin: CORS_ORIGIN });

httpServer.listen(PORT, () => {
  console.log(`Splendor server listening on :${PORT} (CORS origin: ${CORS_ORIGIN})`);
});
