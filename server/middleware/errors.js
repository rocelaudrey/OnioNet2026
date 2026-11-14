export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err?.name === 'ValidationError') {
    const first = Object.values(err.errors ?? {})[0];
    return res.status(400).json({ error: first?.message || 'Please check the details and try again.' });
  }
  // A malformed ID is treated the same as a record that does not exist.
  if (err?.name === 'CastError') return res.status(404).json({ error: 'Record not found.' });
  if (err?.name === 'TenantError') return res.status(403).json({ error: 'You do not have access to this.' });
  if (err?.code === 11000) return res.status(409).json({ error: 'That already exists.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
