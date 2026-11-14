import { Cooperative } from '../models/Cooperative.js';
import { Counter } from '../models/Counter.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { Tag } from '../models/Tag.js';
import { TagLot } from '../models/TagLot.js';
import { config } from '../config.js';
import { getContext } from '../context.js';
import { decodeTagQr, encodeTagQr } from '../lib/qr.js';
import { makeTagCode, parseTagCode } from '../lib/tagCode.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { recordAudit } from './audit.js';
import { nextNumber } from './sequences.js';
import { inTransaction } from './tx.js';

export const MAX_LOT_SIZE = 1000;
const MAX_SERIAL = 999999;

export const qrTextFor = (code) => encodeTagQr(code, config.qrHmacSecret);

async function ownPrefix() {
  const coop = await Cooperative.findById(getContext().cooperativeId).select('settings.tagPrefix').lean();
  return coop.settings.tagPrefix;
}

// ----- Reading a scanned or typed tag -----

// Turns scanned QR text (or a hand-typed code) into a tag of this cooperative.
// Returns { tag } or { problem, code }. Problems: 'unreadable', 'bad_signature',
// 'unknown', 'needs_scan' (a signed tag was typed where typing is not allowed).
export async function resolveTag(text, { allowTyped = false, session } = {}) {
  const raw = String(text ?? '').trim();
  const [codePart, signature, ...extra] = raw.split('.');
  const parsed = extra.length ? null : parseTagCode(codePart);
  if (!parsed) return { problem: 'unreadable', code: raw.slice(0, 40) };
  const code = codePart.toUpperCase();

  if (signature !== undefined && decodeTagQr(`${code}.${signature}`, config.qrHmacSecret) !== code) {
    return { problem: 'bad_signature', code };
  }
  const tag = await Tag.findOne({ code }).session(session ?? null);
  if (!tag) return { problem: 'unknown', code };
  // A bare code is accepted for unsigned pre-printed tags, or when the caller
  // allows typing (looking a tag up, counting tags). Custody actions do not.
  if (signature === undefined && tag.qrSigned && !allowTyped) return { problem: 'needs_scan', code };
  return { tag };
}

export const SCAN_PROBLEMS = {
  unreadable: 'This is not an OnioNet tag code. If you typed it, check for a mistake.',
  bad_signature: 'This tag did not pass the security check. It may be a copy.',
  unknown: 'This tag is not registered here.',
  needs_scan: 'Scan the QR code on this tag instead of typing it.',
};

// ----- Tag lots -----

// Reserves the next `quantity` serial numbers and creates the tags.
export async function generateLot({ quantity, notes }) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LOT_SIZE) {
    throw new HttpError(400, `Enter how many tags to make, from 1 to ${MAX_LOT_SIZE.toLocaleString('en-US')}.`);
  }
  const prefix = await ownPrefix();
  const ctx = getContext();
  return inTransaction(async (session) => {
    const counter = await Counter.findOneAndUpdate(
      { key: 'tag' }, { $inc: { value: quantity } }, { upsert: true, returnDocument: 'after', session },
    );
    const last = counter.value;
    const first = last - quantity + 1;
    if (last > MAX_SERIAL) throw new HttpError(400, 'This cooperative has used all of its tag numbers. Contact OnioNet.');
    const lotNo = await nextNumber('tagLot', { session });
    const [lot] = await TagLot.create([{
      lotNo, source: 'generated', quantity, notes,
      firstCode: makeTagCode(prefix, first), lastCode: makeTagCode(prefix, last), createdBy: ctx.userId,
    }], { session });
    const tags = [];
    for (let serial = first; serial <= last; serial += 1) tags.push({ code: makeTagCode(prefix, serial), tagLotId: lot._id });
    await Tag.insertMany(tags, { session });
    await recordAudit({
      action: 'create', entityType: 'TagLot', entityId: lot._id, entityLabel: `Tag Lot ${lotNo}`,
      changes: [{ field: 'quantity', from: null, to: quantity }],
    }, { session });
    return lot;
  });
}

