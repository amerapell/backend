import { sql } from 'drizzle-orm';

/** Order statuses that count as a sale (money received). Shared by dashboard and customers queries. */
export const PAID_ORDER_STATUSES = ['PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED', 'EXCHANGE_REQUESTED', 'EXCHANGED'] as const;

/** `status IN (...)` list for raw SQL. */
export const PAID_STATUSES_SQL = sql.raw(`(${PAID_ORDER_STATUSES.map((s) => `'${s}'`).join(',')})`);
