'use strict';
// Test scaffolding. check() records a labelled boolean, eq() formats a
// readable diff, and report() prints the tally and sets the exit code.

const tally = { pass: 0, fail: 0, notes: [] };

function check(label, cond) {
  if (cond) { tally.pass++; }
  else { tally.fail++; tally.notes.push(label); console.log('  FAIL ' + label); }
}

function eq(label, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) console.log(`  FAIL ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  if (same) tally.pass++; else { tally.fail++; tally.notes.push(label); }
}

function boom(label, fn, needle) {
  try { fn(); tally.fail++; tally.notes.push(label); console.log('  FAIL ' + label + ' (no throw)'); }
  catch (err) {
    if (needle && !String(err.message).includes(needle)) {
      tally.fail++; tally.notes.push(label);
      console.log('  FAIL ' + label + ' (wrong error: ' + err.message + ')');
    } else tally.pass++;
  }
}

function section(name) { console.log(name); }

function report() {
  console.log(`\n${tally.pass} checks passed, ${tally.fail} failed`);
  if (tally.fail > 0) process.exitCode = 1;
  return tally;
}

// One fully wired shop used across the suite: three staff, four services.
function fixtureShop({ makeClock, makeRng }, { makeCatalog, makeRoster }, { makeBooker }, { makeWaitlist }, startMinute) {
  const clock = makeClock(startMinute === undefined ? 0 : startMinute);
  const catalog = makeCatalog();
  catalog.define('trim', { durationMin: 30 });
  catalog.define('color', { durationMin: 90, setupMin: 10, cleanupMin: 10 });
  catalog.define('blowout', { durationMin: 45, cleanupMin: 5 });
  catalog.define('consult', { durationMin: 15 });
  const roster = makeRoster();
  // Day 0 is minutes 540..1020 (9:00 to 17:00), five days.
  const days = (n) => Array.from({ length: n }, (_, d) => [d * 1440 + 540, d * 1440 + 1020]);
  roster.add('ana', { windows: days(5), skills: ['trim', 'color', 'blowout', 'consult'] });
  roster.add('bo', { windows: days(5), skills: ['trim', 'blowout', 'consult'] });
  roster.add('cy', { windows: days(5), skills: ['color', 'consult'] });
  const booker = makeBooker({ catalog, roster, clock });
  const waitlist = makeWaitlist({ catalog, booker, clock });
  return { clock, catalog, roster, booker, waitlist };
}

module.exports = { check, eq, boom, section, report, fixtureShop, tally };

