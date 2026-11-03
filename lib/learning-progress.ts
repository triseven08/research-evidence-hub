export const LEARNING_PROGRESS_KEY = "yanzhi.learning-progress.v1";
export type LearningProgress = Record<string, string[]>;

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);

export function parseLearningProgress(raw: string | null): LearningProgress {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, lessons]) =>
      validId(id) && Array.isArray(lessons),
    ).map(([id, lessons]) => [id, [...new Set((lessons as unknown[]).filter(validId))]]));
  } catch {
    return {};
  }
}

// Read all existing per-path records as shared article completions without discarding older progress.
export function completedArticles(progress: LearningProgress): string[] {
  return [...new Set(Object.values(progress).flat())];
}

export function pathProgress(lessonIds: string[], completed: string[] = []) {
  const done = new Set(completed);
  const count = lessonIds.filter(id => done.has(id)).length;
  return {
    count,
    total: lessonIds.length,
    nextId: lessonIds.find(id => !done.has(id)),
    percent: lessonIds.length ? Math.round(count / lessonIds.length * 100) : 0,
  };
}

export function completeCheckpoint(progress: LearningProgress, pathId: string, lessonId: string): LearningProgress {
  if (!validId(pathId) || !validId(lessonId)) return progress;
  return { ...progress, [pathId]: [...new Set([...(progress[pathId] || []), lessonId])] };
}
