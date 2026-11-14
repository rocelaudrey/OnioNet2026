import { Router } from 'express';
import { Batch } from '../models/Batch.js';
import { Sack } from '../models/Sack.js';
import { Tag } from '../models/Tag.js';
import { Transaction } from '../models/Transaction.js';

// Plain read-only lists for now. Filters, detail pages, fees, and the custody
// actions are built in the feature phases (see docs/PROPOSAL.md).
const PAGE = 200;
const list = (Model, key, sort) => async (req, res) => {
  res.json({ [key]: await Model.find().sort(sort).limit(PAGE).lean() });
};

export const batches = Router().get('/', list(Batch, 'batches', { receivedAt: -1 }));
export const sacks = Router().get('/', list(Sack, 'sacks', { gateInAt: -1 }));
export const tags = Router().get('/', list(Tag, 'tags', { code: 1 }));
export const transactions = Router().get('/', list(Transaction, 'transactions', { paidAt: -1 }));
