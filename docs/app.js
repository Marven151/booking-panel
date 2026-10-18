import * as core from "./core.js";
import { createApi, ApiError } from "./api.js";

const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const DAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const $ = (s) => document.querySelector(s);
const today = core.toISO(new Date());
const state = { offset: 0, start: null, end: null, busy: [] };
let api;

function monthEl(offset) {
  const base = new Date();
  const first = new Date(Date.UTC(base.getFullYear(), base.getMonth() + offset, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const el = document.createElement("div");
  el.className = "month";
  el.innerHTML = `<h2>${MONTHS[m]} ${y}</h2>`;
  const grid = document.createElement("div");
  grid.className = "grid";
  DAYS.forEach((d) => grid.insertAdjacentHTML("beforeend", `<div class="wd">${d}</div>`));
  const lead = (first.getUTCDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.insertAdjacentHTML("beforeend", '<button class="day blank" disabled tabindex="-1" aria-hidden="true"></button>');
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let d = 1; d <= count; d++) {
    const iso = core.toISO(new Date(Date.UTC(y, m, d)));
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = d;
    b.className = "day";
    const past = iso < today;
    const busy = state.busy.some((r) => iso >= r.start && iso < r.end);
    b.classList.add(busy ? "busy" : "free");
    if (past) b.classList.add("past");
    b.disabled = past || busy;
    if (state.start === iso || state.end === iso) b.classList.add("sel");
    else if (state.start && state.end && iso > state.start && iso < state.end) b.classList.add("range");
    b.setAttribute("aria-label", `${d} ${MONTHS[m]} ${y}${busy ? ", zajęte" : past ? ", minione" : ", wolne"}`);
    b.addEventListener("click", () => pick(iso));
    grid.appendChild(b);
  }
  el.appendChild(grid);
  return el;
}

function render() {
  const wrap = $("#months");
  wrap.replaceChildren(monthEl(state.offset), monthEl(state.offset + 1));
  renderSummary();
}

function pick(iso) {
  clearErrors();
  if (!state.start || state.end || iso <= state.start) {
    state.start = iso;
    state.end = null;
  } else if (!core.isFree(state.start, iso, state.busy)) {
    setError("dates", "W tym zakresie są zajęte dni. Wybierz inny.");
    return;
  } else {
    state.end = iso;
  }
  render();
}

function renderSummary() {
  const box = $("#summary");
  if (state.start && state.end) {
    const p = core.priceFor(state.start, state.end);
    const lines = p.lines.map((l) => `${l.nights} × ${core.formatPLN(l.rate)}`).join(" + ");
    box.innerHTML = `<p class="dates">${core.formatDatePL(state.start)} → ${core.formatDatePL(state.end)}</p><p class="big">${core.formatPLN(p.total)}</p><small>${p.nights} ${p.nights === 1 ? "noc" : p.nights < 5 ? "noce" : "nocy"}: ${lines}</small>`;
  } else if (state.start) {
    box.innerHTML = `<p class="dates">Przyjazd ${core.formatDatePL(state.start)}. Wybierz datę wyjazdu.</p>`;
  } else {
    box.innerHTML = '<p class="dates">Wybierz datę przyjazdu, potem wyjazdu.</p>';
  }
}

function setError(name, text) {
  const e = document.querySelector(`.err[data-for="${name}"]`);
  if (e) e.textContent = text;
}
function clearErrors() {
  document.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
}

async function submit(ev) {
  ev.preventDefault();
  clearErrors();
  const f = new FormData(ev.target);
  const data = { start: state.start, end: state.end, name: f.get("name"), email: f.get("email"), phone: f.get("phone"), guests: f.get("guests"), message: f.get("message") };
  const btn = $("#submit");
  btn.disabled = true;
  try {
    const r = await api.createRequest(data);
    $("#form").hidden = true;
    $("#summary").hidden = true;
    const ok = $("#ok");
    ok.hidden = false;
    ok.innerHTML = `<b>zapytanie wysłane</b><p>Numer ${r.id}. Kwota za pobyt: ${core.formatPLN(r.total)}. Właściciel odpowie e-mailem po sprawdzeniu terminu.</p>`;
    state.busy = await api.busy();
    state.start = state.end = null;
    render();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const entries = Object.entries(e.errors ?? {});
    if (entries.length) entries.forEach(([k, v]) => setError(k, v));
    else setError("dates", e.message);
    if (e.status === 409) {
      state.busy = await api.busy();
      state.start = state.end = null;
      render();
    }
    document.querySelector(".err:not(:empty)")?.scrollIntoView({ block: "center", behavior: "smooth" });
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  const sel = document.querySelector('select[name="guests"]');
  for (let i = 1; i <= core.MAX_GUESTS; i++) sel.insertAdjacentHTML("beforeend", `<option value="${i}">${i}</option>`);
  api = await createApi();
  if (api.mode === "demo") {
    const b = $("#banner");
    b.hidden = false;
    b.innerHTML = 'Tryb demo: dane zapisują się tylko w tej przeglądarce, nic nie jest wysyłane na serwer. Panel właściciela: <a href="admin.html">admin.html</a>, hasło <b>demo</b>.';
  }
  state.busy = await api.busy();
  $("#prev").addEventListener("click", () => { state.offset = Math.max(0, state.offset - 2); render(); });
  $("#next").addEventListener("click", () => { state.offset = Math.min(22, state.offset + 2); render(); });
  $("#form").addEventListener("submit", submit);
  render();
}

init();
