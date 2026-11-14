# OnioNet

QR-based custody tracking and monitoring system for onion cold storage facilities managed by agricultural cooperatives. The system serves many cooperatives. The first deployment is FAFOGGGA Cold Storage, Nagcuartelan, Aritao, Nueva Vizcaya.

## Stack

- MongoDB, Express, React (Vite), Node.js (MERN)
- Tailwind CSS, React Router, lucide-react icons, Recharts
- JWT auth with bcrypt
- Mobile-first: staff use phones to scan QR tags at the gate
- Deploy: Vercel (frontend + Express API as serverless functions) and MongoDB Atlas M0

## Core concept (matches the patent)

> "A system, device, and method for verifying custody of stored produce using reassignable detachable identification tags."

- Each sack gets a detachable PVC tag with a QR code and a carabiner clip.
- The QR holds ONLY the tag ID (plus a short HMAC signature). No farmer or batch data is ever stored in the QR.
- The system links: Tag ID -> Sack -> Batch -> Farmer.
- Tags are REUSABLE. A tag is bound to one sack on gate-in, unbound on gate-out, and can be reassigned to a new sack later.
- Custody is verified by scanning. No sack enters or leaves without a scan.
  - One approved exception, at gate-in only: **tagging by range**. For a run of tags in number order, staff give the first and the last tag and every tag in between is bound to a new sack. The default is to scan those two tags; typing the two numbers is a fallback. Each custody event records its method (`scan`, `range_scan`, `range_typed`) so range-tagged sacks are always distinguishable, and each range writes an audit entry. A single tag can never be typed at the gate.
- Every custody event logs a timestamp and the staff member who did it. Full history is kept per tag and per sack.

## Scope rules

- The system covers only operations INSIDE the cold storage: receiving, recording, tagging, location, monitoring, movement, release, fees, and reports.
- Curing, drying, sorting, and grading are the farmers' job before intake. Record size class and grade at intake, but do not build features for those processes.
- The system does NOT control temperature or humidity.

## Multi-cooperative (multi-tenant)

- FAFOGGGA is the first tenant, not a hardcoded setup.
- Every record (users, members, batches, sacks, tags, events, transactions, settings, audit logs) has a `cooperativeId`.
- Every query is filtered by the logged-in user's `cooperativeId`. Users must never see another cooperative's data.
- Only the Super Admin works across cooperatives.
- Layout, capacity, fees, tag code prefix, and branding are per cooperative and come from settings, never from code.

## Roles

- **Super Admin**: onboards cooperatives, manages subscriptions, sees cross-cooperative totals (no farmer details)
- **Cooperative Admin**: full control of one cooperative
- **Cooperative Staff**: gate-in, scanning, moves, gate-out, recording payments
- **Farmer/Member**: read-only access to their own sacks, batches, and fees

## FAFOGGGA seed configuration

- Tag prefix: `FAF`
- 2 floors, 4 quadrants each: 1-A, 1-B, 1-C, 1-D, 2-A, 2-B, 2-C, 2-D
- 1,250 sacks per quadrant, 10,000 total
- Fill order: 1-A, 1-B, 1-C, 1-D, 2-A, 2-B, 2-C, 2-D
- Standard contract: 3 months

## Rules

- All fee amounts come from ONE fee service. Batch detail, ledger, dashboard, and reports must always show the same numbers.
- Store money as integer centavos. Display as PHP with 2 decimals.
- Compute overdue fees when data is read, not with scheduled jobs.
- Comply with the Data Privacy Act (RA 10173): role-based access, no personal data in URLs or QR codes, audit log for all changes.
- Show names, never raw database IDs, in the UI.
- Use American English in the UI. Keep labels simple; users include farmers and non-technical staff.
- Write tests for fee computation, custody state changes, and tenant isolation.

## Style guide

Match the existing OnioNet dashboard design.

### Colors

- Primary green: `#6BA539` (active nav, positive stats, entries chart, primary buttons)
- Primary purple: `#7B2D9E` (brand, releases chart, secondary accents)
- Header banner: linear gradient from `#6BA539` to `#7B2D9E`, white text
- Accent orange: `#F28C28` (activity and trend tiles)
- Warning: `#F5A623` (70 to 90% capacity)
- Critical: `#DC2626` (over 90% capacity, overdue, damaged)
- Page background: `#F5F6F8`; cards: `#FFFFFF`
- Text: `#1F2937` primary, `#6B7280` secondary; borders: `#E5E7EB`

### Typography

- Poppins (Google Fonts): 600 for headings, 400 for body
- Page title 24px, card title 16px, stat number 24px bold, labels 12px gray

### Layout

