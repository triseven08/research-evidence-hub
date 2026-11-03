import { test } from "node:test";
import assert from "node:assert/strict";
import { articleById, paths } from "../lib/content.ts";
import { checkpoints, learningPathForArticle } from "../lib/learning-paths.ts";
import { completedArticles, completeCheckpoint, parseLearningProgress, pathProgress } from "../lib/learning-progress.ts";

test("learning progress tolerates missing, malformed, and obsolete browser data", () => {
  for (const raw of [null, "broken", "[]", "null", "42"]) assert.deepEqual(parseLearningProgress(raw), {});
  const progress = parseLearningProgress('{"first-agent":["planning","planning",42,null,"removed-lesson"],"bad":"value","__proto__":["planning"]}');
  assert.deepEqual(progress, { "first-agent": ["planning", "removed-lesson"] });
  assert.equal(pathProgress(["planning", "tool-calling"], progress["first-agent"]).count, 1);
});

test("existing progress in path 01 immediately completes matching stages in path 02", () => {
  const stored = '{"first-agent":["tool-discovery","planning"]}';
  const completed = completedArticles(parseLearningProgress(stored));
  const second = paths.find(path => path.id === "reliable-agent")!;
  assert.deepEqual(pathProgress(second.ids, completed), {
    count: 2, total: 4, nextId: "context-and-skills", percent: 50,
  });
  assert.deepEqual(completedArticles(parseLearningProgress(null)), []);
});

test("new completions are shared across all matching paths and survive serialization", () => {
  let progress = completeCheckpoint({}, "first-agent", "tool-discovery");
  progress = completeCheckpoint(progress, "first-agent", "planning");
  progress = completeCheckpoint(progress, "reliable-agent", "context-and-skills");
  progress = completeCheckpoint(progress, "research-frontiers", "reading-benchmarks");
  const completed = completedArticles(parseLearningProgress(JSON.stringify(progress)));
  assert.deepEqual(paths.map(path => pathProgress(path.ids, completed).count), [2, 4, 2]);
  assert.equal(pathProgress(paths[1].ids, completed).nextId, undefined);
  assert.equal(pathProgress(paths[2].ids, completed).nextId, "frontiers");
  assert.ok(!completed.includes("what-is-agent"));
});

test("repeating the same article within or across paths does not double-count progress", () => {
  let progress = completeCheckpoint({}, "first-agent", "planning");
  progress = completeCheckpoint(progress, "first-agent", "planning");
  progress = completeCheckpoint(progress, "reliable-agent", "planning");
  const completed = completedArticles(progress);
  assert.deepEqual(completed, ["planning"]);
  assert.equal(pathProgress(paths[0].ids, completed).count, 1);
  assert.equal(pathProgress(paths[1].ids, completed).count, 1);
  assert.equal(pathProgress(paths[2].ids, completed).count, 0);
});

test("map recommends the first unfinished stage, including when later articles were passed first", () => {
  const ids = ["what-is-agent", "tool-calling", "planning"];
  assert.deepEqual(pathProgress(ids, ["planning"]), { count: 1, total: 3, nextId: "what-is-agent", percent: 33 });
  assert.equal(pathProgress(ids, ids).nextId, undefined);
  assert.equal(pathProgress(ids, ids).percent, 100);
  assert.equal(pathProgress([]).percent, 0);
});

test("article navigation preserves the requested learning path instead of the first path", () => {
  const path = learningPathForArticle("reliable-agent", "planning")!;
  assert.equal(path.id, "reliable-agent");
  assert.equal(path.ids[path.ids.indexOf("planning") + 1], "context-and-skills");
  assert.equal(learningPathForArticle(undefined, "planning"), undefined);
  assert.equal(learningPathForArticle("first-agent", "context-and-skills"), undefined);
  assert.equal(learningPathForArticle("not-a-path", "planning"), undefined);
});

test("every stage has a complete checkpoint grounded in a real article section", () => {
  for (const path of paths) for (const id of path.ids) {
    const checkpoint = checkpoints[id];
    assert.ok(checkpoint, `${path.id}/${id} needs a checkpoint`);
    assert.ok(checkpoint.choices.length >= 2);
    assert.ok(checkpoint.answer >= 0 && checkpoint.answer < checkpoint.choices.length);
    assert.ok(checkpoint.explanation);
    assert.ok(articleById(id)?.sections.some(section => section.id === checkpoint.section), id);
  }
});
