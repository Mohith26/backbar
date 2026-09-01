# backbar

A scheduling engine for appointment businesses, written from scratch with no
dependencies. It models the part of a salon or studio that actually loses
money when software gets it wrong: double-booked chairs, buffers that nobody
respects, and cancelled time that never gets refilled.

I built this after reading about how much of a service business's day is
admin: juggling the book, calling waitlisted clients when something opens up,
quietly eating the gap when nobody picks up. The interesting engineering is
that every one of those workflows is a constraint problem sitting on top of
one invariant, so that is what the code is organized around.

## The invariant

An appointment occupies its padded interval: service duration plus setup and
cleanup buffers. No two padded intervals may overlap on one person's
calendar, ever. Everything else (search, booking, moves, backfill) proposes;
`book()` disposes. There is a `verify()` sweep that walks every calendar and
reports collisions, and the storm test calls it after every wave of chaos.

## What is in here

- `src/schedule.js` - services with buffers, staff with working windows and
  skills, the padded-interval math.
- `src/book.js` - booking with idempotency keys (retried requests replay
  instead of double-booking), atomic reschedules (a refused move changes
  nothing, a same-chair move does not false-conflict with itself), and slot
  search that only offers starts that would actually book.
- `src/waitlist.js` - cancellation backfill. Freed time is offered to
  waitlisted clients greedily, longest service first, queue age breaking
  ties, chaining placements back to back until the window is spent.
- `test/` - 81 checks including a three-seed rebooking storm.
- `bench.js` - produces `bench-results.json`; the numbers below are from a
  real run on Apple Silicon (single thread).

## Numbers from the bench

- 50,000 booking attempts against a 5-person, 6-day calendar processed at
  943,401 attempts/sec; the calendar saturates at 449 appointments and ends
  collision-free.
- Cancellation wave: 144 cancellations against a 2,500-entry waitlist seat
  150 waitlisted clients (chained placements outnumber the cancellations),
  refilling 3,585 of 3,705 freed minutes: a 96.8% refill rate.
- Slot search over a full week averages 0.27 ms per query on a calendar with
  15,000 attempted bookings.

## A bug the storm test caught

The first backfill implementation advanced its cursor by service duration
only. The next placement was proposed inside the previous service's cleanup
buffer, `book()` refused it (correctly), and every backfill chain stalled
after one client. The symptom was a refill rate pinned at exactly the length
of the first fitted service, which the storm test flagged. The fix moves the
cursor to the padded end of the seated appointment and proposes the next
start beyond the following client's setup buffer. The buffer math also means
a perfect refill is sometimes impossible, and the tests assert the honest
number rather than pretending otherwise.

## Limits

- Time is integer minutes from an arbitrary epoch; there is no timezone or
  DST handling. Real deployments live and die on that, this project does not
  try.
- Everything is in memory. No persistence, no concurrency across processes;
  "atomic" here means single-threaded transactional discipline.
- Backfill is greedy, not optimal. A bin-packing pass could beat it on
  contrived inputs; the greedy version is simple, fast and explainable to a
  front desk.

## Run it

```
node test/run.js
node bench.js
```

No install step. There is nothing to install.

