import mongoose from 'mongoose';
import { Batch } from '../models/Batch.js';
import { Counter } from '../models/Counter.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { Quadrant } from '../models/Quadrant.js';
import { Sack } from '../models/Sack.js';
import { Tag } from '../models/Tag.js';
import { Cooperative } from '../models/Cooperative.js';
import { getContext } from '../context.js';
import { makeTagCode, parseTagCode } from '../lib/tagCode.js';
import { recordAudit } from './audit.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { storedByQuadrant } from './capacity.js';
import { nextNumber } from './sequences.js';
import { SCAN_PROBLEMS, resolveTag } from './tags.js';
import { inTransaction } from './tx.js';

// Custody state changes. Each one updates the tag and the sack and writes the
// custody event together, in one transaction. Nothing enters or leaves storage
// without a scan: typed codes are never accepted here.

const TAG_NOT_AVAILABLE = {
  assigned: 'This tag is already on another sack.',
  damaged: 'This tag is marked damaged. Use a different tag.',
  lost: 'This tag is marked lost. Put it back in service first, or use a different tag.',
  retired: 'This tag is retired. Use a different tag.',
};

function scanError(problem) {
  return new HttpError(problem === 'unknown' ? 404 : 400, SCAN_PROBLEMS[problem]);
}

// Gate-in: binds one available tag to one new sack of a delivery and places it
// in a quadrant. Returns { sack, tag, quadrant, received, declared, repeat }.
export async function gateIn({ batchId, text, quadrantId, clientEventId }) {
  const ctx = getContext();
  const eventId = String(clientEventId ?? '').trim() || undefined;

  const run = () => inTransaction(async (session) => {
    const s = session ?? null;

    // A retried request (bad signal) returns the first result instead of
    // creating a second sack.
    if (eventId) {
      const previous = await CustodyEvent.findOne({ clientEventId: eventId }).session(s).lean();
      if (previous) return { repeatOf: previous };
    }

    const batch = await Batch.findOne({ _id: batchId }).session(s);
    if (!batch) throw notFound('Delivery');
    if (batch.status !== 'receiving') throw new HttpError(400, 'This delivery is not being received, so sacks cannot be added to it.');

    const { tag, problem } = await resolveTag(text, { session });
    if (problem) throw scanError(problem);
    if (tag.status !== 'available') throw new HttpError(409, TAG_NOT_AVAILABLE[tag.status]);

    const received = await Sack.countDocuments({ batchId: batch._id }).session(s);
    if (received >= batch.declaredSackCount) {
      throw new HttpError(400, `All ${batch.declaredSackCount.toLocaleString('en-US')} sacks of this delivery are scanned in. If there are more, change the sack count first.`);
    }

    const quadrant = await Quadrant.findOne({ _id: quadrantId }).session(s);
    if (!quadrant) throw new HttpError(400, 'Choose where to store this sack.');
    if (!quadrant.active) throw new HttpError(400, `${quadrant.code} is turned off. Choose another quadrant.`);
    const used = (await storedByQuadrant(session)).get(String(quadrant._id)) ?? 0;
    if (used >= quadrant.capacity) throw new HttpError(409, `${quadrant.code} is full. Choose another quadrant.`);

    // Guarded on "available": if two phones scan the same tag, only one wins.
    const now = new Date();
    const bound = await Tag.findOneAndUpdate(
      { _id: tag._id, status: 'available' },
      { $set: { status: 'assigned', lastScannedAt: now }, $inc: { useCount: 1 } },
      { returnDocument: 'after', session },
    );
    if (!bound) throw new HttpError(409, TAG_NOT_AVAILABLE.assigned);

    const sackNo = await nextNumber(`sack:${batch._id}`, { session });
    const [sack] = await Sack.create([{
      batchId: batch._id, memberId: batch.memberId, sackNo, currentTagId: tag._id,
      quadrantId: quadrant._id, status: 'stored', gateInAt: now,
    }], { session });
    await Tag.updateOne({ _id: tag._id }, { $set: { currentSackId: sack._id } }, { session });
    await CustodyEvent.create([{
      type: 'gate_in', tagId: tag._id, sackId: sack._id, batchId: batch._id, memberId: batch.memberId,
      toQuadrantId: quadrant._id, performedBy: ctx.userId, performedByName: ctx.userName,
      occurredAt: now, clientEventId: eventId,
    }], { session });

    return {
      repeat: false,
      sack: { id: sack._id, sackNo },
      tag: { id: tag._id, code: tag.code },
      quadrant: { id: quadrant._id, code: quadrant.code, free: quadrant.capacity - used - 1 },
      received: received + 1,
      declared: batch.declaredSackCount,
    };
  });

  let result;
  try {
    result = await run();
  } catch (err) {
    // Two identical requests racing: the loser hits the unique clientEventId
    // index. Read back what the winner recorded.
    if (err?.code !== 11000 || !eventId) throw err;
    const previous = await CustodyEvent.findOne({ clientEventId: eventId }).lean();
    if (!previous) throw err;
    result = { repeatOf: previous };
  }
  if (!result.repeatOf) return result;

  const event = result.repeatOf;
  const [sack, tag, quadrant, batch] = await Promise.all([
    Sack.findOne({ _id: event.sackId }).lean(),
    Tag.findOne({ _id: event.tagId }).lean(),
    Quadrant.findOne({ _id: event.toQuadrantId }).lean(),
    Batch.findOne({ _id: event.batchId }).lean(),
  ]);
  const used = (await storedByQuadrant()).get(String(quadrant._id)) ?? 0;
  return {
    repeat: true,
    sack: { id: sack._id, sackNo: sack.sackNo },
    tag: { id: tag._id, code: tag.code },
    quadrant: { id: quadrant._id, code: quadrant.code, free: Math.max(0, quadrant.capacity - used) },
    received: await Sack.countDocuments({ batchId: batch._id }),
    declared: batch.declaredSackCount,
  };
}

