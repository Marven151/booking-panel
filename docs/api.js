import * as core from "./core.js";

const KEY = "booking-panel-demo-v1";
const TOKEN = "booking-panel-token";

class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors ?? {};
  }
}

function serverApi() {
  async function call(method, path, body, auth) {
    const headers = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = `Bearer ${sessionStorage.getItem(TOKEN) ?? ""}`;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? "Błąd", data.errors);
    return data;
  }
  return {
    mode: "server",
    busy: async () => (await call("GET", "api/busy")).busy,
    createRequest: (r) => call("POST", "api/requests", r),
    async login(password) {
      const { token } = await call("POST", "api/admin/login", { password });
      sessionStorage.setItem(TOKEN, token);
    },
    loggedIn: () => Boolean(sessionStorage.getItem(TOKEN)),
    logout: () => sessionStorage.removeItem(TOKEN),
    listRequests: async () => (await call("GET", "api/admin/requests", null, true)).requests,
    setStatus: (id, status) => call("POST", `api/admin/requests/${id}/status`, { status }, true),
    listBlocks: async () => (await call("GET", "api/admin/blocks", null, true)).blocks,
    addBlock: (b) => call("POST", "api/admin/blocks", b, true),
    removeBlock: (id) => call("DELETE", `api/admin/blocks/${id}`, null, true),
  };
}

function seed() {
  const t = core.toISO(new Date());
  const d = (n) => core.addDays(t, n);
  const mk = (id, a, b, name, guests, status, message = "") => {
    const p = core.priceFor(d(a), d(b));
    return { id, created_at: new Date().toISOString(), start: d(a), end: d(b), name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: "", guests, message, total: p.total, status };
  };
  return {
    nextId: 6,
    nextBlock: 2,
    requests: [
      mk(1, 9, 14, "Katarzyna Wiśniewska", 4, "confirmed"),
      mk(2, 38, 45, "Piotr Zieliński", 6, "confirmed"),
      mk(3, 16, 19, "Anna Kowalczyk", 2, "new", "Czy możemy przyjechać z psem?"),
      mk(4, 50, 54, "Tomasz Lewandowski", 5, "new"),
      mk(5, 24, 26, "Marta Dąbrowska", 3, "declined"),
    ],
    blocks: [{ id: 1, start: d(22), end: d(24), note: "przegląd techniczny" }],
  };
}

function localApi() {
  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw?.requests) return raw;
    } catch {}
    const fresh = seed();
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const busyOf = (s, skip) => [
    ...s.requests.filter((r) => r.status === "confirmed" && r.id !== skip),
    ...s.blocks,
  ].map((r) => ({ start: r.start, end: r.end }));
  const today = () => core.toISO(new Date());

  return {
    mode: "demo",
    reset: () => localStorage.removeItem(KEY),
    busy: async () => busyOf(load()),
    async createRequest(r) {
      const v = core.validateRequest(r, today());
      if (!v.ok) throw new ApiError(422, "Popraw zaznaczone pola.", v.errors);
      const s = load();
      if (!core.isFree(v.clean.start, v.clean.end, busyOf(s))) throw new ApiError(409, "Ten termin jest już zajęty.", { dates: "Ten termin jest już zajęty." });
      const total = core.priceFor(v.clean.start, v.clean.end).total;
      const id = s.nextId++;
      s.requests.push({ id, created_at: new Date().toISOString(), ...v.clean, total, status: "new" });
      save(s);
      return { id, total };
    },
    async login(password) {
      if (password !== "demo") throw new ApiError(401, "Złe hasło. W trybie demo hasło to: demo");
      sessionStorage.setItem(TOKEN, "demo");
    },
    loggedIn: () => sessionStorage.getItem(TOKEN) === "demo",
    logout: () => sessionStorage.removeItem(TOKEN),
    listRequests: async () => [...load().requests].sort((a, b) => b.id - a.id),
    async setStatus(id, status) {
      const s = load();
      const row = s.requests.find((r) => r.id === id);
      if (!row) throw new ApiError(404, "Nie ma takiego zapytania.");
      if (status === "confirmed" && !core.isFree(row.start, row.end, busyOf(s, id))) {
        throw new ApiError(409, "Termin koliduje z inną rezerwacją lub blokadą.");
      }
      row.status = status;
      save(s);
      return { request: row };
    },
    listBlocks: async () => [...load().blocks].sort((a, b) => (a.start < b.start ? -1 : 1)),
    async addBlock(b) {
      if (!core.parseISO(b.start) || !core.parseISO(b.end) || b.end <= b.start) throw new ApiError(422, "Podaj poprawny zakres dat.");
      const s = load();
      s.blocks.push({ id: s.nextBlock++, start: b.start, end: b.end, note: String(b.note ?? "").slice(0, 80) });
      save(s);
      return { ok: true };
    },
    async removeBlock(id) {
      const s = load();
      s.blocks = s.blocks.filter((b) => b.id !== id);
      save(s);
      return { ok: true };
    },
  };
}

export async function createApi() {
  const staticHost = location.protocol === "file:" || location.hostname.endsWith("github.io") || new URLSearchParams(location.search).has("demo");
  if (!staticHost) {
    try {
      const res = await fetch("api/health", { cache: "no-store" });
      if (res.ok && (await res.json()).ok) return serverApi();
    } catch {}
  }
  return localApi();
}

export { ApiError };
