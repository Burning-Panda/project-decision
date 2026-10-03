export function makeClock(start = '2024-03-20T10:00:00Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    advanceMinutes: (m: number) => { t += m * 60_000; },
    advanceHours: (h: number) => { t += h * 3_600_000; },
    advanceDays: (d: number) => { t += d * 86_400_000; },
  };
}
