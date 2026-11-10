/**
 * Migration runner.  node dist/database/migrate.js <up|down|status>
 *
 * Deliberately independent of the Nest application: it needs a database URL
 * and nothing else, so it can run as a one-off task before a deployment.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDataSource } from '../common/db/data-source.js';

async function main(): Promise<void> {
  const envFile = resolve(process.cwd(), process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(envFile)) process.loadEnvFile(envFile);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const command = process.argv[2] ?? 'up';
  const ds = createDataSource(url, process.env.DATABASE_SSL === 'true');
  await ds.initialize();
  try {
    if (command === 'up') {
      const ran = await ds.runMigrations({ transaction: 'each' });
      console.log(ran.length ? `Applied: ${ran.map((m) => m.name).join(', ')}` : 'Database is up to date.');
    } else if (command === 'down') {
      await ds.undoLastMigration({ transaction: 'each' });
      console.log('Reverted the most recent migration.');
    } else if (command === 'status') {
      const pending = await ds.showMigrations();
      console.log(pending ? 'There are pending migrations.' : 'Database is up to date.');
    } else {
      throw new Error(`Unknown command "${command}". Use up, down or status.`);
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
