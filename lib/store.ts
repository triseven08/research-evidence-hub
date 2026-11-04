import { ServiceError } from "./quota.ts";

export interface Statement { bind(...values: unknown[]): Statement; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown>; }
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown>; }

// 进程内 JSON 状态：数据结构与 db/guards.sql + drizzle schema 一一对应。
// 目标运行时不提供可持久化磁盘，因此状态保存在进程内存，重启后清零；
// 额度、缓存与幂等语义保持一致，不依赖任何外部数据库。
type Row = {
  id: string; visitor: string; ip: string; day: string; created_at: number; state: string; signature: string;
  reserved_micro: number; actual_micro: number | null; answer_json: string | null; error_code: string | null;
  model: string | null; input_tokens: number | null; output_tokens: number | null;
  user_day: number; user_minute: number; ip_day: number; ip_minute: number; site_day: number;
  user_concurrency: number; site_concurrency: number; budget_micro: number;
};

type CacheRow = { value: string; expires_at: number };

const requests = new Map<string, Row>();
const cache = new Map<string, CacheRow>();

const active = (row: Row) => row.state !== "refunded";
const countWhere = (predicate: (row: Row) => boolean) => [...requests.values()].filter(active).filter(predicate).length;

function insertRequest(row: Row) {
  if (requests.has(row.id)) throw new Error("UNIQUE constraint failed: requests.id");
  if (countWhere((r) => r.visitor === row.visitor && r.day === row.day) >= row.user_day) throw new Error("USER_QUOTA_EXCEEDED");
  if (countWhere((r) => r.visitor === row.visitor && r.created_at > row.created_at - 60000) >= row.user_minute) throw new Error("RATE_LIMITED");
  if (countWhere((r) => r.ip === row.ip && r.day === row.day) >= row.ip_day) throw new Error("IP_QUOTA_EXCEEDED");
  if (countWhere((r) => r.ip === row.ip && r.created_at > row.created_at - 60000) >= row.ip_minute) throw new Error("RATE_LIMITED");
  if (countWhere((r) => r.day === row.day) >= row.site_day) throw new Error("SITE_QUOTA_EXCEEDED");
  if (countWhere((r) => r.visitor === row.visitor && r.state === "reserved" && r.created_at > row.created_at - 90000) >= row.user_concurrency) throw new Error("CONCURRENCY_LIMITED");
  if (countWhere((r) => r.state === "reserved" && r.created_at > row.created_at - 90000) >= row.site_concurrency) throw new Error("CONCURRENCY_LIMITED");
  const used = [...requests.values()].filter((r) => r.day === row.day && active(r)).reduce((sum, r) => sum + (r.state === "settled" ? r.actual_micro || 0 : r.reserved_micro), 0);
  if (used + row.reserved_micro > row.budget_micro) throw new Error("SITE_BUDGET_EXCEEDED");
  requests.set(row.id, row);
}

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

async function execute(sql: string, values: unknown[]): Promise<unknown> {
  const q = norm(sql);

  if (q.startsWith("SELECT count(*) AS used FROM requests")) {
    const [visitor, day] = values as [string, string];
    return { used: countWhere((r) => r.visitor === visitor && r.day === day) };
  }
  if (q.startsWith("SELECT state,signature,answer_json FROM requests")) {
    const row = requests.get(String(values[0]));
    return row ? { state: row.state, signature: row.signature, answer_json: row.answer_json } : null;
  }
  if (q.startsWith("SELECT value FROM answer_cache")) {
    const [key, now] = values as [string, number];
    const hit = cache.get(key);
    return hit && hit.expires_at > now ? { value: hit.value } : null;
  }
  if (q.startsWith("UPDATE requests SET state='unknown' WHERE state='reserved'")) {
    const cutoff = Number(values[0]);
    for (const row of requests.values()) if (row.state === "reserved" && row.created_at <= cutoff) row.state = "unknown";
    return { changes: 1 };
  }
  if (q.startsWith("UPDATE requests SET state='unknown',error_code=?")) {
    const [errorCode, id] = values as [string, string];
    const row = requests.get(id);
    if (row && row.state === "reserved") { row.state = "unknown"; row.error_code = errorCode; }
    return { changes: row ? 1 : 0 };
  }
  if (q.startsWith("UPDATE requests SET state='settled'")) {
    const [actual, answerJson, errorCode, model, input, output, id] = values as [number, string | null, string | null, string | null, number | null, number | null, string];
    const row = requests.get(id);
    if (row && row.state === "reserved") {
      row.state = "settled"; row.actual_micro = actual; row.answer_json = answerJson;
      row.error_code = errorCode; row.model = model; row.input_tokens = input; row.output_tokens = output;
    }
    return { changes: row ? 1 : 0 };
  }
  if (q.startsWith("INSERT INTO requests")) {
    const v = values as unknown[];
    insertRequest({
      id: String(v[0]), visitor: String(v[1]), ip: String(v[2]), day: String(v[3]), created_at: Number(v[4]),
      state: String(v[5]), signature: String(v[6]), reserved_micro: Number(v[7]), actual_micro: null,
      answer_json: null, error_code: null, model: null, input_tokens: null, output_tokens: null,
      user_day: Number(v[8]), user_minute: Number(v[9]), ip_day: Number(v[10]), ip_minute: Number(v[11]),
      site_day: Number(v[12]), user_concurrency: Number(v[13]), site_concurrency: Number(v[14]), budget_micro: Number(v[15]),
    });
    return { changes: 1 };
  }
  if (q.startsWith("INSERT INTO answer_cache")) {
    const [key, value, expiresAt] = values as [string, string, number];
    cache.set(key, { value, expires_at: expiresAt });
    return { changes: 1 };
  }
  throw new ServiceError("QUOTA_STORAGE_UNAVAILABLE", 503);
}

function statement(sql: string): Statement {
  let bound: unknown[] = [];
  const stmt: Statement = {
    bind(...values: unknown[]) { bound = values; return stmt; },
    async first<T = Record<string, unknown>>() { return (await execute(sql, bound)) as T | null; },
    async run() { return execute(sql, bound); },
  };
  return stmt;
}

export const store: Database = {
  prepare: statement,
  async batch(statements: Statement[]) {
    const results: unknown[] = [];
    for (const item of statements) results.push(await item.run());
    return results;
  },
};