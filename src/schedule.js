'use strict';
// The calendar model. Time is integer minutes from an epoch, staff have
// working windows and breaks, services have a duration plus setup and
// cleanup buffers. An appointment occupies [start - setup, end + cleanup)
// on its staff member's calendar, and the overlap rule is enforced on that
// padded interval, not the customer-facing one. Mixing those two up is how
// real salons end up with a client in the chair while the last blowout is
// still being swept up.

function padded(appt, service) {
  return {
    from: appt.start - service.setupMin,
    to: appt.start + service.durationMin + service.cleanupMin
  };
}

function overlaps(a, b) {
  return a.from < b.to && b.from < a.to;
}

function makeCatalog() {
  const services = new Map();
  return {
    define(id, { durationMin, setupMin = 0, cleanupMin = 0, name }) {
      if (!Number.isInteger(durationMin) || durationMin <= 0) {
        throw new Error(`service ${id}: duration must be a positive integer`);
      }
      services.set(id, { id, name: name || id, durationMin, setupMin, cleanupMin });
      return services.get(id);
    },
    get(id) {
      const s = services.get(id);
      if (!s) throw new Error(`unknown service ${id}`);
      return s;
    }
  };
}

function makeRoster() {
  const staff = new Map();
  return {
    add(id, { windows, skills }) {
      // windows: array of [fromMinute, toMinute) the person works, absolute
      // minutes. Kept sorted, validated non-overlapping.
      const sorted = windows.slice().sort((x, y) => x[0] - y[0]);
      for (let i = 0; i < sorted.length; i++) {
        const [f, t] = sorted[i];
        if (t <= f) throw new Error(`staff ${id}: window ${i} is empty or inverted`);
        if (i > 0 && sorted[i - 1][1] > f) throw new Error(`staff ${id}: windows overlap`);
      }
      staff.set(id, { id, windows: sorted, skills: new Set(skills || []) });
    },
    get(id) {
      const p = staff.get(id);
      if (!p) throw new Error(`unknown staff ${id}`);
      return p;
    },
    all: () => [...staff.values()],
    canDo: (id, serviceId) => {
      const p = staff.get(id);
      return !!p && (p.skills.size === 0 || p.skills.has(serviceId));
    }
  };
}

// True when the padded interval sits fully inside one working window.
function insideWorkingHours(person, from, to) {
  for (const [f, t] of person.windows) {
    if (from >= f && to <= t) return true;
  }
  return false;
}

module.exports = { makeCatalog, makeRoster, padded, overlaps, insideWorkingHours };

