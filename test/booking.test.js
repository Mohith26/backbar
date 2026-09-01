'use strict';
const runtime = require('../src/runtime');
const schedule = require('../src/schedule');
const bookMod = require('../src/book');
const waitlistMod = require('../src/waitlist');
const { check, eq, boom, section, fixtureShop } = require('./helpers');

function shop(start) { return fixtureShop(runtime, schedule, bookMod, waitlistMod, start); }

module.exports = function run() {
  section('\ncalendar model');
  {
    const { catalog, roster } = shop();
    boom('empty working window is rejected', () => roster.add('dd', { windows: [[600, 600]] }), 'empty');
    boom('overlapping windows are rejected', () => roster.add('ee', { windows: [[540, 700], [660, 800]] }), 'overlap');
    boom('zero duration service is rejected', () => catalog.define('bad', { durationMin: 0 }), 'positive');
    boom('unknown service lookup throws', () => catalog.get('nope'), 'unknown');
  }

  section('\nbooking basics');
  {
    const s = shop();
    const r1 = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'trim', start: 600 });
    check('a clean booking succeeds', r1.ok);
    eq('booked interval is duration long', r1.appointment.end - r1.appointment.start, 30);
    const r2 = s.booker.book({ clientId: 'c2', staffId: 'ana', serviceId: 'trim', start: 615 });
    eq('overlapping booking on same staff is refused', r2, { ok: false, why: 'conflict' });
    const r3 = s.booker.book({ clientId: 'c2', staffId: 'bo', serviceId: 'trim', start: 615 });
    check('same time on another staff is fine', r3.ok);
    const r4 = s.booker.book({ clientId: 'c3', staffId: 'ana', serviceId: 'trim', start: 500 });
    eq('before opening is refused', r4.why, 'outside_hours');
    const r5 = s.booker.book({ clientId: 'c3', staffId: 'ana', serviceId: 'trim', start: 1005 });
    eq('running past closing is refused', r5.why, 'outside_hours');
    const r6 = s.booker.book({ clientId: 'c3', staffId: 'bo', serviceId: 'color', start: 700 });
    eq('staff without the skill is refused', r6.why, 'staff_lacks_skill');
  }

  section('\nbuffers are part of the conflict window');
  {
    const s = shop();
    // color pads 10 before and 10 after: booked at 700 it holds 690..800.
    check('color books', s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'color', start: 700 }).ok);
    const before = s.booker.book({ clientId: 'c2', staffId: 'ana', serviceId: 'trim', start: 665 });
    eq('trim ending inside the setup buffer is refused', before.why, 'conflict');
    const after = s.booker.book({ clientId: 'c2', staffId: 'ana', serviceId: 'trim', start: 795 });
    eq('trim starting inside the cleanup buffer is refused', after.why, 'conflict');
    const clear = s.booker.book({ clientId: 'c2', staffId: 'ana', serviceId: 'trim', start: 800 });
    check('trim starting exactly when the buffer ends is fine', clear.ok);
    // a color at the very edge of the day: padded start would cross opening
    const edge = s.booker.book({ clientId: 'c3', staffId: 'cy', serviceId: 'color', start: 545 });
    eq('setup buffer crossing opening time is refused', edge.why, 'outside_hours');
  }

  section('\nidempotent booking');
  {
    const s = shop();
    const a = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'trim', start: 600, requestKey: 'k1' });
    const b = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'trim', start: 600, requestKey: 'k1' });
    check('retry with the same key replays the same appointment', b.replayed && b.appointment.id === a.appointment.id);
    eq('only one appointment exists', s.booker.bookedCount(), 1);
    const c = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'trim', start: 600 });
    eq('same slot without the key is a real conflict', c.why, 'conflict');
    // failed results replay too
    const f1 = s.booker.book({ clientId: 'c9', staffId: 'bo', serviceId: 'color', start: 600, requestKey: 'k2' });
    const f2 = s.booker.book({ clientId: 'c9', staffId: 'bo', serviceId: 'color', start: 600, requestKey: 'k2' });
    check('a refused request replays as refused', !f1.ok && !f2.ok && f2.replayed);
  }

  section('\nreschedule keeps or moves atomically');
  {
    const s = shop();
    const a = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'blowout', start: 600 }).appointment;
    // same staff, shifted 15 minutes into its own old footprint: must succeed
    const moved = s.booker.reschedule(a.id, { start: 615 });
    check('shifting into your own old slot works', moved.ok);
    eq('old appointment is gone', s.booker.byId.get(a.id).status, 'cancelled');
    eq('exactly one booking remains', s.booker.bookedCount(), 1);
    // blocked target leaves everything untouched
    s.booker.book({ clientId: 'c2', staffId: 'bo', serviceId: 'trim', start: 900 });
    const b = s.booker.book({ clientId: 'c3', staffId: 'bo', serviceId: 'trim', start: 700 }).appointment;
    const refused = s.booker.reschedule(b.id, { start: 910 });
    eq('move into a conflict is refused', refused.why, 'conflict');
    eq('refused move leaves the original booked', s.booker.byId.get(b.id).status, 'booked');
    const inv = s.booker.verify();
    check('calendar is collision free afterwards', inv.clean);
  }

  section('\nslot search');
  {
    const s = shop();
    s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'color', start: 600 });
    const slots = s.booker.findSlots({ serviceId: 'color', fromMinute: 540, toMinute: 1020 });
    check('search returns some slots', slots.length > 0);
    // the booked color at 600 pads to 590..700; another color at t pads to
    // t-10..t+100, so the collision band is t in (490, 710). On the grid
    // that is 495 through 705 inclusive.
    check('search never offers ana inside her color footprint',
      !slots.some(x => x.staffId === 'ana' && x.start >= 495 && x.start <= 705));
    check('search only offers color-skilled staff', slots.every(x => x.staffId === 'ana' || x.staffId === 'cy'));
    const capped = s.booker.findSlots({ serviceId: 'trim', fromMinute: 540, toMinute: 1020, limit: 5 });
    eq('limit is respected', capped.length, 5);
    // offers must stay bookable as the calendar changes: book the top offer,
    // re-search, repeat. Booking stale offers sequentially would conflict.
    for (let round = 0; round < 5; round++) {
      const top = s.booker.findSlots({ serviceId: 'trim', fromMinute: 540, toMinute: 1020, limit: 1 })[0];
      check('round ' + round + ': fresh top offer books (' + top.staffId + '@' + top.start + ')',
        s.booker.book({ clientId: 'x' + round, staffId: top.staffId, serviceId: 'trim', start: top.start }).ok);
    }
  }

  section('\npast bookings are refused');
  {
    const s = shop(700); // clock starts mid-day
    const late = s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'trim', start: 650 });
    eq('booking earlier than now is refused', late.why, 'in_the_past');
    check('booking later today works', s.booker.book({ clientId: 'c1', staffId: 'ana', serviceId: 'trim', start: 720 }).ok);
  }
};

