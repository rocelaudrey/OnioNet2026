// Sets a cooperative's fee rates and contract length, with an audit entry.
// Preview:  node --env-file=<settings file> scripts/set-fees.js --prefix FAF --storage 270 --overdue 0 --discount 0 --months 4
// Apply:    add --confirm
import '../server/timezone.js';
import mongoose from 'mongoose';
import { connectDb } from '../server/db.js';
import { runWithContext } from '../server/context.js';
import { Cooperative } from '../server/models/index.js';
import { recordAudit } from '../server/services/audit.js';
import { toCentavos } from '../shared/money.js';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const prefix = (arg('--prefix') ?? '').toUpperCase();
const next = {
  storageFeeCentavos: arg('--storage') !== undefined ? toCentavos(arg('--storage')) : undefined,
  overdueFeePerDayCentavos: arg('--overdue') !== undefined ? toCentavos(arg('--overdue')) : undefined,
  memberDiscountPercent: arg('--discount') !== undefined ? Number(arg('--discount')) : undefined,
};
const months = arg('--months') !== undefined ? Number(arg('--months')) : undefined;
if (!prefix) throw new Error('Give the cooperative tag prefix, e.g. --prefix FAF');

await connectDb();
const coop = await Cooperative.findOne({ 'settings.tagPrefix': prefix });
if (!coop) throw new Error(`No cooperative with tag prefix ${prefix}.`);

const changes = [];
for (const [field, to] of Object.entries(next)) {
  if (to === undefined) continue;
  const from = coop.settings.fees[field];
  if (from !== to) changes.push({ field, from, to });
}
if (months !== undefined && coop.settings.contractMonths !== months) {
  changes.push({ field: 'contractMonths', from: coop.settings.contractMonths, to: months });
}
console.log(`${coop.name} (${prefix}) on database "${mongoose.connection.name}"`);
for (const c of changes) console.log(`  ${c.field}: ${c.from} -> ${c.to}`);
if (!changes.length) console.log('  Nothing to change.');

if (process.argv.includes('--confirm') && changes.length) {
  for (const c of changes) {
    coop.set(c.field === 'contractMonths' ? 'settings.contractMonths' : `settings.fees.${c.field}`, c.to);
  }
  await coop.save();
  await runWithContext({ userId: null, userName: 'OnioNet setup', role: 'coop_admin', cooperativeId: String(coop._id) }, () =>
    recordAudit({ action: 'update', entityType: 'Fees', entityId: coop._id, entityLabel: 'Fees and contract length', changes }));
  console.log('Saved.');
} else if (changes.length) {
  console.log('Preview only. Add --confirm to save.');
}
await mongoose.disconnect();
