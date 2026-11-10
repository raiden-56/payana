import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { Db, json } from '../db/db.service.js';

interface OutboxRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 8;

/**
 * Transactional outbox. A module records a domain event with `publish()`
 * inside the same database transaction as the state change it describes.
 * The event is delivered to in-process listeners (notifications today) after
 * the commit, and retried by the poller if delivery fails or the process
 * dies in between - so a committed booking can never silently lose its
 * notification, and a rolled-back one can never send one.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger('Outbox');
  private draining = false;

  constructor(
    private readonly db: Db,
    private readonly emitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async publish(type: string, payload: object): Promise<void> {
    await this.db.insert('outbox_events', { type, payload: json(payload) });
    this.db.afterCommit(() => this.flush());
  }

  @Interval(5_000)
  protected async poll(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    await this.flush();
  }

  /** Delivers pending events. Safe to call concurrently and from several instances. */
  async flush(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let delivered = 0;
    const failed: string[] = [];
    try {
      for (let i = 0; i < 500; i++) {
        // One event per transaction: the row lock, the listeners' writes and
        // the "processed" mark commit together, or not at all.
        let current: OutboxRow | null = null;
        try {
          const done = await this.db.tx(async () => {
            current = await this.db.one<OutboxRow>(
              `SELECT id, type, payload, attempts FROM outbox_events
                WHERE processed_at IS NULL AND attempts < $1 AND id <> ALL($2::uuid[])
                ORDER BY created_at
                LIMIT 1
                FOR UPDATE SKIP LOCKED`,
              [MAX_ATTEMPTS, failed],
            );
            if (!current) return false;
            await this.emitter.emitAsync(current.type, current.payload);
            await this.db.exec(`UPDATE outbox_events SET processed_at = now() WHERE id = $1`, [current.id]);
            return true;
          });
          if (!done) break;
          delivered++;
        } catch (err) {
          const row = current as OutboxRow | null;
          if (!row) throw err;
          failed.push(row.id);
          this.logger.error({ err, eventId: row.id, type: row.type }, 'Outbox delivery failed');
          await this.db.exec(`UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [
            row.id,
            String((err as Error).message ?? err).slice(0, 500),
          ]);
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Outbox flush failed');
    } finally {
      this.draining = false;
    }
    return delivered;
  }
}
