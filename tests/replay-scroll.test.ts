import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollOffsetForStep } from "../lib/replay-scroll.ts";

// 宽屏下步骤列表完整展开，不滚动；此时不应劫持任何滚动位置。
test("a step list that does not overflow never scrolls", () => {
  const list = { start: 0, end: 300, scrollSize: 300, clientSize: 300 };
  assert.equal(scrollOffsetForStep(list, { start: 0, end: 60 }), null);
  assert.equal(scrollOffsetForStep(list, { start: 240, end: 300 }), null);
  // 即使步骤框超出一个不滚动的容器，也不触发滚动。
  assert.equal(scrollOffsetForStep(list, { start: 400, end: 460 }), null);
});

// 窄屏横向滚动：当前步骤已完整可见时保持不动，避免播放时画面抖动。
test("a fully visible step inside an overflowing list stays put", () => {
  const list = { start: 39, end: 337, scrollSize: 2046, clientSize: 298 };
  assert.equal(scrollOffsetForStep(list, { start: 39, end: 189 }), null);
  assert.equal(scrollOffsetForStep(list, { start: 187, end: 337 }), null);
});

// 回归：13 步案例在 390px 宽度播放时，当前步骤曾移出可视区且列表不跟随。
test("a step outside the visible window is centred in both directions", () => {
  const row = { start: 39, end: 337, scrollSize: 2046, clientSize: 298 };
  const ahead = scrollOffsetForStep(row, { start: 1619, end: 1769 });
  assert.ok(ahead !== null && ahead > 0, String(ahead));
  assert.equal(ahead, 1619 - 39 - (298 - 150) / 2);
  const behind = scrollOffsetForStep(row, { start: -200, end: -50 });
  assert.ok(behind !== null && behind < 0, String(behind));
  const column = { start: 0, end: 400, scrollSize: 916, clientSize: 400 };
  const below = scrollOffsetForStep(column, { start: 700, end: 764 });
  assert.ok(below !== null && below > 0, String(below));
});

// 部分可见也要滚动：否则末尾步骤会卡在半截位置。
test("a partially clipped step is brought back into view", () => {
  const list = { start: 39, end: 337, scrollSize: 2046, clientSize: 298 };
  assert.ok(scrollOffsetForStep(list, { start: 300, end: 450 }) !== null);
  assert.ok(scrollOffsetForStep(list, { start: -20, end: 130 }) !== null);
});
