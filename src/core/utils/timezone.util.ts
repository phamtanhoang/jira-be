export const TIMEZONE_HEADER = 'x-timezone';
const DEFAULT_TIMEZONE = 'UTC';

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(headerValue: string | undefined): string {
  return headerValue && isValidTimezone(headerValue)
    ? headerValue
    : DEFAULT_TIMEZONE;
}

export function convertDateToTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') === '24' ? '00' : get('hour');
  const minute = get('minute');
  const second = get('second');
  const ms = get('fractionalSecond');

  // Compute UTC offset
  const utcDate = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`,
  );
  const diffMs = utcDate.getTime() - date.getTime();
  const offsetMinutes = Math.round(diffMs / 60000);
  const absOffset = Math.abs(offsetMinutes);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetH = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetM = String(absOffset % 60).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${sign}${offsetH}:${offsetM}`;
}

export function transformDatesInResponse(
  data: unknown,
  timezone: string,
): unknown {
  if (data instanceof Date) {
    return convertDateToTimezone(data, timezone);
  }
  if (Array.isArray(data)) {
    return data.map((item) => transformDatesInResponse(item, timezone));
  }
  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = transformDatesInResponse(value, timezone);
    }
    return result;
  }
  return data;
}
