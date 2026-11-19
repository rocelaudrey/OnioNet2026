# OnioNet design proposal

Status: **approved**, with the changes recorded in section 1. This is the design the code follows.

Contents: [decisions](#1-decisions) · [multi-tenancy](#2-multi-tenancy) · [folder structure](#3-folder-structure) · [data models](#4-data-models) · [API routes](#5-api-routes) · [role access](#6-role-access) · [changes to the current scaffold](#7-changes-to-the-current-scaffold)

---

## 1. Decisions

Settled with you:

| # | Decision |
|---|---|
| 1 | **Fees** are set by each cooperative in Settings > Fees. Two fees are built in and cannot be removed: the **storage fee** and the **overdue fee** (per sack per day for sacks still stored after the contract end; the amount can be 0). The admin can add other fees and set a **member discount (%)**. |
| 2 | Each batch keeps a copy of the fees and discount in force on its intake date. Later setting changes affect only new batches. |
| 3 | Partial release is allowed. Gate-out is per sack; the batch is "Partly Released" until its last sack leaves. |
| 4 | Farmers sign in with mobile number or email plus a password. Staff create the account with a temporary password the farmer must change. |
| 5 | Multi-step custody changes use MongoDB transactions. Local development uses a free Atlas dev cluster, the same kind of database as production. Tests use an in-memory MongoDB replica set. |
| 6 | Farmer search text goes in the request body, never in the address. |
| 7 | **Tagging by range at gate-in** is allowed for staff and admins: scan the first and last tag (default) or type the two numbers (fallback). All-or-nothing, up to 1,000 tags, and every sack's custody event records that it was tagged by range. |

Assumptions I made while adding your later changes. Tell me if any is wrong; none of them blocks the scaffold step.

| # | Assumption |
|---|---|
| A | **Member discount** reduces the storage fee and any added fees for batches whose owner is a member. It does not reduce the overdue fee, and guests never get it. |
| B | **Coop-owned stock** is charged no fees. Its batches have no member and an empty fee list. |
| C | A batch's `ownerType` is taken from the farmer's tier at intake (member or guest) and does not change if the farmer's tier changes later. |
| D | **Available capacity** at intake = total capacity of active quadrants − sacks in storage − sacks still expected from other batches that are being received. |
| E | **Pre-printed tags** must use the OnioNet code format (prefix, 6-digit serial, check character). If their QR has no OnioNet signature, the tag is recorded as unsigned and only its registered code is accepted when scanned. Tags printed from OnioNet are always signed. |
| F | A **release slip** covers all sacks scanned out in one visit. The phone groups them under one release number. |
| G | `enabledFeatures` starts with these switches: `farmer_portal`, `tag_reconciliation`, `tag_import`, `pdf_reports`. |

---

## 2. Multi-tenancy

**Rule:** every record carries `cooperativeId`, and no query can run without it.

How it is enforced, in three layers:

1. **Request context.** After the JWT is checked, the auth middleware stores `{ userId, role, cooperativeId, memberId }` in a per-request context (Node `AsyncLocalStorage`).
2. **Tenant plugin on every model.** A shared Mongoose plugin adds a required, indexed `cooperativeId` field and hooks every read, update, delete, count, and aggregate. The hook adds `cooperativeId` from the request context to the filter. On create it stamps `cooperativeId` and rejects any attempt to set a different one. `cooperativeId` cannot be changed after creation.
3. **Fail closed.** If a tenant model is queried with no context (a forgotten middleware, a script), the query throws instead of returning everything.

Super Admin is the only exception. Cross-cooperative queries must be wrapped in an explicit `crossTenant(() => ...)` call, which is allowed only inside `/api/admin` routes and only returns totals, never farmer details.

Farmers get a second automatic filter: on `/api/me/*` routes every query is also limited to their own `memberId`, taken from the session and never from the request.

**Isolation test (part of the scaffold step).** Two cooperatives are seeded with a user and data each. Using real HTTP requests against the API, the test proves that a user from cooperative A:

- gets an empty list or "not found" when listing or reading B's members, batches, sacks, tags, and transactions
- cannot update or delete B's records by ID
- cannot create a record with B's `cooperativeId` in the request body
- and that a query with no tenant context throws

---

## 3. Folder structure

One package at the project root, so Vercel builds the frontend and serves the API from the same deployment.

```
api/
  index.js                 Vercel entry; exports the Express app (exists)
server/
  app.js                   Express setup and route mounting (exists)
  dev.js                   local dev server (exists)
  config.js                env variables (exists)
  db.js                    cached MongoDB connection (exists)
  context.js               per-request context (AsyncLocalStorage)
  seed.js                  FAFOGGGA seed (exists; to be updated)
  plugins/
    tenant.js              cooperativeId field + automatic query scoping
    immutable.js           blocks update/delete on CustodyEvent and AuditLog
  models/                  one file per model (section 4)
  middleware/
    auth.js                requireAuth, requireRole (exists)
    validate.js            request body validation
    errors.js              error handler
  services/
    fees.js                THE fee service; the only place amounts are computed
    custody.js             gate-in, move, gate-out, tag replacement (transactions)
    audit.js               writes audit log entries
    sequences.js           batch, receipt, member, and tag numbering
    capacity.js            quadrant occupancy and fill-order suggestion
  routes/                  one file per route group (section 5)
  lib/
    qr.js                  QR payload sign/verify (exists)
    roles.js               role names and labels (exists)
shared/
  money.js                 centavo helpers (exists)
  statuses.js              status names and labels used by both sides
src/
  main.jsx, App.jsx        (exist)
  lib/                     api client, auth context, nav (exist)
  components/              Layout, Card, StatCard, PageHeader (exist),
                           StatusBadge, CapacityBar, ActivityList, DataTable, Modal
  pages/
    Login, Dashboard       (exist)
    inventory/             batch list, batch detail, sack detail
    scan/                  full-width phone screens: gate-in, move, gate-out
    tags/                  tag list, tag history, tag lots, print sheet
    farmers/               member list, member detail
    transactions/          ledger, record payment
    reports/               report views + in-browser PDF
    audit/                 audit log
    settings/              profile, layout, fees, users
    portal/                farmer's read-only view
    admin/                 Super Admin: cooperatives, subscriptions, totals
tests/
  unit/                    money, qr, fees
  integration/             tenant isolation, custody state changes, auth and roles
```

---

## 4. Data models

Conventions for every model:

- `cooperativeId` (required, indexed, unchangeable) comes from the tenant plugin. It is not repeated in the tables below.
- `createdAt` / `updatedAt` timestamps on everything.
- Money fields end in `Centavos` and are integers.
- Records with history are never hard-deleted; they are marked inactive, retired, or voided.

### Cooperative

The tenant itself. Its `_id` is the `cooperativeId` used everywhere else. Only the Super Admin can create one.

| Field | Notes |
|---|---|
| `name`, `facilityName`, `address` | profile |
| `contact` | `{ personName, phone, email }` |
| `branding` | `{ displayName, logoUrl }` |
| `status` | `active`, `suspended` |
| `settings.tagPrefix` | e.g. `FAF`; unique across all cooperatives |
| `settings.contractMonths` | default 3 |
| `settings.fees` | the cooperative's fee list, edited in Settings > Fees (see below) |
| `settings.sizeClasses`, `settings.grades` | lists offered at intake |
| `subscription` | `{ plan, status: 'trial' \| 'active' \| 'past_due' \| 'canceled', startedAt, endsAt, capacityLimit, enabledFeatures, notes }` |

`capacityLimit` is the most sacks the plan allows. Saving a layout whose active quadrants add up to more than this is blocked. `enabledFeatures` is a list of feature switches; routes for a feature that is off return "not available on your plan".

Layout lives in Quadrant, not here.

#### Fee list (Settings > Fees)

`settings.fees` holds three things:

**1. Two built-in fees.** Always present, editable, cannot be removed.

| Fee | Charged | Notes |
|---|---|---|
| `storageFeeCentavos` | once per sack for the contract period | |
| `overdueFeePerDayCentavos` | per sack per day, for sacks still stored after the contract end | can be 0 |

**2. Added fees.** A list the Cooperative Admin can add to.

| Field | Notes |
|---|---|
| `name` | shown on ledgers and receipts, e.g. "Handling Fee" |
| `amountCentavos` | integer |
| `chargedPer` | `sack` (once per sack), `batch` (once per delivery), `sack_per_month` (every month a sack is in storage) |
| `appliesTo` | `every_batch` (added automatically at intake) or `optional` (staff tick it at intake when it applies) |
| `active` | turning a fee off stops it for new batches without erasing history |

**3. Member discount.** `memberDiscountPercent` (0 to 100). Applied to batches owned by a member, never to guests (assumption A).

Rules:

- Only the Cooperative Admin can change fees or the discount. Staff can view them. Every change is written to the audit log with the old and new value.
- A new cooperative starts with both built-in fees at ₱0.00 and no discount. Intake shows a reminder until the storage fee is set.
- The fee service is still the only place amounts are computed. It reads the fees copied onto the batch, the batch's sacks, and today's date.
- One-off amounts that are not a standing fee (a waiver, a one-time discount) stay as `adjustment` transactions.

### Quadrant

One storage area. FAFOGGGA has eight.

| Field | Notes |
|---|---|
| `code` | e.g. `1-A`; unique per cooperative |
| `floor` | 1, 2 |
| `capacity` | sacks, e.g. 1250 |
| `fillOrder` | 1 to 8; drives the suggested location at gate-in |
| `active` | false hides it from new intake |

Occupancy is counted from sacks when read, not stored, so it can never drift.

### User

Someone who can sign in.

| Field | Notes |
|---|---|
| `cooperativeId` | null only for Super Admin |
| `name`, `email`, `phone` | email and phone are each unique when present |
| `passwordHash` | bcrypt; never returned by the API |
| `role` | `super_admin`, `coop_admin`, `coop_staff`, `member` |
| `memberId` | set only for the `member` role; links to their Member record |
| `active`, `mustChangePassword`, `lastLoginAt` | |

### Member

A farmer who stores onions. Has a User only if they have portal access.

| Field | Notes |
|---|---|
| `memberNo` | per-cooperative number, e.g. `FAF-M-0042` |
| `tier` | `member` or `guest`; required. Guests can store onions but get no member discount |
| `firstName`, `lastName` | |
| `phone`, `address` | `{ barangay, municipality, province }` |
| `status` | `active`, `inactive` |
| `birthDate`, `farmAreaHa`, `rsbsaNo` | optional |
| `joinedAt`, `notes` | |

Only what the cooperative needs is collected (Data Privacy Act). Farm Locations will attach here in the later phase.

### Batch

One delivery from one farmer, received at the gate.

| Field | Notes |
|---|---|
| `batchNo` | per cooperative, e.g. `FAF-B-2026-0001` |
| `ownerType` | `member`, `guest`, or `coop_owned` |
| `memberId` | the farmer; empty for coop-owned stock |
| `receivedAt`, `receivedBy` | |
| `variety`, `sizeClass`, `grade` | recorded at intake only |
| `declaredSackCount` | what the farmer says was delivered |
| `totalWeightKg` | optional |
| `contractStart`, `contractEnd` | end = start + contract months at intake |
| `feeTerms` | copy taken at intake: both built-in fees, every `every_batch` added fee, any `optional` fees staff ticked, and the member discount if the owner is a member (decision 2) |
| `status` | `receiving`, `stored`, `partly_released`, `released` |
| `notes` | |

Fees and balance are not stored. They are computed by the fee service every time the batch is read.

### Sack

One physical sack. Created at gate-in when a tag is scanned onto it.

| Field | Notes |
|---|---|
| `batchId`, `memberId` | memberId is copied from the batch for fast farmer queries |
| `sackNo` | sequence within the batch |
| `currentTagId` | null after gate-out; unique while set, so one tag can never be on two sacks |
| `quadrantId` | current location |
| `status` | `stored`, `released`, `damaged`, `lost` |
| `gateInAt`, `gateOutAt` | |
| `weightKg`, `notes` | optional |

### Tag

One reusable PVC tag.

| Field | Notes |
|---|---|
| `code` | the tag ID printed in the QR: `{PREFIX}-{6-digit serial}-{check char}`, e.g. `FAF-000123-K`; unique. The check character catches typing mistakes when a code is entered by hand |
| `source` | `generated` (made in OnioNet) or `imported` (pre-printed) |
| `qrSigned` | false only for imported tags whose QR has no OnioNet signature (assumption E) |
| `tagLotId` | the lot it was produced in |
| `status` | `available`, `assigned`, `damaged`, `lost`, `retired` |
| `currentSackId` | null unless assigned |
| `useCount` | how many sacks this tag has been on |
| `lastScannedAt` | |

The QR text is `code` plus the HMAC signature. It is generated on request for printing and is never stored. No farmer or batch data is in it.

### TagLot

A set of tags generated and printed together.

| Field | Notes |
|---|---|
| `lotNo` | per cooperative |
| `firstCode`, `lastCode`, `quantity` | the number range |
| `source` | `generated` or `imported` |
| `createdBy`, `printedAt`, `notes` | |

### CustodyEvent

The custody record. Append-only: no route or code path can edit or delete one.

| Field | Notes |
|---|---|
| `type` | `gate_in`, `move`, `gate_out`, `tag_replaced`, `tag_damaged`, `tag_lost`, `tag_retired`, `tag_restored`, `sack_damaged`, `sack_lost` |
| `tagId`, `sackId`, `batchId`, `memberId` | whichever apply |
| `fromQuadrantId`, `toQuadrantId` | for moves and gate-in |
| `performedBy`, `performedByName` | the staff member; name is copied so history survives renames |
| `method` | `scan` (that tag was scanned), `range_scan` or `range_typed` (bound as part of a range) |
| `occurredAt` | server time |
| `releaseNo` | groups the sacks scanned out in one visit, for the release slip |
| `clientEventId` | sent by the phone so a retry on a bad connection cannot record the same scan twice |
| `notes` | |

Indexed by tag, by sack, and by date, giving the full history per tag and per sack.

### How fees are computed (`server/services/fees.js`)

All amounts are worked out when read from the rates copied onto the delivery, each sack's gate-in and gate-out times, and the current time. Nothing is stored or updated by a scheduled job.

| Charge | Amount |
|---|---|
| Storage fee | rate × every sack received (covers the contract period) |
| Added fee, per sack | rate × sacks received |
| Added fee, per delivery | rate once, when the delivery has at least one sack |
| Added fee, per sack per month | rate × months each sack is stored; every started month counts, at least one |
| Member discount | % off the storage fee and added fees, rounded to the nearest centavo; never on the overdue fee; members only |
| Overdue fee | rate × days each sack stays after the contract end; every started day counts; stops when the sack is released |

Balance = charges − payments − waivers or discounts + refunds, ignoring voided entries. A payment or waiver cannot exceed the balance; a refund cannot exceed what was paid. Waivers, refunds, and voids are for the Cooperative Admin; a waiver needs a reason. Releasing sacks is not blocked by an unpaid balance; the release screen shows a warning.

### Installment plans (layaway terms)

Stored on the delivery as `paymentPlan`: created by and when, frequency (monthly, every 2 weeks, weekly), and the installments (due date, amount). Only the Cooperative Admin sets up or cancels a plan (cancelling needs a reason). The current balance is split evenly into 2 to 12 installments, with leftover centavos on the last one. The farmer can still pay any amount at any time.

Progress is worked out when read by the fee service (`planProgress`): money paid, waived, or discounted after the plan was set up, minus refunds and ignoring voided entries, is applied to installments in due-date order. An installment is late once its whole due day has passed. Charges added after the plan (such as new overdue fees) are shown as not covered. Late plans are flagged on the delivery, farmer, inventory list, Transactions page, receipt, and release screen. Releasing sacks is never blocked; it warns.

### Transaction

Money that actually moved. Charges are not stored here; they come from the fee service.

| Field | Notes |
|---|---|
| `receiptNo` | per cooperative |
| `type` | `payment`, `adjustment` (waiver or discount), `refund` |
| `batchId`, `memberId` | |
| `amountCentavos` | integer |
| `method`, `referenceNo` | `cash`, `gcash`, `bank`; reference for non-cash |
| `paidAt`, `recordedBy` | |
| `voided` | `{ at, by, reason }`; a wrong entry is voided, never deleted |
| `notes` | |

Balance = charges from the fee service − non-voided transactions. The batch page, ledger, dashboard, and reports all call the same function.

### AuditLog

Who changed what. Append-only.

| Field | Notes |
|---|---|
| `cooperativeId` | null for Super Admin platform actions |
| `actorId`, `actorName`, `actorRole` | |
| `action` | `create`, `update`, `delete`, `void`, `login`, `login_failed`, `export`, `password_reset` |
| `entityType`, `entityId`, `entityLabel` | label is the human name shown in the UI |
| `changes` | `[{ field, from, to }]`; passwords and secrets are never recorded |
| `occurredAt` | |

### TagCount

One tag count (reconciliation) session. Added for the tag count feature.

| Field | Notes |
|---|---|
| `countNo` | per cooperative |
| `status` | `open`, `finished` |
| `startedBy`, `startedAt`, `finishedAt` | |
| `scannedTagIds` | tags scanned as on hand |
| `unknownCodes` | scanned codes that are not registered tags |

The result is worked out when read: **missing** (Available in the system but not scanned), **unexpected** (scanned but not a registered tag), and **wrong state** (scanned on hand but recorded as Assigned, Lost, or Retired).

### Counter (internal helper)

Holds the next batch, receipt, member, lot, and tag number per cooperative so numbers never repeat under simultaneous use. Not one of the eleven requested models; no UI. TagCount above is the other addition.

---

## 5. API routes

All routes are under `/api`. All except login require a session. IDs in paths are opaque record IDs, never names or other personal data.

### Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | exists |
| POST | `/auth/logout` | exists |
| GET | `/auth/me` | exists |
| POST | `/auth/change-password` | |

### Super Admin (`/admin`)

| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/admin/cooperatives` | list, onboard a cooperative |
| GET, PATCH | `/admin/cooperatives/:id` | profile, suspend or reactivate |
| PATCH | `/admin/cooperatives/:id/subscription` | manage subscription |
| POST | `/admin/cooperatives/:id/admins` | create a Cooperative Admin |
| GET | `/admin/overview` | cross-cooperative totals and plans ending within 30 days; no farmer details |
| POST | `/admin/cooperatives/:id/admins/:userId/reset-password` | reset a locked-out Cooperative Admin's password |

### Cooperative setup

| Method | Path | Purpose |
|---|---|---|
| GET, PATCH | `/cooperative` | profile, branding, contract length |
| GET, PATCH | `/cooperative/fees` | built-in fees and member discount; edit (admin) |
| POST | `/cooperative/fees/added` | add a fee (admin) |
| PATCH | `/cooperative/fees/added/:feeId` | edit or turn off an added fee (admin) |
| GET, POST | `/quadrants` | layout with live occupancy; add |
| PATCH | `/quadrants/:id` | capacity, fill order, active |

Adding or editing a quadrant is blocked if total active capacity would exceed the plan's `capacityLimit`.

| GET, POST | `/users` | staff and admin accounts |
| PATCH | `/users/:id` | role, active |
| POST | `/users/:id/reset-password` | |

### Farmers

| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/members` | list (paged), add |
| POST | `/members/search` | search by name or number in the body |
| GET, PATCH | `/members/:id` | detail, edit |
| POST | `/members/:id/portal-access` | create or disable the farmer's login |
| GET | `/members/:id/ledger` | charges and payments across batches |

### Inventory

| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/batches` | list with filters (status, quadrant, overdue); start an intake. Blocked if `declaredSackCount` is more than the available capacity (assumption D) |
| GET, PATCH | `/batches/:id` | detail with sacks and fees; correct intake details |
| POST | `/batches/:id/finish-receiving` | closes intake |
| GET | `/batches/:id/ledger` | charges and payments for one batch |
| GET | `/sacks` | list with filters |
| GET | `/sacks/:id` | detail with custody history |

### QR tags

| Method | Path | Purpose |
|---|---|---|
| GET | `/tags` | list with status filter |
| GET | `/tags/:id` | detail with full history across sacks |
| POST | `/tags/:id/status` | mark damaged, lost, retired, or available again |
| GET, POST | `/tag-lots` | list; generate a lot of new tags |
| POST | `/tag-lots/import` | register pre-printed tags from a CSV, or one by one by scanning |
| GET | `/tag-lots/:id/print` | signed QR texts for the in-browser print sheet |
| POST | `/tags/reconciliation` | start a tag count |
| POST | `/tags/reconciliation/:id/scans` | add scanned tags to the count |
| POST | `/tags/reconciliation/:id/finish` | close the count |
| GET | `/tags/reconciliation/:id` | missing, unexpected, and wrong-state tags |

### Custody (scanning)

| Method | Path | Purpose |
|---|---|---|
| POST | `/custody/scan` | verify a QR and return the tag's state, sack, batch, and farmer name |
| POST | `/custody/gate-in` | bind a tag to a new sack in a batch and place it in a quadrant |
| POST | `/custody/gate-in-range` | bind a run of tags (first to last, scanned or typed) to new sacks in one step; `dryRun` previews it |
| POST | `/custody/move` | move a sack to another quadrant |
| POST | `/custody/releases` | start a release for one delivery; returns the release number |
| POST | `/custody/gate-out` | release a sack and free its tag |
| GET | `/custody/releases/:releaseNo` | release slip data: farmer, sacks released, sacks remaining, date, staff. Printed in the browser |
| POST | `/custody/replace-tag` | move a sack from a damaged or lost tag to a new one |
| GET | `/custody/events` | event list with filters |

Each write checks the current state first (for example, gate-in only works on an Available tag) and runs as one transaction with its custody event and audit entry.

### Money

| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/transactions` | list; record a payment or adjustment |
| GET | `/transactions/:id` | receipt detail |
| POST | `/transactions/:id/void` | void with a reason |

### Dashboard, reports, audit

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard` | stat cards, capacity, entries and releases chart, recent activity |
| GET | `/reports/inventory` | stock by quadrant, farmer, and batch |
| GET | `/reports/movements` | entries, moves, releases for a date range |
| GET | `/reports/fees` | charges, collections, balances |
| GET | `/reports/overdue` | batches past contract end |
| GET | `/reports/tags` | tag counts by status, reuse counts |
| GET | `/reports/tag-reconciliation/:id` | result of one tag count |
| GET | `/reports/members` | farmer masterlist |
| GET | `/reports/statement/:memberId` | statement of account for one farmer |
| GET | `/audit-logs` | filter by date, person, and record type |

Reports return data only; PDFs are made in the browser. Printing a report calls `POST /reports/printed`, which records an `export` audit entry and is allowed only when the plan includes `pdf_reports`. The Audit Logs page uses `GET /audit-logs/filters` and `POST /audit-logs/search` (Cooperative Admin only).

### Farmer portal (`/me`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/me/summary` | own sacks in storage, balance, next contract end |
| GET | `/me/batches`, `/me/batches/:id` | own batches |
| GET | `/me/sacks` | own sacks and locations |
| GET | `/me/ledger` | own charges and payments |

---

## 6. Role access

| Area | Super Admin | Coop Admin | Coop Staff | Farmer |
|---|---|---|---|---|
| `/admin/*` | Full | No | No | No |
| Cooperative profile, fees, layout | No | Full | View | No |
| Users | No | Full | No | No |
| Farmers | No | Full | View, add, edit | No |
| Batches and sacks | No | Full | View, intake, edit | Own only, via `/me` |
| Tags and tag lots | No | Full | View, change status | No |
| Custody scanning | No | Full | Full | No |
| Transactions | No | Full, including void | View, record | Own only, via `/me` |
| Reports | No | Full | View | No |
| Audit logs | No | View | No | No |

Super Admin has no access to a cooperative's farmer data; they see totals only.

---

## 7. Changes to the current scaffold

What already exists stays, with these adjustments:

- Quadrants move out of `Cooperative.settings.zones` into their own collection; the seed is updated to match.
- Cooperative gains `contact`, `branding`, `settings.fees`, and `subscription` (with `capacityLimit` and `enabledFeatures`).
- User gains `phone`, `memberId`, `mustChangePassword`, `lastLoginAt`.
- The manual `tenantScope` helper is replaced by the automatic tenant plugin and request context.
- The helper-only tenant test is replaced by the HTTP isolation test described in section 2.
- The seed adds a Super Admin. Tests create their own cooperatives in an in-memory database.

After approval, the scaffold step covers: all models with the tenant plugin, auth and role middleware wired to route groups, the isolation test, and the shell updated for each role. Feature screens (intake, scanning, fees, reports) come after, in that order.
