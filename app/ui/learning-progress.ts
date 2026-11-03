"use client";

import { useMemo, useSyncExternalStore } from "react";
import { completedArticles, completeCheckpoint, LEARNING_PROGRESS_KEY, parseLearningProgress } from "../../lib/learning-progress";

const changeEvent = "yanzhi:learning-progress";
let temporaryProgress = "{}";
let temporaryOnly = false;

function snapshot() {
  if (temporaryOnly) return temporaryProgress;
  try { return window.localStorage.getItem(LEARNING_PROGRESS_KEY) || "{}"; }
  catch { return temporaryProgress; }
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LEARNING_PROGRESS_KEY || event.key === null) notify();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, notify);
  };
}

const serverSnapshot = () => "{}";

export function useLearningProgress() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const completed = useMemo(() => completedArticles(parseLearningProgress(raw)), [raw]);

  function complete(pathId: string, lessonId: string) {
    temporaryProgress = JSON.stringify(completeCheckpoint(parseLearningProgress(snapshot()), pathId, lessonId));
    let saved = true;
    try { window.localStorage.setItem(LEARNING_PROGRESS_KEY, temporaryProgress); }
    catch { saved = false; temporaryOnly = true; }
    window.dispatchEvent(new Event(changeEvent));
    return saved;
  }

  return { completed, complete };
}
