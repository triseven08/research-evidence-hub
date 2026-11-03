import { test } from "node:test";
import assert from "node:assert/strict";
import { articleById, paths } from "../lib/content.ts";
import { checkpoints, learningPathForArticle } from "../lib/learning-paths.ts";
import { completeCheckpoint, parseLearningProgress, pathProgress } from "../lib/learning-progress.ts";

test("learning progress tolerates missing, malformed, and obsolete browser data", () => {
  for (const raw of [null, "broken", "[]", "null", "42"]) assert.deepEqual(parseLearningProgress(raw), {});
  const progress = parseLearningProgress('{"first-agent":["planning","planning",42,null,"removed-lesson"],"bad":"value","__proto__":["planning"]}');
  assert.deepEqual(progress, { "first-agent": ["planning", "removed-lesson"] });
  assert.equal(pathProgress(["planning", "tool-calling"], progress["first-agent"]).count, 1);
});

test("passing a shared article records only the selected path and survives serialization", () => {
  const first = completeCheckpoint({}, "first-agent", "planning");
  const twice = completeCheckpoint(first, "first-agent", "planning");
  assert.deepEqual(parseLearningProgress(JSON.stringify(twice)), { "first-agent": ["planning"] });
  assert.equal(pathProgress(["planning"], twice["reliable-agent"]).count, 0);
  const both = completeCheckpoint(twice, "reliable-agent", "planning");
  assert.deepEqual(both["first-agent"], ["planning"]);
  assert.deepEqual(both["reliable-agent"], ["planning"]);
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