// ----- Gate-in by range -----

export const MAX_RANGE = 1000;
const n = (v) => v.toLocaleString('en-US');

// One end of a range. Scanned: must be a real QR of an own tag. Typed: a tag
// number ("100") or a full code ("FAF-000100-X").
async function rangeEnd(value, method, prefix, label, session) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new HttpError(400, `${label} tag is missing.`);
  if (method === 'range_scan') {
    const { tag, problem } = await resolveTag(raw, { session });
    if (problem) throw new HttpError(problem === 'unknown' ? 404 : 400, `${label} tag: ${SCAN_PROBLEMS[problem]}`);
    return parseTagCode(tag.code).serial;
  }
  if (/^\d{1,6}$/.test(raw) && Number(raw) >= 1) return Number(raw);
  const parsed = parseTagCode(raw.split('.')[0]);
  if (!parsed) throw new HttpError(400, `${label} tag: enter a tag number like 100, or a full code like ${makeTagCode(prefix, 100)}.`);
  if (parsed.prefix !== prefix) throw new HttpError(400, `${label} tag: tags here start with ${prefix}.`);
  return parsed.serial;
}

// Binds every tag from `first` to `last` to new sacks of a delivery in one go.
// method 'range_scan': first and last were scanned. 'range_typed': they were
// typed. All-or-nothing, and each custody event records the method, so a sack
// tagged by range can always be told apart from one scanned on its own.
// dryRun checks everything and returns the summary without changing anything.
export async function gateInRange({ batchId, quadrantId, first, last, method, clientEventId, dryRun = false }) {
  const ctx = getContext();
  if (!['range_scan', 'range_typed'].includes(method)) throw new HttpError(400, 'Choose how the range is entered.');
  const eventId = String(clientEventId ?? '').trim() || undefined;
  const coop = await Cooperative.findById(ctx.cooperativeId).select('settings.tagPrefix').lean();
  const prefix = coop.settings.tagPrefix;

  return inTransaction(async (session) => {
    const s = session ?? null;
    const batch = await Batch.findOne({ _id: batchId }).session(s);
    if (!batch) throw notFound('Delivery');

    if (eventId && !dryRun) {
      const previous = await CustodyEvent.find({ clientEventId: new RegExp(`^${eventId.replace(/[^\w-]/g, '')}:`) }).session(s).lean();
      if (previous.length) {
        return { repeat: true, assigned: previous.length, received: await Sack.countDocuments({ batchId: batch._id }).session(s), declared: batch.declaredSackCount };
      }
    }
    if (batch.status !== 'receiving') throw new HttpError(400, 'This delivery is not being received, so sacks cannot be added to it.');

    const a = await rangeEnd(first, method, prefix, 'First', session);
    const b = await rangeEnd(last, method, prefix, 'Last', session);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const count = to - from + 1;
    if (count > MAX_RANGE) throw new HttpError(400, `A range can hold up to ${n(MAX_RANGE)} tags. This one has ${n(count)}.`);

    const received = await Sack.countDocuments({ batchId: batch._id }).session(s);
    const remaining = batch.declaredSackCount - received;
    if (count > remaining) {
      throw new HttpError(400, remaining > 0
        ? `This range has ${n(count)} tags, but only ${n(remaining)} more sacks are expected for this delivery.`
        : `All ${n(batch.declaredSackCount)} sacks of this delivery are already tagged.`);
    }

    const quadrant = await Quadrant.findOne({ _id: quadrantId }).session(s);
    if (!quadrant) throw new HttpError(400, 'Choose where to store these sacks.');
    if (!quadrant.active) throw new HttpError(400, `${quadrant.code} is turned off. Choose another quadrant.`);
    const used = (await storedByQuadrant(session)).get(String(quadrant._id)) ?? 0;
    const free = quadrant.capacity - used;
    if (count > free) {
      throw new HttpError(409, `${quadrant.code} has room for ${n(Math.max(0, free))} sacks, but this range has ${n(count)}. Use a smaller range or another quadrant.`);
    }

    // Every tag in the range must exist and be available.
    const codes = [];
    for (let serial = from; serial <= to; serial += 1) codes.push(makeTagCode(prefix, serial));
    const tags = await Tag.find({ code: { $in: codes } }).select('code status').session(s).lean();
    const byCode = new Map(tags.map((t) => [t.code, t]));
    const problems = [];
    for (const code of codes) {
      const tag = byCode.get(code);
      if (!tag) problems.push({ code, problem: 'not registered' });
      else if (tag.status !== 'available') problems.push({ code, problem: tag.status === 'assigned' ? 'already on a sack' : tag.status });
    }
    if (problems.length) {
      const err = new HttpError(409, `${n(problems.length)} of the ${n(count)} tags in this range cannot be used. Nothing was assigned.`);
      err.details = problems.slice(0, 50);
      throw err;
    }

    const summary = {
      repeat: false, assigned: count, firstCode: codes[0], lastCode: codes.at(-1),
      quadrant: { id: quadrant._id, code: quadrant.code, free: free - count },
      received: received + count, declared: batch.declaredSackCount,
    };
    if (dryRun) return { ...summary, dryRun: true, received };

    const now = new Date();
    const counter = await Counter.findOneAndUpdate(
      { key: `sack:${batch._id}` }, { $inc: { value: count } }, { upsert: true, returnDocument: 'after', session },
    );
    const firstSackNo = counter.value - count + 1;
    const ordered = codes.map((code) => byCode.get(code));
    const sacks = ordered.map((tag, i) => ({
      _id: new mongoose.Types.ObjectId(), batchId: batch._id, memberId: batch.memberId, sackNo: firstSackNo + i,
      currentTagId: tag._id, quadrantId: quadrant._id, status: 'stored', gateInAt: now,
    }));
    await Sack.insertMany(sacks, { session });

    // One guarded update for all tags: only tags still available are taken, and
    // each gets its own sack through the two matching lists.
    const tagIds = ordered.map((t) => t._id);
    const sackIds = sacks.map((sack) => sack._id);
    const bound = await Tag.updateMany(
      { _id: { $in: tagIds }, status: 'available' },
      [{ $set: {
        status: 'assigned',
        lastScannedAt: now,
        useCount: { $add: ['$useCount', 1] },
        currentSackId: { $arrayElemAt: [{ $literal: sackIds }, { $indexOfArray: [{ $literal: tagIds }, '$_id'] }] },
      } }],
      { session, updatePipeline: true },
    );
    if (bound.modifiedCount !== count) throw new HttpError(409, 'Some of these tags were just used by someone else. Please check the range again.');

    const note = `Range ${codes[0]} to ${codes.at(-1)} (${n(count)} tags)`;
    await CustodyEvent.insertMany(sacks.map((sack, i) => ({
      type: 'gate_in', method, tagId: sack.currentTagId, sackId: sack._id, batchId: batch._id, memberId: batch.memberId,
      toQuadrantId: quadrant._id, performedBy: ctx.userId, performedByName: ctx.userName, occurredAt: now,
      notes: note, clientEventId: eventId ? `${eventId}:${i}` : undefined,
    })), { session });
    await recordAudit({
      action: 'create', entityType: 'Batch', entityId: batch._id, entityLabel: `${batch.batchNo}: tags assigned by range`,
      changes: [{ field: method === 'range_scan' ? 'range (first and last scanned)' : 'range (typed, not scanned)', from: null, to: note }],
    }, { session });

    return { ...summary, firstSackNo, lastSackNo: firstSackNo + count - 1 };
  });
}

