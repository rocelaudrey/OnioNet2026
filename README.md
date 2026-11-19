# OnioNet

QR-based custody tracking and monitoring for onion cold storage facilities run by agricultural cooperatives.

Each sack gets a reusable PVC tag with a QR code. Staff scan the tag when a sack comes in, moves, or goes out, so the cooperative always knows which farmer owns each sack, where it is, and what is owed for it. One installation serves many cooperatives, each kept completely separate. The first is **FAFOGGGA Cold Storage**, Nagcuartelan, Aritao, Nueva Vizcaya.

The QR code holds only the tag's ID and a short security signature, never farmer or delivery details.

## What it does

| Who | What they can do |
|---|---|
| **Cooperative Staff** | Receive deliveries and scan tags onto sacks (one by one, or a whole run of tags at once), move sacks between quadrants, release sacks with a printed release slip, record payments, run tag counts |
| **Cooperative Admin** | Everything staff can do, plus settings (layout, fees, users), fee waivers, refunds and voids, installment plans, making and printing tags, and the audit log |
| **Farmer** | See their own sacks, deliveries, fees, and installment plan, read-only, from a phone |
| **Super Admin** | Onboard cooperatives, manage subscriptions and features, and see totals across cooperatives (counts only, never farmer details) |

Main pages for cooperatives: Dashboard, Inventory, QR Tags, Farmers, Transactions, Reports, Audit Logs, Settings.

Reports (printed or saved as PDF in the browser): inventory, movements, fees and collections, overdue deliveries, tags, farmer masterlist, and statement of account.

## How it is built

- **Frontend:** React (Vite), React Router, Tailwind CSS, lucide-react icons, Recharts
- **Backend:** Node.js and Express, under `/api`
- **Database:** MongoDB with Mongoose (MongoDB Atlas in production)
- **Sign-in:** JWT in an httpOnly cookie, passwords hashed with bcrypt; users sign in with an email or a mobile number
- **Hosting:** Vercel serves the frontend and runs the Express API as a serverless function

Key rules, enforced in code and covered by tests:

- **Cooperatives never see each other's data.** Every record carries a `cooperativeId`, and every database query is limited to the signed-in user's cooperative automatically. A query with no signed-in cooperative fails instead of returning everything.
- **One fee service.** Every peso amount (storage fee, added fees, member discount, overdue fee, balance) comes from `server/services/fees.js` and is worked out when read, so every page shows the same numbers and overdue fees grow without scheduled jobs. Money is stored in whole centavos.
- **Custody is verified by scanning.** Custody events cannot be edited or deleted, and each one records who did it and when.
- **Data Privacy Act (RA 10173).** Role-based access, no personal data in URLs or QR codes, and an audit log of every change (including printing reports).
- **Philippine time.** The server works in Asia/Manila time wherever it runs.
- **Official addresses.** Farmer addresses are chosen from the PSA's official PSGC list (region, province, city or municipality, barangay).

## Project layout

```
api/index.js          Vercel entry point; exports the Express app
server/               Express app: routes, models, services, middleware
  services/fees.js    The fee service (all money amounts)
  plugins/tenant.js   Automatic per-cooperative query scoping
shared/               Code used by both sides (money formatting, status names)
src/                  React app
scripts/build-psgc.js Builds the address dropdown files into public/psgc/
tests/unit/           Unit tests
tests/integration/    API tests on an in-memory MongoDB replica set
docs/PROPOSAL.md      The approved design: data models, API routes, decisions
CLAUDE.md             Working rules for the codebase
```

## Running it locally

**You need:** Node.js 24 and a MongoDB database. A free MongoDB Atlas cluster is recommended, because receiving and releasing sacks use database transactions, which need a replica set. A plain local MongoDB works for most things, but those steps then run without transactions (development only).

1. Install the packages:
   ```bash
   npm install
   ```
