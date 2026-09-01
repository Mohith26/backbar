'use strict';
// Booking engine. Owns the per-staff appointment lists and every invariant
// worth having: no two padded intervals overlap on one calendar, bookings
// only land inside working hours, retried requests do not double-book, and
// a reschedule either fully happens or fully does not.

const { padded, overlaps, insideWorkingHours } = require('./schedule');

const GRID_MIN = 15; // slot search granularity

function makeBooker({ catalog, roster, clock }) {
  const byStaff = new Map();   // staffId -> sorted array of appts
  const byId = new Map();      // apptId -> appt
  const requests = new Map();  // idempotency key -> result
  const audit = [];
  let seq = 0;

  function calendarOf(staffId) {
    if (!byStaff.has(staffId)) byStaff.set(staffId, []);
    return byStaff.get(staffId);
  }

  function fits(staffId, service, start) {
    const person = roster.get(staffId);
    const span = padded({ start }, service);
    if (span.from < clock.now()) return { ok: false, why: 'in_the_past' };
    if (!insideWorkingHours(person, span.from, span.to)) return { ok: false, why: 'outside_hours' };
    for (const other of calendarOf(staffId)) {
      if (other.status !== 'booked') continue;
      const otherSpan = padded(other, catalog.get(other.serviceId));
      if (overlaps(span, otherSpan)) return { ok: false, why: 'conflict', with: other.id };
    }
    return { ok: true };
  }

  function insertSorted(list, appt) {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start < appt.start) lo = mid + 1; else hi = mid;
    }
    list.splice(lo, 0, appt);
  }

  function book({ clientId, staffId, serviceId, start, requestKey }) {
    if (requestKey && requests.has(requestKey)) {
      const prior = requests.get(requestKey);
      return { ...prior, replayed: true };
    }
    const service = catalog.get(serviceId);
    if (!roster.canDo(staffId, serviceId)) {
      const out = { ok: false, why: 'staff_lacks_skill' };
      if (requestKey) requests.set(requestKey, out);
      return out;
    }
    const check = fits(staffId, service, start);
    if (!check.ok) {
      const out = { ok: false, why: check.why };
      if (requestKey) requests.set(requestKey, out);
      return out;
    }
    const appt = {
      id: `appt_${++seq}`, clientId, staffId, serviceId, start,
      end: start + service.durationMin, status: 'booked', bookedAt: clock.now()
    };
    insertSorted(calendarOf(staffId), appt);
    byId.set(appt.id, appt);
    audit.push({ at: clock.now(), what: 'book', id: appt.id });
    const out = { ok: true, appointment: appt };
    if (requestKey) requests.set(requestKey, out);
    return out;
  }

  function cancel(apptId) {
    const appt = byId.get(apptId);
    if (!appt || appt.status !== 'booked') return { ok: false, why: 'not_booked' };
    appt.status = 'cancelled';
    audit.push({ at: clock.now(), what: 'cancel', id: apptId });
    return { ok: true, freed: { staffId: appt.staffId, start: appt.start, serviceId: appt.serviceId } };
  }

  // Reschedule is book-then-cancel under the hood, in that order. If the new
  // slot is refused nothing changes; the old appointment is only released
  // after the new one exists. The transient state where both exist is fine
  // because they belong to the same client and the invariant we protect is
  // per-staff overlap, which book() already checked.
  function reschedule(apptId, { staffId, start }) {
    const appt = byId.get(apptId);
    if (!appt || appt.status !== 'booked') return { ok: false, why: 'not_booked' };
    const target = {
      clientId: appt.clientId,
      staffId: staffId === undefined ? appt.staffId : staffId,
      serviceId: appt.serviceId,
      start
    };
    // Same-calendar move: cancel first would lose the slot to nobody, but
    // book first can false-conflict with the appointment being moved. So for
    // same-staff moves the old appointment is masked during the check.
    if (target.staffId === appt.staffId) {
      appt.status = 'moving';
      const res = book(target);
      if (!res.ok) { appt.status = 'booked'; return res; }
      appt.status = 'cancelled';
      audit.push({ at: clock.now(), what: 'reschedule', from: apptId, to: res.appointment.id });
      return res;
    }
    const res = book(target);
    if (!res.ok) return res;
    appt.status = 'cancelled';
    audit.push({ at: clock.now(), what: 'reschedule', from: apptId, to: res.appointment.id });
    return res;
  }

  function findSlots({ serviceId, staffId, fromMinute, toMinute, limit }) {
    const service = catalog.get(serviceId);
    const people = staffId ? [roster.get(staffId)] : roster.all().filter(p => roster.canDo(p.id, serviceId));
    const found = [];
    const lo = Math.max(fromMinute, clock.now());
    for (let t = Math.ceil(lo / GRID_MIN) * GRID_MIN; t < toMinute; t += GRID_MIN) {
      for (const p of people) {
        if (fits(p.id, service, t).ok) {
          found.push({ staffId: p.id, start: t });
          if (limit && found.length >= limit) return found;
        }
      }
    }
    return found;
  }

  // The invariant sweep the tests lean on: walks every calendar and returns
  // any pair of booked appointments whose padded intervals collide.
  function verify() {
    const collisions = [];
    for (const [staffId, list] of byStaff) {
      const booked = list.filter(a => a.status === 'booked');
      for (let i = 1; i < booked.length; i++) {
        const a = padded(booked[i - 1], catalog.get(booked[i - 1].serviceId));
        const b = padded(booked[i], catalog.get(booked[i].serviceId));
        if (overlaps(a, b)) collisions.push({ staffId, a: booked[i - 1].id, b: booked[i].id });
      }
    }
    return { clean: collisions.length === 0, collisions };
  }

  function bookedCount() {
    let n = 0;
    for (const list of byStaff.values()) n += list.filter(a => a.status === 'booked').length;
    return n;
  }

  return { book, cancel, reschedule, findSlots, verify, bookedCount, byId, audit };
}

module.exports = { makeBooker, GRID_MIN };

