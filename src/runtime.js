'use strict';
// Shared runtime bits: a controllable clock and a fast deterministic RNG.
// Everything time-related in the engine reads this clock, which is what makes
// the storm tests reproducible down to the minute.

function makeClock(startMinute) {
  let minute = startMinute === undefined ? 0 : startMinute;
  return {
    now: () => minute,
    tick: (n) => { minute += (n === undefined ? 1 : n); return minute; },
    jumpTo: (m) => { if (m > minute) minute = m; return minute; }
  };
}

// xorshift32. Not cryptographic, just repeatable.
function makeRng(seed) {
  let s = (seed >>> 0) || 0x1badf00d;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
  return {
    next,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    coin: (p) => next() < p
  };
}

module.exports = { makeClock, makeRng };