// ----- Shared helpers for sacks already in storage -----

async function findRepeat(eventId, session) {
  if (!eventId) return null;
  return CustodyEvent.findOne({ clientEventId: eventId }).session(session ?? null).lean();
}

// Turns a scan into the stored sack that tag is on. Scans only, never typed.
async function storedSackFor(text, session) {
  const { tag, problem } = await resolveTag(text, { session });
  if (problem) throw scanError(problem);
  if (tag.status !== 'assigned') {
    throw new HttpError(409, tag.status === 'available' ? 'This tag is not on a sack.' : `This tag is marked ${tag.status} and is not on a sack.`);
  }
  const sack = await Sack.findOne({ currentTagId: tag._id, status: 'stored' }).session(session ?? null);
  if (!sack) throw new HttpError(409, 'This tag is not on a sack in storage.');
  return { tag, sack };
}

// ----- Move -----

// Moves one stored sack to another quadrant.
export async function moveSack({ text, toQuadrantId, clientEventId }) {
  const ctx = getContext();
  const eventId = String(clientEventId ?? '').trim() || undefined;
  return inTransaction(async (session) => {
    const s = session ?? null;
    const previous = await findRepeat(eventId, session);
    if (previous) {
      const [sack, tag, to] = await Promise.all([
        Sack.findOne({ _id: previous.sackId }).session(s).lean(), Tag.findOne({ _id: previous.tagId }).session(s).lean(),
        Quadrant.findOne({ _id: previous.toQuadrantId }).session(s).lean(),
      ]);
      return { repeat: true, sack: { id: sack._id, sackNo: sack.sackNo }, tag: { code: tag.code }, to: { code: to.code } };
    }
    const { tag, sack } = await storedSackFor(text, session);
    const to = await Quadrant.findOne({ _id: toQuadrantId }).session(s);
    if (!to) throw new HttpError(400, 'Choose where to move the sacks.');
    if (!to.active) throw new HttpError(400, `${to.code} is turned off. Choose another quadrant.`);
    if (String(sack.quadrantId) === String(to._id)) throw new HttpError(409, `This sack is already in ${to.code}.`);
    const used = (await storedByQuadrant(session)).get(String(to._id)) ?? 0;
    if (used >= to.capacity) throw new HttpError(409, `${to.code} is full. Choose another quadrant.`);

    const from = await Quadrant.findOne({ _id: sack.quadrantId }).session(s).lean();
    const now = new Date();
    const moved = await Sack.findOneAndUpdate(
      { _id: sack._id, status: 'stored', quadrantId: sack.quadrantId }, { $set: { quadrantId: to._id } }, { returnDocument: 'after', session },
    );
    if (!moved) throw new HttpError(409, 'This sack was just changed by someone else. Scan it again.');
    await Tag.updateOne({ _id: tag._id }, { $set: { lastScannedAt: now } }, { session });
    await CustodyEvent.create([{
      type: 'move', tagId: tag._id, sackId: sack._id, batchId: sack.batchId, memberId: sack.memberId,
      fromQuadrantId: sack.quadrantId, toQuadrantId: to._id, performedBy: ctx.userId, performedByName: ctx.userName,
      occurredAt: now, clientEventId: eventId,
    }], { session });
    return {
      repeat: false, sack: { id: sack._id, sackNo: sack.sackNo }, tag: { code: tag.code },
      from: { code: from?.code ?? '' }, to: { id: to._id, code: to.code, free: to.capacity - used - 1 },
    };
  });
}

