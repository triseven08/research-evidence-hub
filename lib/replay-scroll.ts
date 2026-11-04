// 当前步骤在横向/纵向滚动的步骤列表中需要移动多少才能回到可视区域。
// 返回 null 表示列表没有溢出或当前步骤已完整可见，此时不应触发滚动。
export type StepBox = { start: number; end: number };

export function scrollOffsetForStep(list: StepBox & { scrollSize: number; clientSize: number }, step: StepBox): number | null {
  if (!(list.scrollSize > list.clientSize + 1)) return null;
  const visible = step.start >= list.start && step.end <= list.end;
  if (visible) return null;
  const listSize = list.end - list.start;
  const stepSize = step.end - step.start;
  return step.start - list.start - (listSize - stepSize) / 2;
}
