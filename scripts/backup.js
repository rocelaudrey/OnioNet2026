// Saves a copy of the whole OnioNet database to this computer: one gzipped
// file per collection (MongoDB Extended JSON, one record per line) plus a
// summary. The free Atlas M0 tier has no automatic backups, so run this
// regularly (for example every evening during the season).
//
//   node --env-file=<settings file> scripts/backup.js [--out backups]
//
// The files contain farmers' personal data (RA 10173). Keep them on an
// encrypted drive or in a private, access-controlled folder, and delete old
// copies you no longer need. The backups/ folder is ignored by git.
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import mongoose from 'mongoose';

const { EJSON } = mongoose.mongo.BSON;
const args = process.argv.slice(2);
const outRoot = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'backups';

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = join(outRoot, `${db.databaseName}-${stamp}`);
await mkdir(dir, { recursive: true });

const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
  .map((c) => c.name).filter((name) => !name.startsWith('system.')).sort();
const counts = {};
for (const name of collections) {
  const cursor = db.collection(name).find({}, { sort: { _id: 1 } });
  let count = 0;
  const lines = Readable.from((async function* rows() {
    for await (const doc of cursor) {
      count += 1;
      yield `${EJSON.stringify(doc, { relaxed: false })}\n`;
    }
  })());
  await pipeline(lines, createGzip(), createWriteStream(join(dir, `${name}.jsonl.gz`)));
  counts[name] = count;
  console.log(`  ${name.padEnd(16)} ${count}`);
}
await writeFile(join(dir, 'backup.json'), JSON.stringify({ database: db.databaseName, takenAt: new Date(), collections: counts }, null, 2));
console.log(`\nSaved to ${dir}`);
await mongoose.disconnect();