// ----- Gate-out (release) -----

const RELEASE_NO = /^[A-Z0-9]{2,6}-REL-\d{4}-\d{4,}$/;
const RELEASABLE = ['stored', 'partly_released'];

// Opens a release for one delivery. Every sack scanned out under its number
// appears on one release slip.
export async function startRelease(batchId) {
  const ctx = getContext();
  const batch = await Batch.findOne({ _id: batchId }).lean();
  if (!batch) throw notFound('Delivery');
  if (batch.status === 'receiving') throw new HttpError(400, 'Finish receiving this delivery before releasing sacks from it.');
  if (!RELEASABLE.includes(batch.status)) throw new HttpError(400, 'This delivery has no sacks in storage.');
  if (!(await Sack.countDocuments({ batchId: batch._id, status: 'stored' }))) throw new HttpError(400, 'This delivery has no sacks in storage.');
  const coop = await Cooperative.findById(ctx.cooperativeId).select('settings.tagPrefix').lean();
  const year = new Date().getFullYear();
  const number = await nextNumber(`release:${year}`);
  return { releaseNo: `${coop.settings.tagPrefix}-REL-${year}-${String(number).padStart(4, '0')}` };
}

// Releases one sack: the sack leaves storage and its tag is unbound and
// becomes available for another sack.
export async function gateOut({ batchId, releaseNo, text, clientEventId }) {
  const ctx = getContext();
  const eventId = String(clientEventId ?? '').trim() || undefined;
  const release = String(releaseNo ?? '').trim().toUpperCase();
  if (!RELEASE_NO.test(release)) throw new HttpError(400, 'Start a release from the delivery page first.');

  return inTransaction(async (session) => {
    const s = session ?? null;
    const batch = await Batch.findOne({ _id: batchId }).session(s);
    if (!batch) throw notFound('Delivery');
    const counts = async () => ({
      released: await CustodyEvent.countDocuments({ releaseNo: release, type: 'gate_out' }).session(s),
      remaining: await Sack.countDocuments({ batchId: batch._id, status: 'stored' }).session(s),
    });

    const previous = await findRepeat(eventId, session);
    if (previous) {
      const [sack, tag] = await Promise.all([
        Sack.findOne({ _id: previous.sackId }).session(s).lean(), Tag.findOne({ _id: previous.tagId }).session(s).lean(),
      ]);
      return { repeat: true, sack: { id: sack._id, sackNo: sack.sackNo }, tag: { code: tag.code }, ...(await counts()) };
    }

    if (batch.status === 'receiving') throw new HttpError(400, 'Finish receiving this delivery before releasing sacks from it.');
    if (!RELEASABLE.includes(batch.status)) throw new HttpError(400, 'This delivery has no sacks in storage.');
    // A release number belongs to one delivery.
    const other = await CustodyEvent.findOne({ releaseNo: release, batchId: { $ne: batch._id } }).session(s).lean();
    if (other) throw new HttpError(400, 'This release belongs to another delivery. Start a new release.');

    const { tag, sack } = await storedSackFor(text, session);
    if (String(sack.batchId) !== String(batch._id)) {
      const theirs = await Batch.findOne({ _id: sack.batchId }).select('batchNo').session(s).lean();
      throw new HttpError(409, `This sack belongs to another delivery (${theirs?.batchNo ?? 'unknown'}). It was not released.`);
    }

    const now = new Date();
    // Guarded on "stored": two phones scanning the same sack cannot both release it.
    const released = await Sack.findOneAndUpdate(
      { _id: sack._id, status: 'stored' }, { $set: { status: 'released', gateOutAt: now, currentTagId: null } }, { returnDocument: 'after', session },
    );
    if (!released) throw new HttpError(409, 'This sack was just released by someone else.');
    // The tag is free to be used on another sack.
    await Tag.updateOne({ _id: tag._id, status: 'assigned' }, { $set: { status: 'available', currentSackId: null, lastScannedAt: now } }, { session });
    await CustodyEvent.create([{
      type: 'gate_out', tagId: tag._id, sackId: sack._id, batchId: batch._id, memberId: batch.memberId,
      fromQuadrantId: sack.quadrantId, performedBy: ctx.userId, performedByName: ctx.userName,
      occurredAt: now, releaseNo: release, clientEventId: eventId,
    }], { session });

    const after = await counts();
    const status = after.remaining === 0 ? 'released' : 'partly_released';
    if (batch.status !== status) await Batch.updateOne({ _id: batch._id }, { $set: { status } }, { session });
    return { repeat: false, sack: { id: sack._id, sackNo: sack.sackNo }, tag: { code: tag.code }, batchStatus: status, ...after };
  });
}

