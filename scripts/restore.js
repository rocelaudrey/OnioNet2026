// Puts a backup made by scripts/backup.js back into a database.
//
//   node --env-file=<settings file> scripts/restore.js backups/onionet-2026-11-20T09-00-00
//   add --confirm to write
//
// For safety it only restores into a database that has none of the backed-up
// collections yet. To recover the live site: restore into a NEW database name
// (change the name at the end of MONGODB_URI, e.g. .../onionet_restored),
// check it, then point Vercel's MONGODB_URI at it and redeploy.
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import mongoose from 'mongoose';

const { EJSON } = mongoose.mongo.BSON;
const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!dir) throw new Error('Give the backup folder, e.g. backups/onionet-2026-11-20T09-00-00');
const confirm = process.argv.includes('--confirm');
const summary = JSON.parse(await readFile(join(dir, 'backup.json'), 'utf8'));

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
console.log(`Backup of "${summary.database}" taken ${new Date(summary.takenAt).toLocaleString('en-US')}`);
console.log(`Restoring into database "${db.databaseName}"`);

const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
const clash = [];
for (const name of Object.keys(summary.collections)) {
  if (existing.has(name) && await db.collection(name).estimatedDocumentCount() > 0) clash.push(name);
}
if (clash.length) {
  console.log(`\nStopped: "${db.databaseName}" already has data in ${clash.join(', ')}. Restore into a new, empty database instead.`);
  await mongoose.disconnect();
  process.exit(1);
}
for (const [name, count] of Object.entries(summary.collections)) console.log(`  ${name.padEnd(16)} ${count}`);
if (!confirm) {
  console.log('\nPreview only. Nothing was written. Add --confirm to restore.');
  await mongoose.disconnect();
  process.exit(0);
}

for (const [name, expected] of Object.entries(summary.collections)) {
  const lines = createInterface({ input: createReadStream(join(dir, `${name}.jsonl.gz`)).pipe(createGunzip()), crlfDelay: Infinity });
  let batch = [];
  let written = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    batch.push(EJSON.parse(line, { relaxed: false }));
    if (batch.length === 1000) { await db.collection(name).insertMany(batch, { ordered: true }); written += batch.length; batch = []; }
  }
  if (batch.length) { await db.collection(name).insertMany(batch, { ordered: true }); written += batch.length; }
  if (written !== expected) throw new Error(`${name}: wrote ${written} records but the backup lists ${expected}.`);
  console.log(`  restored ${name}`);
}
// Indexes are rebuilt from the app's models.
await import('../server/models/index.js');
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
console.log('\nRestored, and indexes rebuilt.');
await mongoose.disconnect();
