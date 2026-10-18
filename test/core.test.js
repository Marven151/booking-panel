import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../docs/core.js";

test("nights counts the days between check-in and check-out", () => {
  assert.equal(core.nights("2027-07-01", "2027-07-04"), 3);
  assert.equal(core.nights("2027-02-27", "2027-03-02"), 3);
});

test("priceFor uses the season rate in June to August and the off-season rate otherwise", () => {
  assert.deepEqual(core.priceFor("2027-07-10", "2027-07-13"), { nights: 3, total: 3300, lines: [{ key: "season", nights: 3, rate: 1100, sum: 3300 }] });
  assert.equal(core.priceFor("2027-10-10", "2027-10-12").total, 1800);
});

test("priceFor splits a stay that crosses the season boundary", () => {
  const p = core.priceFor("2027-05-30", "2027-06-02");
  assert.equal(p.nights, 3);
  assert.equal(p.total, 900 * 2 + 1100);
  assert.equal(p.lines.length, 2);
});

test("overlaps treats the check-out day as free", () => {
  assert.equal(core.overlaps("2027-07-01", "2027-07-05", "2027-07-05", "2027-07-08"), false);
  assert.equal(core.overlaps("2027-07-01", "2027-07-05", "2027-07-04", "2027-07-08"), true);
});

test("isFree checks a stay against every busy range", () => {
  const busy = [{ start: "2027-07-10", end: "2027-07-14" }, { start: "2027-08-01", end: "2027-08-03" }];
  assert.equal(core.isFree("2027-07-14", "2027-07-18", busy), true);
  assert.equal(core.isFree("2027-07-12", "2027-07-16", busy), false);
});

test("parseISO rejects impossible dates", () => {
  assert.equal(core.parseISO("2027-02-30"), null);
  assert.equal(core.parseISO("2027-13-01"), null);
  assert.equal(core.parseISO("tomorrow"), null);
});

test("validateRequest accepts a correct request and normalises it", () => {
  const v = core.validateRequest({ start: "2027-07-10", end: "2027-07-13", name: "  Anna Nowak ", email: "anna@example.com", guests: "4" }, "2027-01-01");
  assert.equal(v.ok, true);
  assert.equal(v.clean.name, "Anna Nowak");
  assert.equal(v.clean.guests, 4);
});

test("validateRequest reports every problem", () => {
  const v = core.validateRequest({ start: "2020-01-01", end: "2019-01-01", name: "A", email: "x", guests: 9 }, "2027-01-01");
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys(v.errors).sort(), ["dates", "email", "guests", "name"]);
});

test("validateRequest limits the stay to 30 nights", () => {
  const v = core.validateRequest({ start: "2027-07-01", end: "2027-08-15", name: "Anna", email: "a@b.pl", guests: 2 }, "2027-01-01");
  assert.ok(v.errors.dates);
});
