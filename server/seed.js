// Seeds the Super Admin, the first tenant (FAFOGGGA), its layout, and its
// first Cooperative Admin. Safe to run more than once: existing records are
// left as they are.
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { asCooperative, asSystem } from './context.js';
import { Cooperative, Quadrant, User } from './models/index.js';
import { ROLES } from './lib/roles.js';
import { FEATURES } from '../shared/statuses.js';

const QUADRANT_CAPACITY = 1250;
const QUADRANTS = ['1-A', '1-B', '1-C', '1-D', '2-A', '2-B', '2-C', '2-D'].map((code, i) => ({
  code, floor: Number(code[0]), capacity: QUADRANT_CAPACITY, fillOrder: i + 1,
}));

const env = process.env;
for (const name of ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_SUPER_ADMIN_EMAIL', 'SEED_SUPER_ADMIN_PASSWORD']) {
  if (!env[name]) throw new Error(`Set ${name} before seeding.`);
}

async function ensureUser({ email, password, name, role }) {
  const address = email.toLowerCase().trim();
  if (await asSystem(() => User.exists({ email: address }))) {
    console.log(`User already exists: ${address}`);
    return;
  }
  await User.create({ name, email: address, passwordHash: await bcrypt.hash(password, 12), role });
  console.log(`Created ${role}: ${address}`);
}

await connectDb();

await asSystem(() => ensureUser({
  email: env.SEED_SUPER_ADMIN_EMAIL, password: env.SEED_SUPER_ADMIN_PASSWORD,
  name: env.SEED_SUPER_ADMIN_NAME || 'OnioNet Super Admin', role: ROLES.SUPER_ADMIN,
}));

let coop = await Cooperative.findOne({ 'settings.tagPrefix': 'FAF' });
if (coop) {
  console.log(`Cooperative already exists: ${coop.name}`);
} else {
  coop = await Cooperative.create({
    name: 'FAFOGGGA',
    facilityName: 'FAFOGGGA Cold Storage',
    address: 'Nagcuartelan, Aritao, Nueva Vizcaya',
    settings: { tagPrefix: 'FAF', contractMonths: 3 },
    subscription: { plan: 'pilot', status: 'active', capacityLimit: 10000, enabledFeatures: FEATURES },
  });
  console.log(`Created cooperative: ${coop.name}`);
}

await asCooperative(coop._id, async () => {
  if (await Quadrant.countDocuments()) {
    console.log('Layout already exists.');
  } else {
    await Quadrant.insertMany(QUADRANTS);
    console.log(`Created ${QUADRANTS.length} quadrants (${(QUADRANTS.length * QUADRANT_CAPACITY).toLocaleString('en-US')} sacks).`);
  }
  await ensureUser({
    email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD,
    name: env.SEED_ADMIN_NAME || 'Cooperative Admin', role: ROLES.COOP_ADMIN,
  });
});

await mongoose.disconnect();
