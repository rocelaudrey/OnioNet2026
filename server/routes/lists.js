import { Router } from 'express';
import { Sack } from '../models/Sack.js';

// Plain read-only lists for now. Filters, detail pages, fees, and the custody
// actions are built in the feature phases (see docs/PROPOSAL.md).
const PAGE = 200;
const list = (Model, key, sort) => async (req, res) => {
  res.json({ [key]: await Model.find().sort(sort).limit(PAGE).lean() });
};

export const sacks = Router().get('/', list(Sack, 'sacks', { gateInAt: -1 }));
