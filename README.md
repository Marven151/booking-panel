# booking-panel

[![tests](https://github.com/Marven151/booking-panel/actions/workflows/test.yml/badge.svg)](https://github.com/Marven151/booking-panel/actions/workflows/test.yml)

Booking requests for a small holiday apartment. A guest picks dates on a calendar, sees the price and sends a request. The owner logs in to a panel, confirms or declines requests and blocks dates. Confirmed stays and blocks disappear from the guest calendar.

**Live demo:** https://marven151.github.io/booking-panel/ (owner panel: `admin.html`, password `demo`)

The live demo runs entirely in the browser: data is kept in `localStorage`, so every visitor has their own copy and nothing is sent anywhere. The same front end talks to a real backend when it is served by `server.js`.

## What is in here

- `server.js`: HTTP server on Node's built-in `http` and `node:sqlite`, no dependencies. Validates every request on the server, refuses overlapping stays, limits request and login rates, compares the password in constant time and serves the front end.
- `docs/core.js`: the shared rules (price per night, season, overlap, validation). The server and the browser demo use the same file, so they cannot disagree.
- `docs/api.js`: one interface with two backends: the real server, or `localStorage` for the demo.
- `docs/index.html`, `docs/admin.html`: guest page and owner panel.
- `test/`: 19 tests for the rules and the API, including malformed input, markup in e-mail addresses, oversized bodies and overlapping blocks.

## Run it

Needs Node 22.5 or newer.

```bash
ADMIN_PASSWORD='choose-one' npm start
```

Open http://localhost:3000. The owner panel is at `/admin.html`. The server refuses to start without `ADMIN_PASSWORD` (at least 6 characters). Behind a reverse proxy set `TRUST_PROXY=1` so rate limits use the visitor's address.

```bash
npm test
```

## API

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/busy` | anyone | confirmed stays and blocks |
| POST | `/api/requests` | anyone | send a request (validated, rate limited, 409 when the dates are taken) |
| POST | `/api/admin/login` | owner | returns a token valid for 8 hours |
| GET | `/api/admin/requests` | owner | all requests |
| POST | `/api/admin/requests/:id/status` | owner | `confirmed` or `declined`; confirming re-checks for conflicts |
| GET/POST/DELETE | `/api/admin/blocks` | owner | block and unblock dates |

## Prices

June to August 1 100 zł per night, the rest of the year 900 zł, up to 6 guests. Change them in `docs/core.js`.

## Limits

A demo, not a product: no payments, no e-mails sent by the server (the panel offers a ready mail draft), one apartment, one owner, tokens kept in memory.
