import { Injectable } from '@nestjs/common';
import {
  TicketCategory,
  TicketPriority,
  TicketStatus,
  type CreateTicketRequest,
  type Paginated,
  type SupportTicket,
  type TicketListQuery,
  type TicketMessage,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { BookingsService } from '../../bookings/application/bookings.service.js';
import { TICKET_UPDATED_EVENT, type TicketUpdatedEvent } from './notifications.service.js';

interface TicketRow {
  id: string;
  reference: string;
  user_id: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  subject: string;
  booking_id: string | null;
  booking_code: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  ticket_id: string;
  author: 'user' | 'support';
  author_name: string;
  body: string;
  created_at: Date;
}

const SELECT = `SELECT t.*, b.code AS booking_code FROM support_tickets t LEFT JOIN bookings b ON b.id = t.booking_id`;

/** A safety report jumps the queue; money questions come next. */
export function priorityFor(category: TicketCategory): TicketPriority {
  if (category === TicketCategory.Safety) return TicketPriority.Urgent;
  if (
    category === TicketCategory.FareDispute ||
    category === TicketCategory.RefundRequest ||
    category === TicketCategory.AbuseReport ||
    category === TicketCategory.DriverBehaviour ||
    category === TicketCategory.CustomerBehaviour
  ) {
    return TicketPriority.High;
  }
  return TicketPriority.Normal;
}

/** Help, complaints, issue and abuse reports - for customers and partners - and the staff side of the same threads. */
@Injectable()
export class SupportService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly bookings: BookingsService,
  ) {}

  // --- account holder ----------------------------------------------------------------------

  async create(user: AuthUser, input: CreateTicketRequest): Promise<SupportTicket> {
    const id = await this.db.tx(async () => {
      if (input.bookingId) {
        // Throws unless the caller is a party to that booking.
        await this.bookings.referenceForParty(user, input.bookingId);
        if (input.category === TicketCategory.FareDispute) await this.bookings.markDisputed(user, input.bookingId);
      }
      const seq = await this.db.one<{ n: string }>(`SELECT nextval('ticket_reference_seq') AS n`);
      const ticket = await this.db.insert<TicketRow>('support_tickets', {
        reference: `T-${String(seq!.n).padStart(6, '0')}`,
        user_id: user.id,
        category: input.category,
        priority: priorityFor(input.category),
        subject: input.subject.trim(),
        booking_id: input.bookingId ?? null,
      });
      await this.db.insert('ticket_messages', {
        ticket_id: ticket.id,
        author: 'user',
        author_id: user.id,
        author_name: user.displayName ?? 'You',
        body: input.body.trim(),
      });
      if (ticket.priority === TicketPriority.Urgent) {
        await this.audit.record({ actor: user, action: 'support.urgent_ticket_opened', targetType: 'support_ticket', targetId: ticket.id, metadata: { category: input.category } });
      }
      return ticket.id;
    });
    return this.load(id);
  }

  async listOwn(user: AuthUser, q: TicketListQuery): Promise<Paginated<SupportTicket>> {
    return this.listWhere(`t.user_id = $1`, [user.id], q, 't.updated_at DESC');
  }

  async getOwn(user: AuthUser, ticketId: string): Promise<SupportTicket> {
    const ticket = await this.load(ticketId, user.id);
    return ticket;
  }

  async addUserMessage(user: AuthUser, ticketId: string, body: string): Promise<SupportTicket> {
    await this.db.tx(async () => {
      const ticket = await this.db.one<TicketRow>(`SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE`, [ticketId]);
      if (!ticket || ticket.user_id !== user.id) throw AppError.notFound('Ticket');
      if (ticket.status === TicketStatus.Closed) throw AppError.conflict('This ticket is closed. Open a new one if you still need help.');
      await this.db.insert('ticket_messages', {
        ticket_id: ticket.id,
        author: 'user',
        author_id: user.id,
        author_name: user.displayName ?? 'You',
        body: body.trim(),
      });
      // A reply from the user puts the ticket back in the staff queue.
      const next = ticket.status === TicketStatus.WaitingOnUser || ticket.status === TicketStatus.Resolved ? TicketStatus.InProgress : ticket.status;
      await this.db.exec(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [ticket.id, next]);
    });
    return this.load(ticketId, user.id);
  }

  // --- staff -----------------------------------------------------------------------------------

  async adminList(q: TicketListQuery): Promise<Paginated<SupportTicket>> {
    return this.listWhere(
      `true`,
      [],
      q,
      `(t.status IN ('resolved','closed')), CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.updated_at DESC`,
    );
  }

  async adminGet(ticketId: string): Promise<SupportTicket> {
    return this.load(ticketId);
  }

  async adminUpdate(ticketId: string, change: { status?: TicketStatus; priority?: TicketPriority }, actor: AuthUser): Promise<SupportTicket> {
    await this.db.tx(async () => {
      const ticket = await this.db.one<TicketRow>(`SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE`, [ticketId]);
      if (!ticket) throw AppError.notFound('Ticket');
      await this.db.update('support_tickets', { id: ticketId }, { status: change.status, priority: change.priority, updated_at: new Date() });
      await this.audit.record({
        actor,
        action: 'support.ticket_updated',
        targetType: 'support_ticket',
        targetId: ticketId,
        metadata: { status: change.status, priority: change.priority, previousStatus: ticket.status, previousPriority: ticket.priority },
      });
    });
    return this.load(ticketId);
  }

  async addSupportMessage(ticketId: string, body: string, actor: AuthUser): Promise<SupportTicket> {
    await this.db.tx(async () => {
      const ticket = await this.db.one<TicketRow>(`SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE`, [ticketId]);
      if (!ticket) throw AppError.notFound('Ticket');
      if (ticket.status === TicketStatus.Closed) throw AppError.conflict('This ticket is closed.');
      await this.db.insert('ticket_messages', {
        ticket_id: ticket.id,
        author: 'support',
        author_id: actor.id,
        author_name: 'Payana Support',
        body: body.trim(),
      });
      await this.db.exec(`UPDATE support_tickets SET status = 'waiting_on_user', updated_at = now() WHERE id = $1`, [ticket.id]);
      await this.outbox.publish(TICKET_UPDATED_EVENT, {
        userId: ticket.user_id,
        ticketId: ticket.id,
        reference: ticket.reference,
      } satisfies TicketUpdatedEvent);
      await this.audit.record({ actor, action: 'support.replied', targetType: 'support_ticket', targetId: ticket.id });
    });
    return this.load(ticketId);
  }

  async stats(): Promise<{ openTickets: number; urgentTickets: number }> {
    const r = await this.db.one<{ open: number; urgent: number }>(
      `SELECT count(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open,
              count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND priority = 'urgent')::int AS urgent
         FROM support_tickets`,
    );
    return { openTickets: r?.open ?? 0, urgentTickets: r?.urgent ?? 0 };
  }

  // --- internals ---------------------------------------------------------------------------------

  private async load(ticketId: string, ownerId?: string): Promise<SupportTicket> {
    const row = await this.db.one<TicketRow>(`${SELECT} WHERE t.id = $1`, [ticketId]);
    if (!row || (ownerId !== undefined && row.user_id !== ownerId)) throw AppError.notFound('Ticket');
    return (await this.toDtos([row]))[0]!;
  }

  private async listWhere(cond: string, params: unknown[], q: TicketListQuery, order: string): Promise<Paginated<SupportTicket>> {
    const w = pageWindow(q);
    let where = cond;
    if (q.status) {
      params.push(q.status);
      where += ` AND t.status = $${params.length}`;
    }
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM support_tickets t WHERE ${where}`, params);
    const rows = await this.db.query<TicketRow>(`${SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${w.limit} OFFSET ${w.offset}`, params);
    return paginated(await this.toDtos(rows), total?.n ?? 0, w);
  }

  private async toDtos(rows: TicketRow[]): Promise<SupportTicket[]> {
    if (rows.length === 0) return [];
    const messages = await this.db.query<MessageRow>(
      `SELECT * FROM ticket_messages WHERE ticket_id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [rows.map((t) => t.id)],
    );
    return rows.map((t) => ({
      id: t.id,
      reference: t.reference,
      category: t.category,
      status: t.status,
      priority: t.priority,
      subject: t.subject,
      bookingId: t.booking_id,
      bookingCode: t.booking_code,
      messages: messages
        .filter((m) => m.ticket_id === t.id)
        .map<TicketMessage>((m) => ({ id: m.id, author: m.author, authorName: m.author_name, body: m.body, createdAt: isoReq(m.created_at) })),
      createdAt: isoReq(t.created_at),
      updatedAt: isoReq(t.updated_at),
    }));
  }
}
