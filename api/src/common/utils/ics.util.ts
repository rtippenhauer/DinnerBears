/** Assumed dinner length for calendar entries — DinnerBears doesn't store an explicit end time. */
export const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

// RFC 5545 §3.1: a CONTENT-LINE may be no longer than 75 octets; continuation
// lines (after the first fold) lose one octet to the leading space.
const RFC5545_LINE_LIMIT = 75;
const RFC5545_CONTINUATION_LIMIT = 74;
// UTF-8 continuation-byte mask: 10xxxxxx bytes (0x80-0xBF) must never be split from their lead byte.
const UTF8_CONTINUATION_MASK = 0xc0;
const UTF8_CONTINUATION_TAG = 0x80;

/** Escapes a value for use in an RFC 5545 TEXT property (SUMMARY, DESCRIPTION, LOCATION, etc). */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Converts a stored "America/New_York" wall-clock date+time into a UTC Date,
 * accounting for DST — event times are stored as Eastern local time, but
 * RFC 5545 DTSTART/DTEND values must be UTC.
 */
export function eventTimeToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);

  const approx = new Date(Date.UTC(y, m - 1, d, h, min, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(approx);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const easternH = get('hour') % 24;
  const easternMin = get('minute');
  const diffMin = (h * 60 + min) - (easternH * 60 + easternMin);
  return new Date(approx.getTime() + diffMin * 60 * 1000);
}

/** Formats a Date as an RFC 5545 UTC DATE-TIME value (YYYYMMDDTHHMMSSZ). */
export function toIcsUtcString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Folds a CONTENT-LINE to RFC 5545's 75-octet limit, breaking only on UTF-8 character boundaries. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= RFC5545_LINE_LIMIT) return line;

  const parts: string[] = [];
  let pos = 0;
  let first = true;

  while (pos < bytes.length) {
    const limit = first ? RFC5545_LINE_LIMIT : RFC5545_CONTINUATION_LIMIT;
    let end = Math.min(pos + limit, bytes.length);
    while (end > pos && (bytes[end] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_TAG) end--;
    parts.push(bytes.subarray(pos, end).toString('utf-8'));
    pos = end;
    first = false;
  }

  return parts.join('\r\n ');
}

// SEQUENCE is an RFC 5545 INTEGER, which the spec caps at the signed 32-bit
// maximum. Counting from 2020 rather than from the Unix epoch is what buys the
// headroom: epoch seconds cross 2^31 in 2038, seconds since 2020 not until 2088.
const ICS_SEQUENCE_EPOCH_MS = Date.UTC(2020, 0, 1);

/**
 * A SEQUENCE value that only ever increases.
 *
 * A calendar client ignores a METHOD:REQUEST whose SEQUENCE is not HIGHER than
 * the one it already holds for that UID, so this must never go backwards for
 * the life of an event. It used to be taken `% 999999`, which wrapped to zero
 * every 11.57 days — and after each wrap an invite for an event the member had
 * already seen carried a LOWER number and was discarded in silence, leaving
 * whatever their calendar held (a stale Declined, say) while the website showed
 * the new RSVP. Nothing bounces and nothing logs, so the only symptom is a
 * member saying their calendar is wrong.
 */
export function icsSequence(at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - ICS_SEQUENCE_EPOCH_MS) / 1000));
}
