'use strict';

function parseByteRange(header, size) {
  const total = Math.max(0, Number(size) || 0);
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2]) || total <= 0) return { invalid: true, size: total };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true, size: total };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= total) {
    return { invalid: true, size: total };
  }
  return { invalid: false, start, end, length: end - start + 1, size: total };
}

module.exports = { parseByteRange };
