"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminTableDefinitions = void 0;
exports.findIdempotencyRecord = findIdempotencyRecord;
exports.insertIdempotencyRecord = insertIdempotencyRecord;
exports.insertOrder = insertOrder;
exports.getOrderById = getOrderById;
exports.getOrderByIdempotencyKey = getOrderByIdempotencyKey;
exports.updateOrderStatus = updateOrderStatus;
exports.insertPaymentAttempt = insertPaymentAttempt;
exports.getPaymentAttemptById = getPaymentAttemptById;
exports.getPaymentAttemptByProviderOrderId = getPaymentAttemptByProviderOrderId;
exports.updatePaymentAttempt = updatePaymentAttempt;
exports.insertProviderEvent = insertProviderEvent;
exports.insertSettlementRecord = insertSettlementRecord;
exports.getSettlementByAttemptId = getSettlementByAttemptId;
exports.insertLedgerEntry = insertLedgerEntry;
exports.insertAuditLog = insertAuditLog;
exports.countOrders = countOrders;
exports.countPaymentAttempts = countPaymentAttempts;
exports.listRecentOrders = listRecentOrders;
exports.listRecentPaymentAttempts = listRecentPaymentAttempts;
exports.listAdminTables = listAdminTables;
exports.listAdminTableRows = listAdminTableRows;
exports.updateAdminTableRow = updateAdminTableRow;
const web_1 = require("@libsql/client/web");
exports.adminTableDefinitions = {
    orders: {
        name: "orders",
        columns: [
            "id",
            "idempotency_key",
            "order_type",
            "item_name",
            "region",
            "amount",
            "currency",
            "note",
            "status",
            "active_payment_attempt_id",
            "created_at",
            "updated_at"
        ],
        editableColumns: [
            "idempotency_key",
            "order_type",
            "item_name",
            "region",
            "amount",
            "currency",
            "note",
            "status",
            "active_payment_attempt_id",
            "created_at",
            "updated_at"
        ],
        orderBy: "created_at"
    },
    payment_attempts: {
        name: "payment_attempts",
        columns: [
            "id",
            "order_id",
            "provider",
            "provider_order_id",
            "provider_capture_id",
            "status",
            "checkout_url",
            "amount",
            "currency",
            "created_at",
            "updated_at",
            "last_event_id"
        ],
        editableColumns: [
            "order_id",
            "provider",
            "provider_order_id",
            "provider_capture_id",
            "status",
            "checkout_url",
            "amount",
            "currency",
            "created_at",
            "updated_at",
            "last_event_id"
        ],
        orderBy: "created_at"
    },
    provider_events: {
        name: "provider_events",
        columns: [
            "id",
            "provider",
            "provider_event_id",
            "event_type",
            "source",
            "order_id",
            "attempt_id",
            "signature_verified",
            "payload",
            "received_at"
        ],
        editableColumns: [
            "provider",
            "provider_event_id",
            "event_type",
            "source",
            "order_id",
            "attempt_id",
            "signature_verified",
            "payload",
            "received_at"
        ],
        orderBy: "received_at"
    },
    settlement_records: {
        name: "settlement_records",
        columns: [
            "id",
            "attempt_id",
            "order_id",
            "currency",
            "gross_amount",
            "fee_amount",
            "net_amount",
            "status",
            "payout_reference",
            "created_at",
            "updated_at",
            "paid_out_at"
        ],
        editableColumns: [
            "attempt_id",
            "order_id",
            "currency",
            "gross_amount",
            "fee_amount",
            "net_amount",
            "status",
            "payout_reference",
            "created_at",
            "updated_at",
            "paid_out_at"
        ],
        orderBy: "created_at"
    },
    ledger_entries: {
        name: "ledger_entries",
        columns: ["id", "order_id", "attempt_id", "settlement_id", "type", "amount", "currency", "direction", "created_at", "metadata"],
        editableColumns: ["order_id", "attempt_id", "settlement_id", "type", "amount", "currency", "direction", "created_at", "metadata"],
        orderBy: "created_at"
    },
    audit_logs: {
        name: "audit_logs",
        columns: ["id", "entity_type", "entity_id", "action", "actor", "message", "metadata", "created_at"],
        editableColumns: ["entity_type", "entity_id", "action", "actor", "message", "metadata", "created_at"],
        orderBy: "created_at"
    },
    idempotency_records: {
        name: "idempotency_records",
        columns: ["id", "scope", "key", "resource_type", "resource_id", "created_at"],
        editableColumns: ["scope", "key", "resource_type", "resource_id", "created_at"],
        orderBy: "created_at"
    }
};
let schemaReady = null;
function getClient() {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
        throw new Error("Turso is not configured.");
    }
    return (0, web_1.createClient)({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    });
}
async function getTableColumns(client, tableName) {
    const result = await client.execute(`pragma table_info(${tableName})`);
    return new Set(result.rows.map((row) => String(row.name)));
}
async function dropTableIfShapeChanged(client, tableName, requiredColumns) {
    const columns = await getTableColumns(client, tableName);
    if (columns.size === 0) {
        return;
    }
    const hasRequiredShape = requiredColumns.every((column) => columns.has(column));
    if (!hasRequiredShape) {
        await client.execute(`drop table if exists ${tableName}`);
    }
}
async function ensureLegacyParentTables(client) {
    await client.execute("create table if not exists donation_intents (id text primary key)");
}
async function dropLegacyTables(client) {
    await client.batch([
        { sql: "drop table if exists checkout_attempts" },
        { sql: "drop table if exists donation_intents" }
    ], "write");
}
async function ensureSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            const client = getClient();
            await ensureLegacyParentTables(client);
            await dropTableIfShapeChanged(client, "ledger_entries", exports.adminTableDefinitions.ledger_entries.columns);
            await dropTableIfShapeChanged(client, "provider_events", exports.adminTableDefinitions.provider_events.columns);
            await dropTableIfShapeChanged(client, "settlement_records", exports.adminTableDefinitions.settlement_records.columns);
            await dropTableIfShapeChanged(client, "payment_attempts", exports.adminTableDefinitions.payment_attempts.columns);
            await dropLegacyTables(client);
            await dropTableIfShapeChanged(client, "orders", exports.adminTableDefinitions.orders.columns);
            await dropTableIfShapeChanged(client, "audit_logs", exports.adminTableDefinitions.audit_logs.columns);
            await dropTableIfShapeChanged(client, "idempotency_records", exports.adminTableDefinitions.idempotency_records.columns);
            await client.batch([
                {
                    sql: `create table if not exists orders (
              id text primary key,
              idempotency_key text not null,
              order_type text not null,
              item_name text not null,
              region text not null,
              amount integer not null,
              currency text not null,
              note text not null default '',
              status text not null,
              active_payment_attempt_id text null,
              created_at text not null,
              updated_at text not null
            )`
                },
                {
                    sql: `create table if not exists payment_attempts (
              id text primary key,
              order_id text not null,
              provider text not null,
              provider_order_id text not null,
              provider_capture_id text null,
              status text not null,
              checkout_url text not null,
              amount integer not null,
              currency text not null,
              created_at text not null,
              updated_at text not null,
              last_event_id text null
            )`
                },
                {
                    sql: `create table if not exists provider_events (
              id text primary key,
              provider text not null,
              provider_event_id text null,
              event_type text not null,
              source text not null,
              order_id text null,
              attempt_id text null,
              signature_verified integer not null,
              payload text not null,
              received_at text not null
            )`
                },
                {
                    sql: `create table if not exists settlement_records (
              id text primary key,
              attempt_id text not null,
              order_id text not null,
              currency text not null,
              gross_amount integer not null,
              fee_amount integer not null,
              net_amount integer not null,
              status text not null,
              payout_reference text null,
              created_at text not null,
              updated_at text not null,
              paid_out_at text null
            )`
                },
                {
                    sql: `create table if not exists ledger_entries (
              id text primary key,
              order_id text not null,
              attempt_id text not null,
              settlement_id text null,
              type text not null,
              amount integer not null,
              currency text not null,
              direction text not null,
              created_at text not null,
              metadata text not null default '{}'
            )`
                },
                {
                    sql: `create table if not exists audit_logs (
              id text primary key,
              entity_type text not null,
              entity_id text not null,
              action text not null,
              actor text not null,
              message text not null,
              metadata text not null default '{}',
              created_at text not null
            )`
                },
                {
                    sql: `create table if not exists idempotency_records (
              id text primary key,
              scope text not null,
              key text not null,
              resource_type text not null,
              resource_id text not null,
              created_at text not null
            )`
                },
                { sql: "create unique index if not exists idempotency_records_scope_key_idx on idempotency_records (scope, key)" },
                { sql: "create unique index if not exists orders_idempotency_key_idx on orders (idempotency_key)" },
                { sql: "create index if not exists orders_created_at_idx on orders (created_at desc)" },
                { sql: "create index if not exists payment_attempts_order_id_idx on payment_attempts (order_id)" },
                { sql: "create index if not exists payment_attempts_provider_order_id_idx on payment_attempts (provider_order_id)" },
                { sql: "create index if not exists provider_events_attempt_id_idx on provider_events (attempt_id)" },
                { sql: "create index if not exists provider_events_received_at_idx on provider_events (received_at desc)" },
                { sql: "create index if not exists settlement_records_attempt_id_idx on settlement_records (attempt_id)" },
                { sql: "create unique index if not exists settlement_records_attempt_id_unique_idx on settlement_records (attempt_id)" },
                { sql: "create index if not exists ledger_entries_order_id_idx on ledger_entries (order_id)" }
            ], "write");
        })();
    }
    return schemaReady;
}
function snakeToCamel(value) {
    return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
function mapGenericRow(row, columns) {
    return Object.fromEntries(columns.map((column) => [snakeToCamel(column), row[column] === null || row[column] === undefined ? null : row[column]]));
}
function parsePayload(value) {
    if (typeof value !== "string") {
        return value ?? null;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function stringifyPayload(value) {
    if (typeof value === "string") {
        return value;
    }
    return JSON.stringify(value ?? {});
}
function mapOrderRow(row) {
    return {
        id: String(row.id),
        idempotencyKey: String(row.idempotency_key),
        orderType: String(row.order_type),
        itemName: String(row.item_name),
        region: String(row.region),
        amount: Number(row.amount),
        currency: String(row.currency),
        note: String(row.note ?? ""),
        status: String(row.status),
        activePaymentAttemptId: row.active_payment_attempt_id ? String(row.active_payment_attempt_id) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
    };
}
function mapPaymentAttemptRow(row) {
    return {
        id: String(row.id),
        orderId: String(row.order_id),
        provider: String(row.provider),
        providerOrderId: String(row.provider_order_id),
        providerCaptureId: row.provider_capture_id ? String(row.provider_capture_id) : null,
        status: String(row.status),
        checkoutUrl: String(row.checkout_url),
        amount: Number(row.amount),
        currency: String(row.currency),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        lastEventId: row.last_event_id ? String(row.last_event_id) : null
    };
}
function normalizePage(page) {
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}
function normalizePageSize(pageSize) {
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
        return 20;
    }
    return Math.min(Math.floor(pageSize), 100);
}
async function findIdempotencyRecord(scope, key) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: "select id, scope, key, resource_type, resource_id, created_at from idempotency_records where scope = ? and key = ?",
        args: [scope, key]
    });
    const row = result.rows[0];
    return row
        ? {
            id: String(row.id),
            scope: String(row.scope),
            key: String(row.key),
            resourceType: String(row.resource_type),
            resourceId: String(row.resource_id),
            createdAt: String(row.created_at)
        }
        : null;
}
async function insertIdempotencyRecord(input) {
    await ensureSchema();
    const client = getClient();
    await client.execute({
        sql: "insert into idempotency_records (id, scope, key, resource_type, resource_id, created_at) values (?, ?, ?, ?, ?, ?)",
        args: [input.id, input.scope, input.key, input.resourceType, input.resourceId, input.createdAt]
    });
}
async function insertOrder(order) {
    await ensureSchema();
    const client = getClient();
    await client.execute({
        sql: `insert into orders
      (id, idempotency_key, order_type, item_name, region, amount, currency, note, status, active_payment_attempt_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            order.id,
            order.idempotencyKey,
            order.orderType,
            order.itemName,
            order.region,
            order.amount,
            order.currency,
            order.note,
            order.status,
            null,
            order.createdAt,
            order.createdAt
        ]
    });
}
async function getOrderById(orderId) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: `select id, idempotency_key, order_type, item_name, region, amount, currency, note, status,
      active_payment_attempt_id, created_at, updated_at from orders where id = ?`,
        args: [orderId]
    });
    const row = result.rows[0];
    return row ? mapOrderRow(row) : null;
}
async function getOrderByIdempotencyKey(idempotencyKey) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: `select id, idempotency_key, order_type, item_name, region, amount, currency, note, status,
      active_payment_attempt_id, created_at, updated_at from orders where idempotency_key = ?`,
        args: [idempotencyKey]
    });
    const row = result.rows[0];
    return row ? mapOrderRow(row) : null;
}
async function updateOrderStatus(orderId, status, activePaymentAttemptId) {
    await ensureSchema();
    const client = getClient();
    const now = new Date().toISOString();
    if (activePaymentAttemptId !== undefined) {
        await client.execute({
            sql: "update orders set status = ?, active_payment_attempt_id = ?, updated_at = ? where id = ?",
            args: [status, activePaymentAttemptId, now, orderId]
        });
        return;
    }
    await client.execute({
        sql: "update orders set status = ?, updated_at = ? where id = ?",
        args: [status, now, orderId]
    });
}
async function insertPaymentAttempt(attempt) {
    await ensureSchema();
    const client = getClient();
    await client.execute({
        sql: `insert into payment_attempts
      (id, order_id, provider, provider_order_id, provider_capture_id, status, checkout_url, amount, currency, created_at, updated_at, last_event_id)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            attempt.id,
            attempt.orderId,
            attempt.provider,
            attempt.providerOrderId,
            attempt.providerCaptureId ?? null,
            attempt.status,
            attempt.checkoutUrl,
            attempt.amount,
            attempt.currency,
            attempt.createdAt,
            attempt.updatedAt,
            null
        ]
    });
}
async function getPaymentAttemptById(attemptId) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: `select id, order_id, provider, provider_order_id, provider_capture_id, status, checkout_url, amount, currency,
      created_at, updated_at, last_event_id from payment_attempts where id = ?`,
        args: [attemptId]
    });
    const row = result.rows[0];
    return row ? mapPaymentAttemptRow(row) : null;
}
async function getPaymentAttemptByProviderOrderId(providerOrderId) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: `select id, order_id, provider, provider_order_id, provider_capture_id, status, checkout_url, amount, currency,
      created_at, updated_at, last_event_id from payment_attempts where provider_order_id = ?`,
        args: [providerOrderId]
    });
    const row = result.rows[0];
    return row ? mapPaymentAttemptRow(row) : null;
}
async function updatePaymentAttempt(attemptId, patch) {
    await ensureSchema();
    const assignments = [];
    const args = [];
    if (patch.providerCaptureId !== undefined) {
        assignments.push("provider_capture_id = ?");
        args.push(patch.providerCaptureId);
    }
    if (patch.status !== undefined) {
        assignments.push("status = ?");
        args.push(patch.status);
    }
    if (patch.checkoutUrl !== undefined) {
        assignments.push("checkout_url = ?");
        args.push(patch.checkoutUrl);
    }
    if (patch.lastEventId !== undefined) {
        assignments.push("last_event_id = ?");
        args.push(patch.lastEventId);
    }
    assignments.push("updated_at = ?");
    args.push(patch.updatedAt ?? new Date().toISOString());
    const client = getClient();
    await client.execute({
        sql: `update payment_attempts set ${assignments.join(", ")} where id = ?`,
        args: [...args, attemptId]
    });
    return getPaymentAttemptById(attemptId);
}
async function insertProviderEvent(event) {
    await ensureSchema();
    const client = getClient();
    await client.execute({
        sql: `insert into provider_events
      (id, provider, provider_event_id, event_type, source, order_id, attempt_id, signature_verified, payload, received_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            event.id,
            event.provider,
            event.providerEventId ?? null,
            event.eventType,
            event.source,
            event.orderId ?? null,
            event.attemptId ?? null,
            event.signatureVerified ? 1 : 0,
            stringifyPayload(event.payload),
            event.receivedAt
        ]
    });
}
async function insertSettlementRecord(settlement) {
    await ensureSchema();
    const client = getClient();
    await client.execute({
        sql: `insert into settlement_records
      (id, attempt_id, order_id, currency, gross_amount, fee_amount, net_amount, status, payout_reference, created_at, updated_at, paid_out_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            settlement.id,
            settlement.attemptId,
            settlement.orderId,
            settlement.currency,
            settlement.grossAmount,
            settlement.feeAmount,
            settlement.netAmount,
            settlement.status,
            settlement.payoutReference ?? null,
            settlement.createdAt,
            settlement.updatedAt,
            settlement.paidOutAt ?? null
        ]
    });
}
async function getSettlementByAttemptId(attemptId) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: `select id, attempt_id, order_id, currency, gross_amount, fee_amount, net_amount, status, payout_reference,
      created_at, updated_at, paid_out_at from settlement_records where attempt_id = ?`,
        args: [attemptId]
    });
    const row = result.rows[0];
    return row
        ? {
            id: String(row.id),
            attemptId: String(row.attempt_id),
            orderId: String(row.order_id),
            currency: String(row.currency),
            grossAmount: Number(row.gross_amount),
            feeAmount: Number(row.fee_amount),
            netAmount: Number(row.net_amount),
            status: String(row.status),
            payoutReference: row.payout_reference ? String(row.payout_reference) : null,
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
            paidOutAt: row.paid_out_at ? String(row.paid_out_at) : null
        }
        : null;
}
async function insertLedgerEntry(entry) {
    await ensureSchema();
    const client = getClient();
    await client.execute({
        sql: `insert into ledger_entries
      (id, order_id, attempt_id, settlement_id, type, amount, currency, direction, created_at, metadata)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            entry.id,
            entry.orderId,
            entry.attemptId,
            entry.settlementId ?? null,
            entry.type,
            entry.amount,
            entry.currency,
            entry.direction,
            entry.createdAt,
            stringifyPayload(entry.metadata)
        ]
    });
}
async function insertAuditLog(log) {
    await ensureSchema();
    const client = getClient();
    await client.execute({
        sql: "insert into audit_logs (id, entity_type, entity_id, action, actor, message, metadata, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [log.id, log.entityType, log.entityId, log.action, log.actor, log.message, stringifyPayload(log.metadata), log.createdAt]
    });
}
async function countOrders() {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute("select count(*) as count from orders");
    return Number(result.rows[0]?.count ?? 0);
}
async function countPaymentAttempts() {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute("select count(*) as count from payment_attempts");
    return Number(result.rows[0]?.count ?? 0);
}
async function listRecentOrders(limit = 50) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: `select id, idempotency_key, order_type, item_name, region, amount, currency, note, status,
      active_payment_attempt_id, created_at, updated_at from orders order by created_at desc limit ?`,
        args: [limit]
    });
    return result.rows.map((row) => mapOrderRow(row));
}
async function listRecentPaymentAttempts(limit = 50) {
    await ensureSchema();
    const client = getClient();
    const result = await client.execute({
        sql: `select id, order_id, provider, provider_order_id, provider_capture_id, status, checkout_url, amount, currency,
      created_at, updated_at, last_event_id from payment_attempts order by created_at desc limit ?`,
        args: [limit]
    });
    return result.rows.map((row) => mapPaymentAttemptRow(row));
}
async function listAdminTables() {
    await ensureSchema();
    return Object.values(exports.adminTableDefinitions).map((definition) => ({
        name: definition.name,
        columns: definition.columns,
        editableColumns: definition.editableColumns
    }));
}
async function listAdminTableRows(tableName, pageInput, pageSizeInput) {
    await ensureSchema();
    const definition = exports.adminTableDefinitions[tableName];
    if (!definition) {
        return null;
    }
    const page = normalizePage(pageInput);
    const pageSize = normalizePageSize(pageSizeInput);
    const offset = (page - 1) * pageSize;
    const client = getClient();
    const countResult = await client.execute(`select count(*) as count from ${definition.name}`);
    const total = Number(countResult.rows[0]?.count ?? 0);
    const rowsResult = await client.execute({
        sql: `select ${definition.columns.join(", ")} from ${definition.name} order by ${definition.orderBy} desc limit ? offset ?`,
        args: [pageSize, offset]
    });
    return {
        table: definition.name,
        columns: definition.columns,
        editableColumns: definition.editableColumns,
        page,
        pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
        rows: rowsResult.rows.map((row) => {
            const mapped = mapGenericRow(row, definition.columns);
            if ("payload" in mapped) {
                mapped.payload = parsePayload(mapped.payload);
            }
            if ("metadata" in mapped) {
                mapped.metadata = parsePayload(mapped.metadata);
            }
            return mapped;
        })
    };
}
async function updateAdminTableRow(tableName, rowId, values) {
    await ensureSchema();
    const definition = exports.adminTableDefinitions[tableName];
    if (!definition) {
        return null;
    }
    const assignments = [];
    const args = [];
    for (const column of definition.editableColumns) {
        const camelKey = snakeToCamel(column);
        if (!(camelKey in values)) {
            continue;
        }
        const rawValue = values[camelKey];
        assignments.push(`${column} = ?`);
        if (rawValue === null || rawValue === undefined || rawValue === "") {
            args.push(null);
        }
        else if (typeof rawValue === "number") {
            args.push(rawValue);
        }
        else if ((column === "payload" || column === "metadata") && typeof rawValue === "object") {
            args.push(JSON.stringify(rawValue));
        }
        else {
            args.push(String(rawValue));
        }
    }
    if (assignments.length === 0) {
        return null;
    }
    const client = getClient();
    await client.execute({
        sql: `update ${definition.name} set ${assignments.join(", ")} where id = ?`,
        args: [...args, rowId]
    });
    const updated = await client.execute({
        sql: `select ${definition.columns.join(", ")} from ${definition.name} where id = ?`,
        args: [rowId]
    });
    const row = updated.rows[0];
    return row ? mapGenericRow(row, definition.columns) : null;
}
//# sourceMappingURL=store.js.map