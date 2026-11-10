import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, QueryRunner } from 'typeorm';

/** Marks a value that must be sent to Postgres as jsonb (arrays included). */
export class JsonValue {
  constructor(readonly value: unknown) {}
}
export const json = (value: unknown): JsonValue => new JsonValue(value);

interface TxState {
  runner: QueryRunner;
  afterCommit: (() => unknown)[];
}

/**
 * SQL-first data access on top of the TypeORM DataSource (connection pool,
 * transactions, migrations).
 *
 * `tx()` opens a transaction and stores it in AsyncLocalStorage, so every
 * `query()` issued anywhere below it - in this service or in a service
 * exported by another module - joins the same transaction without passing a
 * handle around. Nested `tx()` calls join the outer transaction.
 */
@Injectable()
export class Db {
  private readonly als = new AsyncLocalStorage<TxState>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.run(sql, params);
    return (result.records ?? []) as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /** Runs a statement and returns the number of affected rows. */
  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.run(sql, params);
    return result.affected ?? 0;
  }

  async insert<T = Record<string, unknown>>(table: string, values: Record<string, unknown>): Promise<T> {
    const cols = Object.keys(values).filter((k) => values[k] !== undefined);
    const params: unknown[] = [];
    const placeholders = cols.map((c) => this.bind(values[c], params));
    const rows = await this.query<T>(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      params,
    );
    return rows[0] as T;
  }

  /** Updates rows matching every `where` equality and returns the first updated row. */
  async update<T = Record<string, unknown>>(
    table: string,
    where: Record<string, unknown>,
    values: Record<string, unknown>,
  ): Promise<T | null> {
    const cols = Object.keys(values).filter((k) => values[k] !== undefined);
    const params: unknown[] = [];
    if (cols.length === 0) {
      const cond = Object.keys(where).map((k) => `${k} = ${this.bind(where[k], params)}`);
      return this.one<T>(`SELECT * FROM ${table} WHERE ${cond.join(' AND ')}`, params);
    }
    const sets = cols.map((c) => `${c} = ${this.bind(values[c], params)}`);
    const cond = Object.keys(where).map((k) => `${k} = ${this.bind(where[k], params)}`);
    const rows = await this.query<T>(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE ${cond.join(' AND ')} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn();
    const runner = this.dataSource.createQueryRunner();
    const state: TxState = { runner, afterCommit: [] };
    await runner.connect();
    await runner.startTransaction();
    let result: T;
    try {
      result = await this.als.run(state, fn);
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction().catch(() => undefined);
      throw err;
    } finally {
      await runner.release();
    }
    for (const hook of state.afterCommit) {
      try {
        await hook();
      } catch {
        // After-commit hooks are best-effort (for example nudging the outbox);
        // the durable record is already committed.
      }
    }
    return result;
  }

  /** Runs `fn` once the surrounding transaction commits (immediately when there is none). */
  afterCommit(fn: () => unknown): void {
    const state = this.als.getStore();
    if (state) state.afterCommit.push(fn);
    else void Promise.resolve().then(fn).catch(() => undefined);
  }

  get inTransaction(): boolean {
    return this.als.getStore() !== undefined;
  }

  private bind(value: unknown, params: unknown[]): string {
    if (value instanceof JsonValue) {
      params.push(JSON.stringify(value.value));
      return `$${params.length}::jsonb`;
    }
    params.push(value);
    return `$${params.length}`;
  }

  private async run(sql: string, params: unknown[]): Promise<{ records?: unknown[]; affected?: number }> {
    const bound = params.map((p) => (p instanceof JsonValue ? JSON.stringify(p.value) : p));
    const state = this.als.getStore();
    if (state) return state.runner.query(sql, bound, true);
    const runner = this.dataSource.createQueryRunner();
    try {
      return await runner.query(sql, bound, true);
    } finally {
      await runner.release();
    }
  }
}