// Registers pre-printed tags. All-or-nothing: any bad line rejects the import.
export async function importLot({ entries, notes }) {
  if (!Array.isArray(entries) || entries.length === 0) throw new HttpError(400, 'There are no tag codes to import.');
  if (entries.length > MAX_LOT_SIZE) throw new HttpError(400, `Import up to ${MAX_LOT_SIZE.toLocaleString('en-US')} tags at a time.`);
  const prefix = await ownPrefix();
  const ctx = getContext();
  const problems = [];
  const seen = new Set();
  const rows = [];

  entries.forEach((entry, index) => {
    const line = index + 1;
    const raw = String(entry ?? '').trim();
    const [codePart, signature, ...extra] = raw.split('.');
    const parsed = extra.length ? null : parseTagCode(codePart);
    const code = codePart?.toUpperCase();
    if (!parsed) return problems.push({ line, text: raw.slice(0, 40), problem: 'Not a valid tag code. Check for a typing mistake.' });
    if (parsed.prefix !== prefix) return problems.push({ line, text: code, problem: `Tags here must start with ${prefix}.` });
    if (seen.has(code)) return problems.push({ line, text: code, problem: 'Listed more than once.' });
    if (signature !== undefined && decodeTagQr(`${code}.${signature}`, config.qrHmacSecret) !== code) {
      return problems.push({ line, text: code, problem: 'The security code on this tag is not valid.' });
    }
    seen.add(code);
    return rows.push({ code, serial: parsed.serial, qrSigned: signature !== undefined });
  });

  if (rows.length) {
    const existing = await Tag.find({ code: { $in: rows.map((r) => r.code) } }).select('code').lean();
    const taken = new Set(existing.map((t) => t.code));
    rows.forEach((row) => {
      if (taken.has(row.code)) problems.push({ line: entries.findIndex((e) => String(e).toUpperCase().startsWith(row.code)) + 1, text: row.code, problem: 'Already registered.' });
    });
  }
  if (problems.length) {
    problems.sort((a, b) => a.line - b.line);
    const err = new HttpError(400, `${problems.length} of ${entries.length} lines have a problem. Nothing was imported.`);
    err.details = problems.slice(0, 50);
    throw err;
  }

  const sorted = [...rows].sort((a, b) => a.serial - b.serial);
  return inTransaction(async (session) => {
    const lotNo = await nextNumber('tagLot', { session });
    const [lot] = await TagLot.create([{
      lotNo, source: 'imported', quantity: rows.length, notes,
      firstCode: sorted[0].code, lastCode: sorted.at(-1).code, createdBy: ctx.userId,
    }], { session });
    await Tag.insertMany(
      rows.map((r) => ({ code: r.code, tagLotId: lot._id, source: 'imported', qrSigned: r.qrSigned })),
      { session },
    );
    // Keep generated tags from ever reusing an imported number.
    await Counter.updateOne({ key: 'tag' }, { $max: { value: sorted.at(-1).serial } }, { upsert: true, session });
    await recordAudit({
      action: 'create', entityType: 'TagLot', entityId: lot._id, entityLabel: `Tag Lot ${lotNo} (imported)`,
      changes: [{ field: 'quantity', from: null, to: rows.length }],
    }, { session });
    return lot;
  });
}

// ----- Tag status -----

// What a tag that is NOT on a sack can be changed to.
export const STATUS_CHANGES = {
  available: ['damaged', 'lost', 'retired'],
  damaged: ['available', 'retired'],
  lost: ['available', 'retired'],
  assigned: [],
  retired: [],
};
const EVENT_FOR = { damaged: 'tag_damaged', lost: 'tag_lost', retired: 'tag_retired', available: 'tag_restored' };

export async function changeTagStatus(tagId, to, notes) {
  const ctx = getContext();
  return inTransaction(async (session) => {
    const tag = await Tag.findOne({ _id: tagId }).session(session ?? null);
    if (!tag) throw notFound('Tag');
    const from = tag.status;
    if (from === 'assigned') throw new HttpError(400, 'This tag is on a sack. Release the sack or replace its tag first.');
    if (from === 'retired') throw new HttpError(400, 'A retired tag cannot be used again.');
    if (!STATUS_CHANGES[from].includes(to)) throw new HttpError(400, 'That change is not allowed for this tag.');

    // Guarded on the old status, so two people changing it at once cannot both win.
    const updated = await Tag.findOneAndUpdate(
      { _id: tag._id, status: from }, { $set: { status: to } }, { returnDocument: 'after', session },
    );
    if (!updated) throw new HttpError(409, 'This tag was just changed by someone else. Please check it again.');
    await CustodyEvent.create([{
      type: EVENT_FOR[to], tagId: tag._id, performedBy: ctx.userId, performedByName: ctx.userName,
      notes: String(notes ?? '').trim() || undefined,
    }], { session });
    await recordAudit({
      action: 'update', entityType: 'Tag', entityId: tag._id, entityLabel: tag.code,
      changes: [{ field: 'status', from, to }],
    }, { session });
    return updated;
  });
}

// ----- Tag count (reconciliation) -----

// missing: Available in the system but not scanned.
// wrongState: scanned on hand, but recorded as Assigned, Lost, or Retired.
// unexpected: scanned codes that are not registered tags.
export async function countResult(count) {
  if (count.status === 'finished' && count.result) return count.result;
  const scanned = new Set(count.scannedTagIds.map(String));
  const [available, scannedTags] = await Promise.all([
    Tag.find({ status: 'available' }).select('code').sort('code').lean(),
    Tag.find({ _id: { $in: count.scannedTagIds } }).select('code status').sort('code').lean(),
  ]);
  const missing = available.filter((t) => !scanned.has(String(t._id))).map((t) => t.code);
  const wrongState = scannedTags
    .filter((t) => ['assigned', 'lost', 'retired'].includes(t.status))
    .map((t) => ({ code: t.code, status: t.status }));
  return {
    scanned: scannedTags.length,
    expected: available.length,
    matched: scannedTags.length - wrongState.length,
    missing, wrongState, unexpected: [...count.unknownCodes],
  };
}
