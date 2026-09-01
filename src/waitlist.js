'use strict';
// Waitlist and backfill. When an appointment cancels, the freed time is
// offered to waitlisted clients automatically. Selection is not first come
// first served alone: the filler prefers the candidate set that leaves the
// least dead air in the freed window, and only breaks ties by queue age.
// A 60 minute hole filled by one 60 minute color beats a 30 minute trim
// even if the trim client asked first, because unfilled minutes are revenue
// the business never gets back.

function makeWaitlist({ catalog, booker, clock }) {
  const entries = [];
  let seq = 0;
  const stats = { offered: 0, placed: 0, unplaceable: 0, minutesFreed: 0, minutesRefilled: 0 };

  function join({ clientId, serviceId, earliest, latest, staffId }) {
    const e = {
      id: `wl_${++seq}`, clientId, serviceId,
      earliest, latest, staffId: staffId || null,
      joinedAt: clock.now(), status: 'waiting'
    };
    entries.push(e);
    return e;
  }

  function candidatesFor(freed) {
    return entries.filter(e =>
      e.status === 'waiting' &&
      (e.staffId === null || e.staffId === freed.staffId) &&
      e.earliest <= freed.start &&
      e.latest >= freed.start + catalog.get(e.serviceId).durationMin
    );
  }

  // Greedy best fit into the freed window: longest service that still fits,
  // then oldest entry. Runs repeatedly until nothing fits, so one long
  // cancellation can seat several short waitlisted services back to back.
  //
  // The cursor advances by the seated service's padded footprint, not just
  // its duration. The first version of this advanced by duration alone,
  // which proposed the next start inside the previous service's cleanup
  // buffer; book() correctly refused it and the whole chain stalled after
  // one placement. The storm test caught it as a refill rate stuck at 0.5.
  function backfill(freed) {
    const service = catalog.get(freed.serviceId);
    const windowEnd = freed.start + service.durationMin;
    stats.minutesFreed += service.durationMin;
    const placed = [];
    let cursor = freed.start; // padded end of whatever was seated last

    for (;;) {
      const fits = candidatesFor({ staffId: freed.staffId, start: cursor })
        .filter(e => {
          const svc = catalog.get(e.serviceId);
          const startAt = cursor + svc.setupMin;
          return startAt + svc.durationMin <= windowEnd && e.latest >= startAt + svc.durationMin;
        })
        .sort((a, b) => {
          const da = catalog.get(a.serviceId).durationMin;
          const db = catalog.get(b.serviceId).durationMin;
          if (db !== da) return db - da;
          return a.joinedAt - b.joinedAt;
        });
      let seated = null;
      for (const e of fits) {
        stats.offered++;
        const svc = catalog.get(e.serviceId);
        const res = booker.book({
          clientId: e.clientId, staffId: freed.staffId,
          serviceId: e.serviceId, start: cursor + svc.setupMin,
          requestKey: `backfill_${e.id}_${cursor}`
        });
        if (res.ok) { seated = { entry: e, appt: res.appointment, svc }; break; }
      }
      if (!seated) break;
      seated.entry.status = 'placed';
      stats.placed++;
      stats.minutesRefilled += seated.svc.durationMin;
      placed.push(seated);
      cursor = seated.appt.start + seated.svc.durationMin + seated.svc.cleanupMin;
      if (cursor >= windowEnd) break;
    }
    if (placed.length === 0) stats.unplaceable++;
    return placed;
  }

  function waiting() { return entries.filter(e => e.status === 'waiting').length; }
  function refillRate() {
    return stats.minutesFreed === 0 ? 1 : stats.minutesRefilled / stats.minutesFreed;
  }

  return { join, backfill, waiting, stats, refillRate, entries };
}

module.exports = { makeWaitlist };

