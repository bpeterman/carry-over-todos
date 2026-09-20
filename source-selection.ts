export interface DatedCandidate {
  /** Moment-style day number: Sunday is 0 and Saturday is 6. */
  day: number;
}

export function isWeekday(day: number): boolean {
  return day >= 1 && day <= 5;
}

/**
 * Candidates must be ordered from newest to oldest.
 *
 * A weekday run always considers the newest note. If that note is from the
 * weekend, it also considers the newest weekday note so Monday does not lose
 * track of Friday's unfinished work. Weekend runs intentionally stay focused
 * on only the newest note.
 */
export function selectCarryOverSources<T extends DatedCandidate>(
  todayDay: number,
  candidates: T[],
): T[] {
  const newest = candidates[0];
  if (!newest) return [];

  const sources = [newest];

  if (isWeekday(todayDay) && !isWeekday(newest.day)) {
    const latestWeekday = candidates.find((candidate) => isWeekday(candidate.day));
    if (latestWeekday) sources.push(latestWeekday);
  }

  return sources;
}
