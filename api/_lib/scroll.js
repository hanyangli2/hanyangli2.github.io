/**
 * Essay scroll-depth helpers (unit-tested).
 */

const SCROLL_MARKS = [25, 50, 75, 100];

function scrollDepthPercent(scrollTop, scrollHeight, clientHeight) {
  const max = Number(scrollHeight) - Number(clientHeight);
  if (!Number.isFinite(max) || max <= 0) return 100;
  const pct = (Number(scrollTop) / max) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

function newlyCrossedMarks(previousPercent, nextPercent, marks = SCROLL_MARKS) {
  const prev = Number(previousPercent) || 0;
  const next = Number(nextPercent) || 0;
  return marks.filter((mark) => prev < mark && next >= mark);
}

module.exports = { SCROLL_MARKS, scrollDepthPercent, newlyCrossedMarks };
