'use strict';
// Numbers for the README. A five-chair shop, a heavily booked week, a
// cancellation wave with live waitlist backfill, and slot search timing.
// Writes bench-results.json next to this file.

const fs = require('fs');
const path = require('path');
const { makeClock, makeRng } = require('./src/runtime');
const { makeCatalog, makeRoster } = require('./src/schedule');
const { makeBooker } = require('./src/book');
const { makeWaitlist } = require('./src/waitlist');

const tick = () => {
  if (typeof process !== 'undefined' && process.hrtime && process.hrtime.bigint) {
    return Number(process.hrtime.bigint()) / 1e6;
  }
  return Date.now();
};

function bigShop() {
  const clock = makeClock(0);
  const catalog = makeCatalog();
  catalog.define('trim', { durationMin: 30 });
  catalog.define('color', { durationMin: 90, setupMin: 10, cleanupMin: 10 });
  catalog.define('blowout', { durationMin: 45, cleanupMin: 5 });
  catalog.define('consult', { durationMin: 15 });
  catalog.define('balayage', { durationMin: 150, setupMin: 15, cleanupMin: 15 });
  const roster = makeRoster();
  const days = (n) => Array.from({ length: n }, (_, d) => [d * 1440 + 540, d * 1440 + 1020]);
  for (const id of ['ana', 'bo', 'cy', 'dee', 'em']) {
    roster.add(id, { windows: days(6), skills: [] }); // empty skills = does everything
  }
  const booker = makeBooker({ catalog, roster, clock });
  const waitlist = makeWaitlist({ catalog, booker, clock });
  return { clock, catalog, roster, booker, waitlist };
}

function main() {
  const out = { machine: 'Apple Silicon arm64, single thread', sections: {} };
  const services = ['trim', 'color', 'blowout', 'consult', 'balayage'];
  const staff = ['ana', 'bo', 'cy', 'dee', 'em'];

  // 1. booking throughput on a filling calendar
  {
    const s = bigShop();
    const rng = makeRng(7);
    const attempts = 50000;
    const t0 = tick();
    let ok = 0;
    for (let i = 0; i < attempts; i++) {
      const r = s.booker.book({
        clientId: 'c' + i, staffId: staff[i % 5],
        serviceId: services[rng.int(0, 4)],
        start: rng.int(0, 5) * 1440 + rng.int(36, 66) * 15,
        requestKey: 'bk' + i
      });
      if (r.ok) ok++;
    }
    const ms = tick() - t0;
    out.sections.booking = {
      attempts, accepted: ok, rejected: attempts - ok,
      elapsedMs: +ms.toFixed(1),
      attemptsPerSecond: Math.round(attempts / (ms / 1000)),
      finalCalendarClean: s.booker.verify().clean
    };
  }

  // 2. cancellation wave with live backfill
  {
    const s = bigShop();
    const rng = makeRng(13);
    for (let i = 0; i < 20000; i++) {
      s.booker.book({ clientId: 'c' + i, staffId: staff[i % 5],
        serviceId: services[rng.int(0, 4)], start: rng.int(0, 5) * 1440 + rng.int(36, 66) * 15 });
    }
    const before = s.booker.bookedCount();
    for (let i = 0; i < 2500; i++) {
      s.waitlist.join({ clientId: 'w' + i, serviceId: services[rng.int(0, 4)],
        earliest: 0, latest: 6 * 1440, staffId: rng.coin(0.25) ? staff[rng.int(0, 4)] : undefined });
    }
    const live = [...s.booker.byId.values()].filter(a => a.status === 'booked');
    const t0 = tick();
    let cancels = 0;
    for (const a of live) {
      if (rng.coin(0.3)) {
        const freed = s.booker.cancel(a.id);
        if (freed.ok) { cancels++; s.waitlist.backfill(freed.freed); }
      }
    }
    const ms = tick() - t0;
    out.sections.cancellationWave = {
      calendarBefore: before, cancellations: cancels,
      waitlistSize: 2500,
      clientsSeatedFromWaitlist: s.waitlist.stats.placed,
      minutesFreed: s.waitlist.stats.minutesFreed,
      minutesRefilled: s.waitlist.stats.minutesRefilled,
      refillRate: +s.waitlist.refillRate().toFixed(4),
      elapsedMs: +ms.toFixed(1),
      cancelPlusBackfillPerSecond: Math.round(cancels / (ms / 1000)),
      finalCalendarClean: s.booker.verify().clean
    };
  }

  // 3. slot search latency on a busy calendar
  {
    const s = bigShop();
    const rng = makeRng(21);
    for (let i = 0; i < 15000; i++) {
      s.booker.book({ clientId: 'c' + i, staffId: staff[i % 5],
        serviceId: services[rng.int(0, 4)], start: rng.int(0, 5) * 1440 + rng.int(36, 66) * 15 });
    }
    const t0 = tick();
    const searches = 2000;
    let found = 0;
    for (let i = 0; i < searches; i++) {
      found += s.booker.findSlots({ serviceId: services[i % 5], fromMinute: 0, toMinute: 6 * 1440, limit: 10 }).length;
    }
    const ms = tick() - t0;
    out.sections.slotSearch = {
      searches, slotsReturned: found,
      elapsedMs: +ms.toFixed(1),
      searchesPerSecond: Math.round(searches / (ms / 1000)),
      meanMsPerSearch: +(ms / searches).toFixed(3)
    };
  }

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, 'bench-results.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

module.exports = { main };

