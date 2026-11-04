import type { Answer, Citation } from "./ask.ts";

export const ASK_HISTORY_KEY = "yanzhi.ask-history.v1";
export const ASK_HISTORY_LIMIT = 50;
export type AskHistoryEntry = {
  id: string;
  createdAt: number;
  question: string;
  articleId?: string;
  state: "pending" | "complete" | "error";
  answer?: Answer;
  error?: string;
};
export type AskHistory = { entries: AskHistoryEntry[]; activeId: string | null; draft: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

export function emptyAskHistory(): AskHistory {
  return { entries: [], activeId: null, draft: "" };
}

export function historyAnswer(value: unknown): Answer | null {
  if (!isObject(value) || !["answered", "insufficient_evidence"].includes(String(value.status)) ||
    !text(value.answer, 14000) || !value.answer.trim() || !Array.isArray(value.citations) || value.citations.length > 30) return null;
  if (value.basis !== undefined && !["knowledge", "project", "general", "reference"].includes(String(value.basis))) return null;
  const citations: Citation[] = [];
  for (const citation of value.citations) {
    if (!isObject(citation) || !/^S\d+$/.test(String(citation.id)) || !validId(citation.article_id) ||
      !text(citation.title, 500) || !text(citation.anchor, 200) || !text(citation.excerpt, 3000)) return null;
    let href: string | undefined;
    if (typeof citation.href === "string" && /^\/(knowledge|benchmarks|experiments|replays|paths)\//.test(citation.href) &&
      citation.href.length <= 1000 && !/[\\\u0000-\u0020]/.test(citation.href)) href = citation.href;
    citations.push({ id: String(citation.id), article_id: citation.article_id, title: citation.title,
      anchor: citation.anchor, excerpt: citation.excerpt, ...(href ? { href } : {}) });
  }
  return { status: value.status as Answer["status"], answer: value.answer, citations,
    ...(typeof value.basis === "string" ? { basis: value.basis as Answer["basis"] } : {}),
    ...(typeof value.cached === "boolean" ? { cached: value.cached } : {}) };
}

export function answerLabel(answer: Answer): string {
  if (answer.basis === "reference") return "参考回答";
  if (answer.basis === "project" || answer.basis === "general") return "研知台助手";
  return answer.status === "answered" ? "根据知识库回答" : "资料不足";
}

function historyEntry(value: unknown): AskHistoryEntry | null {
  if (!isObject(value) || !validId(value.id) || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) ||
    value.createdAt <= 0 || value.createdAt > 8.64e15 || !text(value.question, 2000) || !value.question.trim()) return null;
  const base = { id: value.id, createdAt: value.createdAt, question: value.question,
    ...(validId(value.articleId) ? { articleId: value.articleId } : {}) };
  if (value.state === "pending") return { ...base, state: "pending" };
  if (value.state === "error" && text(value.error, 1000) && value.error.trim()) return { ...base, state: "error", error: value.error };
  if (value.state === "complete") {
    const answer = historyAnswer(value.answer);
    if (answer) return { ...base, state: "complete", answer };
  }
  return null;
}

export function parseAskHistory(raw: string | null): AskHistory {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!isObject(value)) return emptyAskHistory();
    const unique = new Map<string, AskHistoryEntry>();
    for (const entry of Array.isArray(value.entries) ? value.entries : []) {
      const record = historyEntry(entry);
      if (record && !unique.has(record.id)) unique.set(record.id, record);
    }
    const entries = [...unique.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, ASK_HISTORY_LIMIT);
    return { entries, activeId: typeof value.activeId === "string" && entries.some(entry => entry.id === value.activeId) ? value.activeId : null,
      draft: text(value.draft, 2000) ? value.draft : "" };
  } catch { return emptyAskHistory(); }
}

export function beginHistoryQuestion(history: AskHistory, input: { id: string; createdAt: number; question: string; articleId?: string }): AskHistory {
  const entry = historyEntry({ ...input, question: input.question.trim(), state: "pending" });
  if (!entry) return history;
  return { entries: [entry, ...history.entries.filter(previous => previous.id !== entry.id)].slice(0, ASK_HISTORY_LIMIT),
    activeId: entry.id, draft: "" };
}

export function finishHistoryQuestion(history: AskHistory, id: string, result: { answer: Answer } | { error: string }): AskHistory {
  return { ...history, entries: history.entries.map(entry => {
    if (entry.id !== id) return entry;
    const updated = historyEntry({ ...entry, ...result, state: "answer" in result ? "complete" : "error" });
    return updated || entry;
  }) };
}
