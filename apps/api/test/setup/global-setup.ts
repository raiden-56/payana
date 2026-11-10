import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Redis } from 'ioredis';
import pg from 'pg';
import { createDataSource } from '../../src/common/db/data-source.js';
import { applyTestEnv } from './test-env.js';

/**
 * Runs once before the end-to-end suite: recreates the test database from
 * nothing, applies every migration (which is itself a test that they run on
 * an empty database), and clears the test Redis database.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes('test')) {
    throw new Error(`Refusing to recreate database "${dbName}": the test database name must contain "test".`);
  }

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await client.end();
  }

  const ds = createDataSource(url.toString());
  await ds.initialize();
  try {
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await ds.destroy();
  }

  const redis = new Redis(process.env.REDIS_URL!);
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
  await rm(resolve(process.cwd(), '.storage-test'), { recursive: true, force: true });
}
