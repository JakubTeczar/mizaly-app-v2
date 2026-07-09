// Local-time date helpers (avoid UTC shift from toISOString()).

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DOW_LABELS = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"];
const MONTH_LABELS = [
  "sty",
  "lut",
  "mar",
  "kwi",
  "maj",
  "cze",
  "lip",
  "sie",
  "wrz",
  "paź",
  "lis",
  "gru",
];

export function dowLabel(date: Date): string {
  return DOW_LABELS[date.getDay()];
}

function atMidnight(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}

// Polish weeks start on Monday. getDay() is 0 (Sun) .. 6 (Sat), so Monday
// needs a 6-day rollback instead of the usual 1-day one when it lands on Sunday.
export function startOfWeek(date: Date): Date {
  const midnight = atMidnight(date);
  const dayOfWeek = midnight.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  midnight.setDate(midnight.getDate() + diffToMonday);
  return midnight;
}

export function addWeeks(date: Date, weeks: number): Date {
  const copy = atMidnight(date);
  copy.setDate(copy.getDate() + weeks * 7);
  return copy;
}

export function buildWeek(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + offset);
    days.push(d);
  }
  return days;
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const startLabel = `${weekStart.getDate()} ${MONTH_LABELS[weekStart.getMonth()]}`;
  const endLabel = `${weekEnd.getDate()} ${MONTH_LABELS[weekEnd.getMonth()]}`;
  return `${startLabel} - ${endLabel}`;
}
