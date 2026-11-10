import { Injectable, Logger } from '@nestjs/common';
import type { AuditLogEntry, AuditLogQuery, Paginated } from '@payana/contracts';
import type { AuthUser } from '../auth/auth.types.js';
import { Db, json } from '../db/db.service.js';
import { pageWindow, paginated } from '../http/pagination.js';
import { currentRequest } from '../http/request-context.js';
import { isoReq } from '../money.js';

export interface AuditInput {
  /** The signed-in actor, or a label for unauthenticated / system events. */
  actor: AuthUser | { id: string | null; label: string } | 'system';
  /** Dotted verb, e.g. "document.approved". */
  action: string;
  targetType?: string;
  targetId?: string;
  /** Non-sensitive context only. Never secrets, one-time codes or full document numbers. */
  metadata?: Record<string, unknown>;
}

interface AuditRow {
  id: string;
  at: Date;
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  request_id: string | null;
}

/**
 * The single writer of the audit trail. Rows are append-only: the service
 * exposes no update or delete.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly db: Db) {}

  async record(input: AuditInput): Promise<void> {
    const ctx = currentRequest();
    let actorId: string | null = null;
    let actorLabel = 'system';
    if (input.actor !== 'system') {
      if ('label' in input.actor) {
        actorId = input.actor.id;
        actorLabel = input.actor.label;
      } else {
        actorId = input.actor.id;
        actorLabel =
          input.actor.email ?? input.actor.displayName ?? (input.actor.adminRole ? 'administrator' : 'user');
      }
    }
    try {
      await this.db.insert('audit_logs', {
        actor_id: actorId,
        actor_label: actorLabel,
        action: input.action,
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        metadata: json(input.metadata ?? {}),
        ip: ctx.ip,
        request_id: ctx.requestId,
      });
    } catch (err) {
      // Inside a transaction a failed audit write must fail the operation.
      if (this.db.inTransaction) throw err;
      this.logger.error({ err, action: input.action }, 'Failed to write audit log entry');
    }
  }

  async list(q: AuditLogQuery): Promise<Paginated<AuditLogEntry>> {
    const w = pageWindow(q);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.action) add(`action LIKE ? || '%'`, q.action);
    if (q.actorId) add(`actor_id = ?`, q.actorId);
    if (q.targetType) add(`target_type = ?`, q.targetType);
    if (q.from) add(`at >= ?::date`, q.from);
    if (q.to) add(`at < (?::date + 1)`, q.to);
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs ${cond}`, params);
    const rows = await this.db.query<AuditRow>(
      `SELECT * FROM audit_logs ${cond} ORDER BY at DESC, id DESC LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );
    return paginated(
      rows.map((r) => ({
        id: r.id,
        at: isoReq(r.at),
        actorId: r.actor_id,
        actorLabel: r.actor_label,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        metadata: r.metadata,
        ip: r.ip,
        requestId: r.request_id,
      })),
      total?.n ?? 0,
      w,
    );
  }
}
