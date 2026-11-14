import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, History } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import Scanner from '../../components/Scanner.jsx';
import { Button, Field, Modal, Notice, SelectField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { dateTime, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';
import { EVENT_LABELS, METHOD_LABELS, TagStatusBadge } from './labels.jsx';

const CHANGES = {
  damaged: { button: 'Mark Damaged', variant: 'danger', text: 'Mark this tag as damaged? It cannot be put on a sack until it is put back in service.' },
  lost: { button: 'Mark Lost', variant: 'danger', text: 'Mark this tag as lost? If it is found later, it can be put back in service.' },
  retired: { button: 'Retire Tag', variant: 'danger', text: 'Retire this tag for good? A retired tag can never be used again. Its history is kept.' },
  available: { button: 'Back in Service', variant: 'primary', text: 'Put this tag back in service? It will be available for sacks again.' },
};

function ChangeStatus({ tag, to, onDone, onClose }) {
  const save = useSave();
  const [notes, setNotes] = useState('');
  const change = CHANGES[to];
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      await api(`/tags/${tag.id}/status`, { method: 'POST', body: { status: to, notes } });
      onDone();
    });
  };
  return (
    <Modal title={change.button} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm"><span className="font-mono font-medium">{tag.code}</span>: {change.text}</p>
        <Field label="Note (optional)">
          <textarea rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened?" />
        </Field>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={change.variant} disabled={save.busy}>{save.busy ? 'Saving…' : change.button}</Button>
        </div>
      </form>
    </Modal>
  );
}

// For a tag that is on a sack but damaged or lost: scan a new tag onto the sack.
function ReplaceTag({ tag, sack, onDone, onClose }) {
  const [reason, setReason] = useState('damaged');
  const [notes, setNotes] = useState('');
  const onScan = async (text) => {
    const res = await api('/custody/replace-tag', { method: 'POST', body: { oldTagId: tag.id, newText: text, reason, notes } });
    onDone(res);
    return { kind: 'ok', message: `Sack ${res.sack.sackNo} now has tag ${res.newTag.code}.` };
  };
  return (
    <Modal title="Replace Tag" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          Put a new tag on <span className="font-medium">Sack {sack.sackNo}</span> of {sack.batchNo}. The old tag <span className="font-mono font-medium">{tag.code}</span> will be taken out of use.
        </p>
        <SelectField label="What happened to the old tag?" value={reason} onChange={(e) => setReason(e.target.value)} options={[['damaged', 'It is damaged'], ['lost', 'It is lost']]} />
        <Field label="Note (optional)">
          <textarea rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">Clip the new tag on the sack, then scan it. The new tag must be scanned, not typed.</p>
        <Scanner onScan={onScan} allowTyping={false} />
      </div>
    </Modal>
  );
}

export default function TagDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad(`/tags/${id}`);
  const [changing, setChanging] = useState(null);
  const [replacing, setReplacing] = useState(false);
  const [replaced, setReplaced] = useState(null);

  const back = (
    <Link to="/qr-tags" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> All tags
    </Link>
  );
  if (loading) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  if (error) return <>{back}<Notice>{error}</Notice></>;
  const { tag, history, sack } = data;

  return (
    <>
      {back}
      <div className="mb-6">
        <h1 className="font-mono text-2xl">{tag.code}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <TagStatusBadge status={tag.status} />
          {tag.lotNo && <span>Lot {tag.lotNo}</span>}
          <span>Used {number(tag.useCount)} {tag.useCount === 1 ? 'time' : 'times'}</span>
          {tag.source === 'imported' && <span>Pre-printed{tag.qrSigned ? '' : ', no security code'}</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Tag Status">
          {tag.status === 'assigned' && sack && (
            <div className="mb-3 space-y-1 text-sm">
              <p>On <span className="font-medium">Sack {sack.sackNo}</span> of <Link className="font-medium text-brand-green hover:underline" to={`/inventory/${sack.batchId}`}>{sack.batchNo}</Link></p>
              <p className="text-muted">{sack.ownerName} · stored in {sack.quadrantCode}</p>
            </div>
          )}
          {tag.status === 'assigned' && <p className="text-sm text-muted">This tag becomes available again when the sack is released.</p>}
          {tag.status === 'assigned' && sack && (
            <Button variant="secondary" className="mt-3 w-full" onClick={() => setReplacing(true)}>Replace Tag (damaged or lost)</Button>
          )}
          {replaced && <div className="mb-3"><Notice kind="success">Sack {replaced.sack.sackNo} now has tag {replaced.newTag.code}. This tag is marked {replaced.oldTag.status}.</Notice></div>}
          {tag.status === 'retired' && <p className="text-sm text-muted">This tag is retired and cannot be used again.</p>}
          {tag.allowedChanges.length > 0 && (
            <div className="flex flex-col gap-2">
              {tag.allowedChanges.map((to) => (
                <Button key={to} variant={CHANGES[to].variant === 'primary' ? 'primary' : 'secondary'} onClick={() => setChanging(to)}>
                  {CHANGES[to].button}
                </Button>
              ))}
            </div>
          )}
        </Card>

        <Card title="History" className="lg:col-span-2">
          {history.length === 0 ? (
            <EmptyState icon={History} title="No history yet" detail="Every time this tag is put on a sack, moved, released, or changed, it is recorded here." />
          ) : (
            <ul className="divide-y divide-line">
              {history.map((event) => (
                <li key={event.id} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-brand-green">
                    <History size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {EVENT_LABELS[event.type] ?? event.type}
                      {METHOD_LABELS[event.method] && <span className="ml-2 font-normal text-muted">{METHOD_LABELS[event.method]}</span>}
                    </p>
                    <p className="text-xs text-muted">By {event.performedByName}{event.notes && ` · ${event.notes}`}</p>
                  </div>
                  <time className="shrink-0 text-xs text-muted">{dateTime(event.occurredAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {replacing && sack && <ReplaceTag tag={tag} sack={sack} onClose={() => setReplacing(false)} onDone={(res) => { setReplacing(false); setReplaced(res); reload(); }} />}
      {changing && <ChangeStatus tag={tag} to={changing} onClose={() => setChanging(null)} onDone={() => { setChanging(null); reload(); }} />}
    </>
  );
}
