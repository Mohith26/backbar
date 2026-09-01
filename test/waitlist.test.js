'use strict';
const runtime = require('../src/runtime');
const schedule = require('../src/schedule');
const bookMod = require('../src/book');
const waitlistMod = require('../src/waitlist');
const { check, eq, section, fixtureShop } = require('./helpers');

function shop(start) { return fixtureShop(runtime, schedule, bookMod, waitlistMod, start); }

module.exports = function run() {
  section('\nwaitlist backfill');
  {
    const s = shop();
    const appt = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'color', start: 600 }).appointment;
    s.waitlist.join({ clientId: 'w1', serviceId: 'trim', earliest: 540, latest: 1020 });
    const freed = s.booker.cancel(appt.id).freed;
    const placed = s.waitlist.backfill(freed);
    eq('cancelled color seats the waiting trim', placed.length, 1);
    eq('the trim starts where the color started', placed[0].appt.start, 600);
    check('no collisions after backfill', s.booker.verify().clean);
  }

  section('\nlongest fit wins, age breaks ties');
  {
    const s = shop();
    const appt = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'color', start: 600 }).appointment;
    s.waitlist.join({ clientId: 'shorty', serviceId: 'consult', earliest: 540, latest: 1020 }); // 15 min, oldest
    s.clock.tick(1);
    s.waitlist.join({ clientId: 'moxie', serviceId: 'blowout', earliest: 540, latest: 1020 }); // 45+5 min
    s.clock.tick(1);
    s.waitlist.join({ clientId: 'trimmer', serviceId: 'trim', earliest: 540, latest: 1020 }); // 30 min
    const placed = s.waitlist.backfill(s.booker.cancel(appt.id).freed);
    // 90 freed minutes: blowout (45 + 5 cleanup) wins despite being younger,
    // then trim (30) lands after the cleanup buffer. That leaves 10 minutes,
    // not enough for the 15 minute consult, so shorty stays waiting. The
    // buffers make a perfect refill impossible here and the math should say so.
    eq('two clients seated back to back', placed.map(p => p.entry.clientId), ['moxie', 'trimmer']);
    eq('75 of 90 freed minutes refilled', s.waitlist.stats.minutesRefilled, 75);
    eq('shorty is still waiting', s.waitlist.waiting(), 1);
    check('calendar is clean', s.booker.verify().clean);
  }

  section('\nconstraints are honored');
  {
    const s = shop();
    const appt = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'color', start: 600 }).appointment;
    s.waitlist.join({ clientId: 'picky', serviceId: 'trim', earliest: 540, latest: 1020, staffId: 'bo' });
    s.waitlist.join({ clientId: 'late', serviceId: 'consult', earliest: 700, latest: 1020 });
    const placed = s.waitlist.backfill(s.booker.cancel(appt.id).freed);
    eq('nobody eligible means nothing placed', placed.length, 0);
    eq('both entries still waiting', s.waitlist.waiting(), 2);
    // a color freed on cy: 'picky' still refuses (wants bo), 'late' fits when the window is late enough
    const appt2 = s.booker.book({ clientId: 'c2', staffId: 'cy', serviceId: 'color', start: 800 }).appointment;
    const placed2 = s.waitlist.backfill(s.booker.cancel(appt2.id).freed);
    eq('window-eligible client is seated', placed2.length, 1);
    eq('it is the one whose window matched', placed2.length ? placed2[0].entry.clientId : null, 'late');
  }

  section('\nskill gaps stop a placement');
  {
    const s = shop();
    // bo cannot do color; freeing bo time should not seat a color client
    const appt = s.booker.book({ clientId: 'c1', staffId: 'bo', serviceId: 'blowout', start: 600 }).appointment;
    s.waitlist.join({ clientId: 'colorme', serviceId: 'color', earliest: 540, latest: 1020 });
    const placed = s.waitlist.backfill(s.booker.cancel(appt.id).freed);
    eq('color client is not forced onto unskilled staff', placed.length, 0);
    check('calendar is still clean', s.booker.verify().clean);
  }

  section('\na placed client leaves the queue');
  {
    const s = shop();
    const a1 = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'trim', start: 600 }).appointment;
    const a2 = s.booker.book({ clientId: 'c2', staffId: 'ana', serviceId: 'trim', start: 700 }).appointment;
    s.waitlist.join({ clientId: 'w1', serviceId: 'trim', earliest: 540, latest: 1020 });
    const p1 = s.waitlist.backfill(s.booker.cancel(a1.id).freed);
    eq('seated once', p1.length, 1);
    const p2 = s.waitlist.backfill(s.booker.cancel(a2.id).freed);
    eq('not seated twice', p2.length, 0);
    eq('queue is empty', s.waitlist.waiting(), 0);
  }
};

