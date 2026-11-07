import { icsSequence } from './ics.util';

/** What the value was before this bug was fixed, kept so the regression is shown rather than described. */
const wrappingSequence = (at: Date) => Math.floor(at.getTime() / 1000) % 999999;

describe('icsSequence', () => {
  it('increases as time passes', () => {
    const first = icsSequence(new Date('2026-11-05T12:00:00Z'));
    const second = icsSequence(new Date('2026-11-05T12:00:01Z'));

    expect(second).toBeGreaterThan(first);
  });

  it('never goes backwards across the window where the old formula wrapped', () => {
    // 999999 seconds is 11 days 13 hours 46 minutes 39 seconds. The old value
    // was seconds-since-epoch modulo that, so it returned to zero on every
    // such boundary and the invite after a wrap carried a LOWER SEQUENCE than
    // the one the member's calendar already held — which a client discards in
    // silence, keeping its stale copy.
    //
    // Two seconds apart, straddling the next boundary after an arbitrary date:
    // spanning a whole period instead would land on the same value, not a
    // lower one, which is how this looks fine until it is drawn out.
    const boundarySec = Math.ceil(Date.UTC(2026, 10, 5) / 1000 / 999999) * 999999;
    const before = new Date((boundarySec - 1) * 1000);
    const after = new Date((boundarySec + 1) * 1000);

    expect(wrappingSequence(after)).toBeLessThan(wrappingSequence(before));
    expect(icsSequence(after)).toBeGreaterThan(icsSequence(before));
  });

  it('is monotonic over every wrap boundary in a year of daily sends', () => {
    const start = Date.UTC(2026, 0, 1);
    let previous = -1;

    for (let day = 0; day < 365; day++) {
      const current = icsSequence(new Date(start + day * 86400 * 1000));
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('stays inside the signed 32-bit range RFC 5545 allows for an INTEGER', () => {
    // Also a check on the choice of epoch: seconds since 1970 would already
    // overflow in 2038, which is inside the life of a deployment.
    expect(icsSequence(new Date('2087-12-31T23:59:59Z'))).toBeLessThan(2147483647);
  });

  it('is never negative for a date before its epoch', () => {
    // A SEQUENCE must be a non-negative INTEGER. Nothing should produce a date
    // this old, but a bad import or a clock skewed backwards would.
    expect(icsSequence(new Date('2019-01-01T00:00:00Z'))).toBe(0);
  });
});
