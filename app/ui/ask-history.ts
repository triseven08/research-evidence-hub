"use client";

import { useSyncExternalStore } from "react";
import type { Answer } from "../../lib/ask";
import { ASK_HISTORY_KEY, beginHistoryQuestion, emptyAskHistory, finishHistoryQuestion, parseAskHistory, type AskHistory } from "../../lib/ask-history";

const changed = "yanzhi:ask-history";
const pending = new Set<string>();
let temporaryRaw = "{}";
let saveFailed = false;
const serverState = { history: emptyAskHistory(), saveFailed: false, pendingIds: [] as string[] };
let cachedRaw = "";
let cachedState = serverState;

function readRaw() {
  if (saveFailed) return temporaryRaw;
  try { return window.localStorage.getItem(ASK_HISTORY_KEY) || "{}"; }
  catch { return temporaryRaw; }
}

function snapshot() {
  const raw = readRaw();
  if (cachedRaw !== raw || cachedState.saveFailed !== saveFailed || cachedState.pendingIds.length !== pending.size) {
    cachedRaw = raw;
    cachedState = { history: parseAskHistory(raw), saveFailed, pendingIds: [...pending] };
  }
  return cachedState;
}

function update(change: (history: AskHistory) => AskHistory) {
  temporaryRaw = JSON.stringify(change(parseAskHistory(readRaw())));
  try { window.localStorage.setItem(ASK_HISTORY_KEY, temporaryRaw); saveFailed = false; }
  catch { saveFailed = true; }
  window.dispatchEvent(new Event(changed));
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ASK_HISTORY_KEY || event.key === null) notify();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changed, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(changed, notify); };
}

function startQuestion(question: string, articleId?: string) {
  const id = crypto.randomUUID();
  pending.add(id);
  update(history => beginHistoryQuestion(history, { id, createdAt: Date.now(), question, articleId }));
  return id;
}

function finishQuestion(id: string, result: { answer: Answer } | { error: string }) {
  pending.delete(id);
  update(history => finishHistoryQuestion(history, id, result));
}

const serverSnapshot = () => serverState;

export function useAskHistory() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return { ...state, startQuestion, finishQuestion,
    selectQuestion: (id: string) => update(history => ({ ...history, activeId: history.entries.some(entry => entry.id === id) ? id : null })),
    newQuestion: () => update(history => ({ ...history, activeId: null, draft: "" })),
    setDraft: (draft: string) => update(history => ({ ...history, draft: draft.slice(0, 2000) })),
  };
}
