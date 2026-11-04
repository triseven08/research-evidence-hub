import { test } from "node:test";
import assert from "node:assert/strict";
import type { Answer } from "../lib/ask.ts";
import { ASK_HISTORY_LIMIT, beginHistoryQuestion, emptyAskHistory, finishHistoryQuestion, historyAnswer, parseAskHistory, answerLabel } from "../lib/ask-history.ts";

const answer: Answer = { status: "answered", answer: "一个 MCP Server 可以提供多个工具。[S1]", citations: [
  { id: "S1", article_id: "mcp-architecture", title: "MCP 连接了什么", anchor: "roles", excerpt: "一个 Server 可以暴露多个工具。", href: "/knowledge/mcp-architecture#roles" },
] };
const begin = (id = "question-1", createdAt = 1000) => ({ id, createdAt, question: "MCP Server 和工具有什么区别？", articleId: "mcp-architecture" });

test("answer basis survives storage and labels distinguish reference, project, general and legacy answers", () => {
  for (const [basis, label] of [["knowledge", "根据知识库回答"], ["project", "研知台助手"], ["general", "研知台助手"], ["reference", "参考回答"]] as const) {
    const result = { ...answer, basis };
    const restored = parseAskHistory(JSON.stringify(finishHistoryQuestion(beginHistoryQuestion(emptyAskHistory(), begin()), "question-1", { answer: result })));
    assert.equal(restored.entries[0].answer?.basis, basis);
    assert.equal(answerLabel(restored.entries[0].answer!), label);
  }
  assert.equal(answerLabel(answer), "根据知识库回答");
  assert.equal(answerLabel({ status: "insufficient_evidence", answer: "旧版资料不足", citations: [] }), "资料不足");
  assert.equal(historyAnswer({ ...answer, basis: "unknown" }), null);
});

test("questions, answers, citations, selected record and drafts survive closing and reloading", () => {
  const started = beginHistoryQuestion({ ...emptyAskHistory(), draft: "MCP Server 和工具有什么区别？" }, begin());
  assert.equal(started.draft, "");
  const completed = finishHistoryQuestion(started, "question-1", { answer });
  const restored = parseAskHistory(JSON.stringify({ ...completed, draft: "还想了解 tools/list" }));
  assert.equal(restored.activeId, "question-1");
  assert.equal(restored.draft, "还想了解 tools/list");
  assert.equal(restored.entries[0].articleId, "mcp-architecture");
  assert.deepEqual(restored.entries[0].answer, answer);
});

test("finishing a closed or older question preserves the newly selected record and unsent draft", () => {
  let history = beginHistoryQuestion(emptyAskHistory(), begin("question-1", 1000));
  history = beginHistoryQuestion(history, begin("question-2", 2000));
  history = { ...history, draft: "下一道问题" };
  history = finishHistoryQuestion(history, "question-1", { answer });
  assert.equal(history.activeId, "question-2");
  assert.equal(history.draft, "下一道问题");
  assert.deepEqual(history.entries.find(entry => entry.id === "question-1")?.answer, answer);
  assert.equal(history.entries[0].state, "pending");
});

test("failed and interrupted requests remain in history without fabricating an answer", () => {
  const started = beginHistoryQuestion(emptyAskHistory(), begin());
  const interrupted = parseAskHistory(JSON.stringify(started));
  assert.equal(interrupted.entries[0].state, "pending");
  assert.equal(interrupted.entries[0].answer, undefined);
  const failed = parseAskHistory(JSON.stringify(finishHistoryQuestion(started, "question-1", { error: "回答超时，请重试。" })));
  assert.equal(failed.entries[0].state, "error");
  assert.equal(failed.entries[0].error, "回答超时，请重试。");
  assert.equal(failed.entries[0].answer, undefined);
});

test("history retains the newest 50 questions and handles missing or corrupted storage", () => {
  for (const raw of [null, "broken", "[]", "null", "42"]) assert.deepEqual(parseAskHistory(raw), emptyAskHistory());
  let history = emptyAskHistory();
  for (let index = 1; index <= ASK_HISTORY_LIMIT + 3; index++) history = beginHistoryQuestion(history, begin(`question-${index}`, index));
  assert.equal(history.entries.length, ASK_HISTORY_LIMIT);
  assert.equal(history.entries[0].id, "question-53");
  assert.equal(history.entries.at(-1)?.id, "question-4");
  const restored = parseAskHistory(JSON.stringify({ ...history, entries: [...history.entries, history.entries[0], { ...begin("bad-date"), createdAt: 9e15, state: "pending" }] }));
  assert.equal(restored.entries.length, ASK_HISTORY_LIMIT);
  assert.equal(restored.activeId, "question-53");
});

test("history stores answer content rather than quota snapshots or raw response fields", () => {
  const result = historyAnswer({ ...answer, cached: true, quota: { remaining: 99 }, request_id: "server-request", extra: "unused" });
  assert.deepEqual(result, { ...answer, cached: true });
  assert.equal(historyAnswer({ status: "answered", answer: "", citations: [] }), null);
  assert.equal(historyAnswer({ status: "other", answer: "回答", citations: [] }), null);
  assert.equal(historyAnswer({ status: "insufficient_evidence", answer: "暂无资料。", citations: [] })?.status, "insufficient_evidence");
});

test("malformed entries are skipped and stored citations cannot introduce script or external links", () => {
  const result = historyAnswer({ ...answer, citations: [{ ...answer.citations[0], href: "javascript:alert(1)" }] })!;
  assert.equal(result.citations[0].href, undefined);
  for (const href of ["https://other.example/knowledge/test", "//other.example/knowledge/test", "/knowledge/\\other.example"]) {
    assert.equal(historyAnswer({ ...answer, citations: [{ ...answer.citations[0], href }] })?.citations[0].href, undefined);
  }
  const valid = finishHistoryQuestion(beginHistoryQuestion(emptyAskHistory(), begin()), "question-1", { answer });
  const restored = parseAskHistory(JSON.stringify({ ...valid, entries: [{ state: "complete", answer }, ...valid.entries], activeId: "unknown" }));
  assert.equal(restored.entries.length, 1);
  assert.equal(restored.activeId, null);
});