- Fixed white left sidebar (about 220px): logo "OnioNet / Cold Storage" at top, nav items with icons, footer "© OnioNet Systems"
- Active nav item: light green background (`#EEF6E7`), green text, rounded
- Main area: page title and subtitle on the left, primary action button on the right
- Dashboard: gradient welcome banner, then a row of 4 stat cards, then content cards
- Cards: white, rounded-xl, subtle shadow, 20px padding
- Stat cards: label, big number, colored icon on the right (or tile at top left on the dashboard), optional trend text
- Mobile: sidebar collapses into a hamburger menu; scanning screens are full-width with large buttons

### Components

- Charts: green bars for entries, purple line for releases, donut for capacity
- Capacity bars: thin rounded progress bars with "used / capacity" and "available"
- Status badges: rounded pills. Available and Optimal green, Assigned purple, High amber, Critical/Overdue/Damaged red, Lost orange, Released/Retired gray
- Activity list: round tinted icon, title, detail line, relative time on the right

## Nav (Cooperative users)

Dashboard, Inventory, QR Tags, Farmers, Transactions, Reports, Audit Logs, Settings

(Farm Locations is added in a later phase.)

## Deployment

- Vite frontend and Express API deploy together on Vercel; API lives under `/api` as serverless functions
- MongoDB Atlas M0; allow network access from 0.0.0.0/0 because Vercel IPs change
- Secrets (`MONGODB_URI`, `JWT_SECRET`, `QR_HMAC_SECRET`) only in Vercel environment variables, never in code
- Cache the MongoDB connection across function calls
- Generate PDF reports and QR print sheets in the browser, not on the server
- Keep API calls fast and stateless
- HTTPS is automatic on Vercel, which phone camera scanning needs
- Vercel Hobby is for non-commercial use; move to Pro before charging subscriptions

## Project layout and commands

- The approved design (models, routes, role access, decisions) is in `docs/PROPOSAL.md`. Follow it; update it when the design changes.
- `src/` React app (Vite). `server/` Express app. `api/index.js` Vercel entry that exports the Express app. `shared/` code used by both (money helpers, status names). `tests/unit` and `tests/integration` (Vitest; integration tests run on an in-memory MongoDB replica set).
- `npm run dev` starts the API (port 3001) and Vite (port 5173, proxies `/api`). `npm test`, `npm run build`, `npm run seed` (creates the Super Admin, FAFOGGGA, its 8 quadrants, and its first Cooperative Admin from `SEED_*` in `.env`).
- Local secrets live in `.env` (gitignored); `.env.example` lists the variables. Local development should point `MONGODB_URI` at a free Atlas dev cluster, because custody changes use transactions.
- Sessions use an httpOnly cookie holding the JWT. Sign-in accepts an email or a mobile number.

## Tenant scoping (how it is enforced)

- `requireAuth` opens a per-request context (`server/context.js`). Every tenant model uses `tenantPlugin` (`server/plugins/tenant.js`), which adds `cooperativeId` and scopes every query to that context. A query with no context throws.
- Never filter by `cooperativeId` by hand and never take it from a request body. New tenant models must use `tenantPlugin` and be added to `TENANT_MODELS` in `tests/integration/tenant-isolation.test.js`.
- Cross-cooperative queries need `crossTenant()` (Super Admin, `/api/admin` only). Code with no signed-in user (login lookup, seed) uses `asSystem()` or `asCooperative()`.
- Always `await` queries inside those helpers' callbacks; the helpers await for you, so return the query from the callback.
- Request bodies go through `pick()` with a field whitelist. Changes are recorded with `recordAudit()`.
- CustodyEvent and AuditLog are append-only (`immutablePlugin`).
- Every API request re-checks that the account is still active and has the same role (`requireActiveUser`), so turning a user off or changing their role takes effect at once.
- Temporary passwords are generated by the server, shown to the admin once, and never stored or logged. Users with one must change it at first sign-in.
- Multi-step changes (tag or sack + custody event + audit entry) run inside `inTransaction()` (`server/services/tx.js`), passing `{ session }` to every query and write. On a local MongoDB without a replica set it falls back to no transaction, in development only.
- Scanned or typed tag text is always resolved with `resolveTag()` (`server/services/tags.js`). Custody actions must not pass `allowTyped`; only lookups and tag counts may.
- Phone scanning uses the shared `Scanner` component (`src/components/Scanner.jsx`). Print sheets are drawn in the browser and printed with the browser's print dialog; hide app chrome with Tailwind `print:` classes.
- Logo files are in `public/` (`logo.png`, `logo-white.png` for dark or gradient backgrounds, `favicon.png`).
- Every peso amount comes from the fee service, `server/services/fees.js` (`computeCharges`, `settle`, `loadAccounts`). Never compute fees or balances anywhere else, including the frontend; the UI only displays what the API returns.
- Money changes (payments, waivers, refunds, voids) go through `server/services/transactions.js`, which checks the balance inside a transaction and bumps `Batch.ledgerVersion` so concurrent payments cannot overpay.
