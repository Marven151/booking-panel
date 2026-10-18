export const MAX_GUESTS = 6;
export const MAX_NIGHTS = 30;
export const SEASON_MONTHS = [6, 7, 8];
export const RATES = { season: 1100, off: 900 };

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const ok = d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  return ok ? d : null;
}

export function toISO(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function nights(start, end) {
  return Math.round((parseISO(end) - parseISO(start)) / 86400000);
}

export function nightDates(start, end) {
  return Array.from({ length: nights(start, end) }, (_, i) => addDays(start, i));
}

export function rateFor(dateISO) {
  const month = parseISO(dateISO).getUTCMonth() + 1;
  return SEASON_MONTHS.includes(month) ? RATES.season : RATES.off;
}

export function priceFor(start, end) {
  const rows = { season: { nights: 0, rate: RATES.season }, off: { nights: 0, rate: RATES.off } };
  for (const d of nightDates(start, end)) {
    rows[rateFor(d) === RATES.season ? "season" : "off"].nights += 1;
  }
  const lines = Object.entries(rows)
    .filter(([, r]) => r.nights > 0)
    .map(([key, r]) => ({ key, nights: r.nights, rate: r.rate, sum: r.nights * r.rate }));
  return { nights: nights(start, end), total: lines.reduce((a, l) => a + l.sum, 0), lines };
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function isFree(start, end, busy) {
  return !busy.some((b) => overlaps(start, end, b.start, b.end));
}

export function validateRequest(r, today) {
  const errors = {};
  const name = String(r.name ?? "").trim();
  const mail = String(r.email ?? "").trim();
  const phone = String(r.phone ?? "").trim();
  const message = String(r.message ?? "").trim();
  const guests = Number(r.guests);
  if (name.length < 2 || name.length > 80) errors.name = "Podaj imię i nazwisko.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 120) errors.email = "Podaj poprawny adres e-mail.";
  if (phone && !/^[0-9+() -]{6,30}$/.test(phone)) errors.phone = "Podaj poprawny numer telefonu.";
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) errors.guests = `Liczba osób: od 1 do ${MAX_GUESTS}.`;
  if (message.length > 500) errors.message = "Wiadomość może mieć do 500 znaków.";
  const s = parseISO(r.start);
  const e = parseISO(r.end);
  if (!s || !e) errors.dates = "Wybierz datę przyjazdu i wyjazdu.";
  else if (r.start < today) errors.dates = "Data przyjazdu jest w przeszłości.";
  else if (r.end <= r.start) errors.dates = "Wyjazd musi być po przyjeździe.";
  else if (nights(r.start, r.end) > MAX_NIGHTS) errors.dates = `Maksymalny pobyt to ${MAX_NIGHTS} nocy.`;
  const clean = { start: r.start, end: r.end, name, email: mail, phone, guests, message };
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

export function formatPLN(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " zł";
}

export function formatDatePL(s) {
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}
