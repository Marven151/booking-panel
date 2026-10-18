import * as core from "./core.js";
import { createApi, ApiError } from "./api.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let api;
let tab = "new";
let data = { requests: [], blocks: [] };

const LABEL = { new: "nowe", confirmed: "potwierdzone", declined: "odrzucone" };

function mailDraft(r) {
  const subject = r.status === "confirmed" ? "Potwierdzenie rezerwacji" : "Odpowiedź na zapytanie o termin";
  const body = r.status === "confirmed"
    ? `Dzień dobry,\n\npotwierdzam rezerwację w terminie ${core.formatDatePL(r.start)} – ${core.formatDatePL(r.end)} (${core.nights(r.start, r.end)} nocy, ${core.formatPLN(r.total)}).\n\nPozdrawiam`
    : `Dzień dobry,\n\nniestety termin ${core.formatDatePL(r.start)} – ${core.formatDatePL(r.end)} jest niedostępny. Chętnie zaproponuję inny.\n\nPozdrawiam`;
  return `mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderStats() {
  const c = (s) => data.requests.filter((r) => r.status === s).length;
  const income = data.requests.filter((r) => r.status === "confirmed").reduce((a, r) => a + r.total, 0);
  $("#stats").innerHTML = `<div class="stat"><b>${c("new")}</b>nowe zapytania</div><div class="stat"><b>${c("confirmed")}</b>potwierdzone</div><div class="stat"><b>${core.formatPLN(income)}</b>wartość potwierdzonych</div>`;
}

function requestCard(r) {
  const n = core.nights(r.start, r.end);
  const acts = [];
  if (r.status === "new") {
    acts.push(`<button class="btn sm" data-act="confirmed" data-id="${r.id}">Potwierdź</button>`);
    acts.push(`<button class="btn sm danger" data-act="declined" data-id="${r.id}">Odrzuć</button>`);
  }
  if (r.status === "confirmed") acts.push(`<button class="btn sm danger" data-act="declined" data-id="${r.id}">Anuluj</button>`);
  if (r.status !== "new") acts.push(`<a class="btn sm ghost" href="${mailDraft(r)}">Szkic maila</a>`);
  return `<article class="req"><div><h3>${esc(r.name)}<span class="tag ${r.status}">${LABEL[r.status]}</span></h3>
    <p class="meta">${core.formatDatePL(r.start)} → ${core.formatDatePL(r.end)}, ${n} ${n === 1 ? "noc" : "nocy"}, ${r.guests} os., ${core.formatPLN(r.total)}</p>
    <p class="meta">${esc(r.email)}${r.phone ? ", " + esc(r.phone) : ""}</p>
    ${r.message ? `<p class="msg">${esc(r.message)}</p>` : ""}</div><div class="acts">${acts.join("")}</div></article>`;
}

function renderList() {
  const box = $("#list");
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  if (tab === "blocks") {
    const rows = data.blocks.map((b) => `<article class="req"><div><h3>${core.formatDatePL(b.start)} → ${core.formatDatePL(b.end)}</h3><p class="meta">${esc(b.note || "bez opisu")}</p></div><div class="acts"><button class="btn sm danger" data-del="${b.id}">Usuń</button></div></article>`).join("");
    box.innerHTML = `<form class="blockform" id="blockForm"><label>Od<input type="date" name="start" required></label><label>Do<input type="date" name="end" required></label><label>Opis<input name="note" maxlength="80"></label><button class="btn sm" type="submit">Zablokuj</button></form><span class="err" id="blockErr"></span>${rows || '<p class="empty">Brak blokad.</p>'}`;
    return;
  }
  const rows = data.requests.filter((r) => r.status === tab).map(requestCard).join("");
  box.innerHTML = rows || '<p class="empty">Nic tu nie ma.</p>';
}

async function refresh() {
  try {
    [data.requests, data.blocks] = await Promise.all([api.listRequests(), api.listBlocks()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return showLogin();
    throw e;
  }
  renderStats();
  renderList();
}

function showLogin() {
  api.logout();
  $("#login").hidden = false;
  $("#app").hidden = true;
}

async function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#reset").hidden = api.mode !== "demo";
  await refresh();
}

async function init() {
  api = await createApi();
  if (api.mode === "demo") {
    const b = $("#banner");
    b.hidden = false;
    b.innerHTML = "Tryb demo: dane zapisują się tylko w tej przeglądarce. Hasło do panelu: <b>demo</b>.";
  }
  $("#login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#loginErr").textContent = "";
    try {
      await api.login(new FormData(ev.target).get("password"));
      showApp();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      $("#loginErr").textContent = e.message;
    }
  });
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; renderList(); }));
  $("#list").addEventListener("click", async (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    try {
      if (t.dataset.act) await api.setStatus(Number(t.dataset.id), t.dataset.act);
      else if (t.dataset.del) await api.removeBlock(Number(t.dataset.del));
      else return;
      await refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      alert(e.message);
    }
  });
  $("#list").addEventListener("submit", async (ev) => {
    if (ev.target.id !== "blockForm") return;
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      await api.addBlock({ start: f.get("start"), end: f.get("end"), note: f.get("note") });
      await refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      $("#blockErr").textContent = e.message;
    }
  });
  $("#logout").addEventListener("click", showLogin);
  $("#reset").addEventListener("click", () => { api.reset(); refresh(); });
  api.loggedIn() ? showApp() : showLogin();
}

init();
