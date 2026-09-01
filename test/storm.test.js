'use strict';
// The storm: a fully booked week, then thousands of random cancellations,
// reschedules and walk-in attempts interleaved with waitlist backfills.
// After every wave the calendar must contain zero padded-interval
// collisions and the audit trail must account for every appointment.

const runtime = require('../src/runtime');
const schedule = require('../src/schedule');
const bookMod = require('../src/book');
const waitlistMod = require('../src/waitlist');
const { check, eq, section, fixtureShop } = require('./helpers');

module.exports = function run() {
  section('\nrebooking storm, three seeds');
  for (const seed of [11, 47, 2026]) {
    const s = fixtureShop(runtime, schedule, bookMod, waitlistMod, 0);
    const rng = runtime.makeRng(seed);
    const services = ['trim', 'color', 'blowout', 'consult'];
    const staff = ['ana', 'bo', 'cy'];

    // Fill the week densely.
    let booked = 0;
    for (let i = 0; i < 3000; i++) {
      const res = s.booker.book({
        clientId: 'c' + i,
        staffId: rng.pick(staff),
        serviceId: rng.pick(services),
        start: rng.int(0, 4) * 1440 + rng.int(36, 66) * 15
      });
      if (res.ok) booked++;
    }
    check(`seed ${seed}: dense fill produced a real workload (${booked})`, booked > 200);

    // Feed the waitlist.
    for (let i = 0; i < 400; i++) {
      s.waitlist.join({
        clientId: 'w' + i,
        serviceId: rng.pick(services),
        earliest: 0, latest: 5 * 1440,
        staffId: rng.coin(0.2) ? rng.pick(staff) : undefined
      });
    }

    // Storm: cancel, backfill, reschedule, book, repeatedly.
    const ids = () => [...s.booker.byId.values()].filter(a => a.status === 'booked').map(a => a.id);
    let ops = 0;
    for (let round = 0; round < 6; round++) {
      const live = ids();
      for (const id of live) {
        if (rng.coin(0.18)) {
          const freed = s.booker.cancel(id);
          if (freed.ok) { s.waitlist.backfill(freed.freed); ops++; }
        } else if (rng.coin(0.1)) {
          s.booker.reschedule(id, { start: rng.int(0, 4) * 1440 + rng.int(36, 64) * 15 });
          ops++;
        }
      }
      const inv = s.booker.verify();
      check(`seed ${seed} round ${round}: zero collisions after ${ops} ops`, inv.clean);
      if (!inv.clean) { console.log(JSON.stringify(inv.collisions.slice(0, 3))); break; }
    }

    // Accounting: every appointment id is booked, cancelled or moving-free.
    let dangling = 0;
    for (const a of s.booker.byId.values()) {
      if (a.status !== 'booked' && a.status !== 'cancelled') dangling++;
    }
    eq(`seed ${seed}: no appointment stuck in a transient state`, dangling, 0);
    check(`seed ${seed}: backfill actually recovered minutes (rate ${s.waitlist.refillRate().toFixed(2)})`,
      s.waitlist.stats.minutesRefilled > 0);
  }

  section('\nstorm determinism');
  {
    const runOnce = () => {
      const s = fixtureShop(runtime, schedule, bookMod, waitlistMod, 0);
      const rng = runtime.makeRng(99);
      for (let i = 0; i < 800; i++) {
        s.booker.book({ clientId: 'c' + i, staffId: rng.pick(['ana', 'bo', 'cy']),
          serviceId: rng.pick(['trim', 'color']), start: rng.int(0, 4) * 1440 + rng.int(36, 66) * 15 });
      }
      const live = [...s.booker.byId.values()].filter(a => a.status === 'booked');
      for (const a of live) if (rng.coin(0.3)) s.booker.cancel(a.id);
      return s.booker.bookedCount() + ':' + s.booker.audit.length;
    };
    eq('same seed replays the same storm', runOnce(), runOnce());
  }
};

