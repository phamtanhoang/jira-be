/**
 * Time-unit constants in milliseconds (or seconds where the consumer wants
 * seconds — e.g. cookie / Cache-Control headers). Use these instead of
 * recomputing `24 * 60 * 60 * 1000` at every call site.
 *
 * Convention: any constant ending in `_MS` is milliseconds; `_SEC` is
 * seconds; bare numbers (e.g. `GRACE_PERIOD_DAYS`) are unitless counts.
 */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

export const MINUTE_SEC = 60;
export const HOUR_SEC = 60 * MINUTE_SEC;
export const DAY_SEC = 24 * HOUR_SEC;
export const WEEK_SEC = 7 * DAY_SEC;

/**
 * Account self-deletion grace window. After a user requests deletion the
 * row stays for this many days; the GDPR cron hard-deletes after the cutoff.
 * User can cancel any time before then.
 */
export const GRACE_PERIOD_DAYS = 30;
export const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * DAY_MS;