2. Copy the settings template and fill it in:
   ```bash
   cp .env.example .env
   ```
   Set `MONGODB_URI` to your database (use a separate database name, such as `onionet_dev`, from the real one). Make `JWT_SECRET` and `QR_HMAC_SECRET` long random values, for example with:
   ```bash
   openssl rand -hex 32
   ```
   Set the `SEED_*` emails and passwords for the first accounts.
3. Create the Super Admin, FAFOGGGA with its 8 quadrants, and FAFOGGGA's first admin:
   ```bash
   npm run seed
   ```
4. Start the app:
   ```bash
   npm run dev
   ```
   It opens on http://localhost:5173 (the API runs on port 3001). Sign in with the seeded accounts.

Camera scanning needs HTTPS. It works on `localhost` on the same computer, but not from a phone over your Wi-Fi; test phone scanning on the deployed site.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app locally (API and web) |
| `npm test` | Runs all tests |
| `npm run build` | Builds the web app into `dist/` |
| `npm run seed` | Creates the first accounts and FAFOGGGA; safe to run again |
| `npm run psgc` | Rebuilds the address dropdown files (runs automatically before `dev` and `build`) |

Data scripts (each previews by default; add `--confirm` to apply). Use `--env-file=.env` locally or your production settings file for the live site:

| Command | What it does |
|---|---|
| `node --env-file=.env scripts/set-fees.js --prefix FAF --storage 270 --overdue 0 --discount 0 --months 4` | Sets a cooperative's fees and contract length, with an audit entry |
| `node --env-file=.env scripts/sample-data.js --prefix FAF` | Loads a season of sample farmers, deliveries, releases, charges, and payments, recorded by a "Sample Data" account |
| `node --env-file=.env scripts/remove-sample-data.js --prefix FAF` | Removes all sample data and restores the numbering |

## Settings

| Variable | Needed | What it is |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string, including the database name |
| `JWT_SECRET` | Yes | Signs sign-in sessions. Changing it signs everyone out |
| `QR_HMAC_SECRET` | Yes | Signs the QR codes on tags. **Never change it after tags are printed**, or every printed tag will fail the security check |
| `APP_TIME_ZONE` | No | Defaults to `Asia/Manila` |
| `SEED_*` | Seeding only | Names, emails, and passwords for the first accounts |

Secrets go in `.env` locally (never committed) and in Vercel's environment variables in production. Never put them in the code.

## Deploying

1. **MongoDB Atlas:** create a free M0 cluster on AWS Singapore (ap-southeast-1), a database user, and network access from `0.0.0.0/0` (Vercel's addresses change). Copy the connection string and add the database name, for example `.../onionet?retryWrites=true&w=majority`.
2. **Vercel:** import this repository. The settings come from `vercel.json` (functions run in Singapore, `sin1`) and `package.json` (Node 24). Add `MONGODB_URI`, `JWT_SECRET`, and `QR_HMAC_SECRET` as environment variables, using **new** secrets rather than your local ones, then deploy.
3. **First accounts:** run the seed once from your computer against the live database. Put the live `MONGODB_URI` and real `SEED_*` emails and strong passwords in a separate file such as `.env.production.local` (ignored by git), then:
   ```bash
   node --env-file=.env.production.local server/seed.js
   ```
   Delete that file afterwards, or keep it somewhere safe.
4. **Keep a safe copy of `QR_HMAC_SECRET`**, for example in a password manager. Printed tags depend on it.

Vercel's free Hobby plan is for non-commercial use. Move to the Pro plan before charging cooperatives a subscription.

## Tests

```bash
npm test
```

The integration tests start an in-memory MongoDB replica set (the first run downloads a MongoDB binary). They cover cooperative data separation, fee and balance rules, custody changes (gate-in, ranges, moves, releases, tag replacement), payments, installment plans, reports, the farmer portal, Super Admin access, addresses, and the time zone.

## License

Private. All rights reserved.

Philippine address data comes from the PSA's Philippine Standard Geographic Code via [`@aivangogh/ph-address`](https://www.npmjs.com/package/@aivangogh/ph-address) (MIT).