// Everything the printed release slip needs.
export async function releaseSlip(releaseNo) {
  const ctx = getContext();
  const release = String(releaseNo ?? '').trim().toUpperCase();
  const events = await CustodyEvent.find({ releaseNo: release, type: 'gate_out' }).sort('occurredAt')
    .populate('tagId', 'code').populate('sackId', 'sackNo').populate('fromQuadrantId', 'code').lean();
  if (!events.length) throw notFound('Release');
  const [batch, coop] = await Promise.all([
    Batch.findOne({ _id: events[0].batchId }).populate('memberId', 'firstName lastName memberNo').lean(),
    Cooperative.findById(ctx.cooperativeId).select('name facilityName address').lean(),
  ]);
  const [remaining, received] = await Promise.all([
    Sack.countDocuments({ batchId: batch._id, status: 'stored' }),
    Sack.countDocuments({ batchId: batch._id }),
  ]);
  return {
    releaseNo: release,
    cooperative: { name: coop.name, facilityName: coop.facilityName ?? '', address: coop.address ?? '' },
    batchId: batch._id,
    batchNo: batch.batchNo,
    ownerName: batch.ownerType === 'coop_owned' ? 'Cooperative stock' : `${batch.memberId?.firstName ?? ''} ${batch.memberId?.lastName ?? ''}`.trim(),
    memberNo: batch.memberId?.memberNo ?? null,
    variety: batch.variety ?? '',
    startedAt: events[0].occurredAt,
    finishedAt: events.at(-1).occurredAt,
    staff: [...new Set(events.map((e) => e.performedByName))],
    sacksReleased: events.length,
    sacksRemaining: remaining,
    sacksReceived: received,
    sacks: events.map((e) => ({ sackNo: e.sackId?.sackNo, tagCode: e.tagId?.code ?? '', quadrantCode: e.fromQuadrantId?.code ?? '', releasedAt: e.occurredAt })),
  };
}

