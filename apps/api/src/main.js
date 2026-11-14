import { createDatabase } from '@textanity/database';
import { createApp } from './app.js';

const database = createDatabase(process.env.DATABASE_URL);
const app = createApp({ database, logger: true });
database.on('error', (error) => app.log.error({ err: error }, 'Idle database connection error'));
app.addHook('onClose', async () => database.end());

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    try {
      await app.close();
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  });
}

try {
  await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
