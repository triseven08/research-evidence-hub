"use client";

import { useState, useEffect, useRef } from "react";
import { Modal } from "./shell";
import { Icon } from "./icons";
import { articleById, articleHref } from "../../lib/content";
import { historyAnswer } from "../../lib/ask-history";
import { useAskHistory } from "./ask-history";
import "./ask-history.css";

type Quota = { remaining: number; limit: number; reset_at: string };

export function AskPanel({ articleId, onClose }: { articleId?: string; onClose: () => void }) {
  const { history, saveFailed, pendingIds, startQuestion, finishQuestion, selectQuestion, newQuestion, setDraft } = useAskHistory();
  const [showHistory, setShowHistory] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const selected = history.entries.find(entry => entry.id === history.activeId);
  const contextId = selected ? selected.articleId : articleId;
  const current = articleById(contextId || "");
  const answer = selected?.answer;
  const busy = pendingIds.length > 0;
  const waiting = selected?.state === "pending" && pendingIds.includes(selected.id);
  const error = selected?.state === "error" ? selected.error :
    selected?.state === "pending" && !waiting ? "这次提问未取得回答，请重新提问。" : undefined;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/usage", { signal: controller.signal }).then(r => r.json() as Promise<{ quota?: Quota }>).
      then(data => { if (data.quota) setQuota(data.quota); }).catch(() => {});
    return () => controller.abort();
  }, [pendingIds.length]);

  async function submit() {
    const question = history.draft.trim();
    if (!question || busy) return;
    const id = startQuestion(question, contextId);
    setShowHistory(false);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, article_id: contextId, request_id: id }) });
      const data = await response.json() as { quota?: Quota; error?: { message?: string } };
      if (data.quota) setQuota(data.quota);
      if (!response.ok) throw new Error(data.error?.message || "暂时无法回答，请稍后重试。");
      const result = historyAnswer(data);
      if (!result) throw new Error("回答格式异常，请重试。");
      // Persist even if the drawer was closed while awaiting the response.
      finishQuestion(id, { answer: result });
    } catch (error) {
      finishQuestion(id, { error: (error instanceof Error ? error.message : "网络连接中断，请稍后重试。").slice(0, 1000) });
    }
  }

  function startNew() {
    newQuestion();
    setShowHistory(false);
    input.current?.focus();
  }

  return <Modal drawer onClose={onClose} label="向知识库提问">
    <div className="panel-header"><div><Icon name="ask" /><strong>向知识库提问</strong></div>
      <button className="icon-button" aria-label="关闭答疑" onClick={onClose}><Icon name="x" /></button>
    </div>
    <div className="ask-history-toolbar">
      <button type="button" onClick={startNew}><Icon name="ask" size={15} />新提问</button>
      <button type="button" aria-expanded={showHistory} aria-controls="ask-history-list" onClick={() => setShowHistory(value => !value)}><Icon name="clock" size={15} />历史记录</button>
    </div>
    {saveFailed && <p className="ask-save-error" role="alert">历史记录未能保存到浏览器。</p>}
    <div className="panel-body">
      {showHistory ? <div id="ask-history-list">
        {!history.entries.length ? <p className="ask-history-empty">暂无提问记录</p> :
          <ol className="ask-history-list" aria-label="提问历史">{history.entries.map(entry => <li key={entry.id}>
            <button type="button" aria-current={entry.id === history.activeId ? "true" : undefined}
              onClick={() => { selectQuestion(entry.id); setShowHistory(false); }}>
              <strong>{entry.question}</strong>
              <span><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                {entry.state === "error" ? <span>未成功</span> : entry.state === "pending" ? <span>{pendingIds.includes(entry.id) ? "正在回答" : "未完成"}</span> : null}
              </span>
            </button>
          </li>)}</ol>}
      </div> : <>
        {current && <a href={articleHref(current)} className="context-reference" onClick={onClose}><Icon name="file" size={15} />{current.title}</a>}
        {!selected && <div className="ask-start"><div className="ask-mark"><Icon name="sparkles" size={25} /></div><h2>想弄明白哪一步？</h2>
          <div className="suggestion-list">{(current ? [`解释一下「${current.title}」的核心概念`, "这篇内容有什么实际例子？"] :
            ["Agent 与普通聊天有什么区别？", "MCP Server 和工具有什么区别？", "为什么多步调用更容易失败？"]).map(question =>
              <button key={question} onClick={() => { setDraft(question); input.current?.focus(); }}>{question}<Icon name="arrow-up-right" size={14} /></button>)}</div>
        </div>}
        {selected && <div className="question-bubble">{selected.question}</div>}
        {waiting && <div className="answer-loading" role="status"><span className="loading-dot" />正在查资料…</div>}
        {error && <div className="answer-error" role="alert"><Icon name="warning" size={18} /><p>{error}</p></div>}
        {answer && <div className="answer-content" aria-live="polite">
          <div className="answer-byline"><Icon name={answer.status === "answered" ? "book" : "search"} size={16} />
            <span>{answer.status === "answered" ? "根据知识库回答" : "资料不足"}</span>{answer.cached && <span className="muted">来自缓存</span>}</div>
          <div className="answer-text">{answer.answer.split(/(\[S\d+\])/g).map((part, index) => {
            const citation = answer.citations.find(citation => `[${citation.id}]` === part);
            return citation ? <a key={index} href={citation.href || `/knowledge/${citation.article_id}#${encodeURIComponent(citation.anchor)}`} className="inline-citation" onClick={onClose}>{part}</a> : <span key={index}>{part}</span>;
          })}</div>
          {answer.citations.length > 0 && <div className="answer-sources">{answer.citations.map(citation => <details key={citation.id}>
            <summary><span>{citation.id.slice(1)}</span><a href={citation.href || `/knowledge/${citation.article_id}#${encodeURIComponent(citation.anchor)}`} onClick={onClose}>{citation.title}</a><Icon name="down" size={14} /></summary>
            <p>{citation.excerpt}</p>
          </details>)}</div>}
        </div>}
      </>}
    </div>
    <form className="ask-compose" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="sr-only" htmlFor="question">输入问题</label>
      <textarea id="question" ref={input} value={history.draft} maxLength={2000} placeholder="输入你的问题…" onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="compose-bottom"><span>{quota ? (quota.remaining === 0 ? "北京时间 00:00 恢复提问额度" : `今日剩余 ${quota.remaining} / ${quota.limit} 次`) : "回答会附带来源"}</span>
        <button className="send-button" type="submit" disabled={busy || !history.draft.trim()} aria-label="发送问题"><Icon name="send" size={16} /></button>
      </div>
    </form>
  </Modal>;
}