// ----- Replace a tag -----

// Puts a new tag on a stored sack whose tag is damaged or lost. The old tag
// is identified from its record (a lost tag cannot be scanned); the new tag
// must be scanned.
export async function replaceTag({ oldTagId, newText, reason, notes }) {
  const ctx = getContext();
  if (!['damaged', 'lost'].includes(reason)) throw new HttpError(400, 'Choose whether the old tag is damaged or lost.');
  return inTransaction(async (session) => {
    const s = session ?? null;
    const oldTag = await Tag.findOne({ _id: oldTagId }).session(s);
    if (!oldTag) throw notFound('Tag');
    const sack = oldTag.status === 'assigned' ? await Sack.findOne({ currentTagId: oldTag._id, status: 'stored' }).session(s) : null;
    if (!sack) throw new HttpError(400, 'This tag is not on a sack in storage, so there is nothing to replace.');

    const { tag: newTag, problem } = await resolveTag(newText, { session });
    if (problem) throw scanError(problem);
    if (String(newTag._id) === String(oldTag._id)) throw new HttpError(400, 'Scan a different tag. This is the tag being replaced.');
    if (newTag.status !== 'available') throw new HttpError(409, TAG_NOT_AVAILABLE[newTag.status]);

    const now = new Date();
    const taken = await Tag.findOneAndUpdate(
      { _id: newTag._id, status: 'available' },
      { $set: { status: 'assigned', currentSackId: sack._id, lastScannedAt: now }, $inc: { useCount: 1 } },
      { returnDocument: 'after', session },
    );
    if (!taken) throw new HttpError(409, TAG_NOT_AVAILABLE.assigned);
    await Tag.updateOne({ _id: oldTag._id, status: 'assigned' }, { $set: { status: reason, currentSackId: null } }, { session });
    const swapped = await Sack.findOneAndUpdate(
      { _id: sack._id, status: 'stored', currentTagId: oldTag._id }, { $set: { currentTagId: newTag._id } }, { returnDocument: 'after', session },
    );
    if (!swapped) throw new HttpError(409, 'This sack was just changed by someone else. Please check it again.');

    const extra = String(notes ?? '').trim();
    const base = { type: 'tag_replaced', sackId: sack._id, batchId: sack.batchId, memberId: sack.memberId, toQuadrantId: sack.quadrantId, performedBy: ctx.userId, performedByName: ctx.userName, occurredAt: now };
    await CustodyEvent.create([
      { ...base, tagId: oldTag._id, notes: `Marked ${reason}. Replaced by ${newTag.code}.${extra ? ` ${extra}` : ''}` },
      { ...base, tagId: newTag._id, notes: `Replaces ${oldTag.code} (${reason}).` },
    ], { session, ordered: true });
    await recordAudit({
      action: 'update', entityType: 'Sack', entityId: sack._id, entityLabel: `Sack ${sack.sackNo}: tag replaced`,
      changes: [{ field: 'tag', from: oldTag.code, to: newTag.code }],
    }, { session });
    return { oldTag: { id: oldTag._id, code: oldTag.code, status: reason }, newTag: { id: newTag._id, code: newTag.code }, sack: { id: sack._id, sackNo: sack.sackNo } };
  });
}
