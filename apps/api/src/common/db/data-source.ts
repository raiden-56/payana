import { DataSource, type DataSourceOptions } from 'typeorm';
import { InitialSchema1762700000000 } from '../../database/migrations/1762700000000-initial-schema.js';
import { ReferenceData1762700000100 } from '../../database/migrations/1762700000100-reference-data.js';

export const MIGRATIONS = [InitialSchema1762700000000, ReferenceData1762700000100];

export function dataSourceOptions(databaseUrl: string, ssl: boolean): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    ssl: ssl ? { rejectUnauthorized: true } : false,
    entities: [],
    migrations: MIGRATIONS,
    migrationsTableName: 'schema_migrations',
    synchronize: false,
    migrationsRun: false,
    logging: ['error', 'warn'],
    // Sessions run in India time so CURRENT_DATE and date arithmetic follow the market's calendar
    // (document expiry, featured-listing days). Timestamps are timestamptz and unaffected.
    extra: { max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, options: '-c TimeZone=Asia/Kolkata' },
  };
}

export function createDataSource(databaseUrl: string, ssl = false): DataSource {
  return new DataSource(dataSourceOptions(databaseUrl, ssl));
}
