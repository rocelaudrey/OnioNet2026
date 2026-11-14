import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import Scanner from '../../components/Scanner.jsx';
import { Button, Notice } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatPHP, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Gate-out: each scan releases one sack of this delivery and frees its tag.
export default function Release() {
  const { id, releaseNo } = useParams();
  const navigate = useNavigate();
  const { data, error, loading } = useLoad(`/batches/${id}`);
  const [progress, setProgress] = useState(null); // { released, remaining }
  const [recent, setRecent] = useState([]);
  const eventIds = useRef(new Map());

  const back = (
    <Link to={`/inventory/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> Delivery details
    </Link>
  );
  if (loading) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  if (error) return <>{back}<Notice>{error}</Notice></>;

  const { batch, releases = [], account } = data;
  // Reopening a release picks up the sacks already scanned out under it.
  const released = progress?.released ?? releases.find((r) => r.releaseNo === releaseNo)?.sacks ?? 0;
  const remaining = progress?.remaining ?? batch.sacksStored;

  const onScan = async (text) => {
    if (!eventIds.current.has(text)) eventIds.current.set(text, newId());
    try {
      const res = await api('/custody/gate-out', {
        method: 'POST', body: { batchId: id, releaseNo, text, clientEventId: eventIds.current.get(text) },
      });
      setProgress({ released: res.released, remaining: res.remaining });
      if (!res.repeat) setRecent((list) => [{ sackNo: res.sack.sackNo, code: res.tag.code }, ...list].slice(0, 8));
      return res.repeat
        ? { kind: 'warning', message: `Sack ${res.sack.sackNo} was already released.` }
        : { kind: 'ok', message: `Sack ${res.sack.sackNo} released. Tag ${res.tag.code} is free to reuse.` };
    } catch (err) {
      if (err.status !== 0) eventIds.current.delete(text);
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      {back}
      <div className="mb-4">
        <h1 className="text-2xl">Release Sacks</h1>
        <p className="text-sm text-muted">{batch.ownerName} · {batch.batchNo} · {releaseNo}</p>
      </div>

      {account?.balanceCentavos > 0 && (
        <div className="mb-4">
          <Notice kind="warning">
            This delivery has an unpaid balance of {formatPHP(account.balanceCentavos)}
            {account.plan?.status === 'late' ? `, and ${account.plan.lateCount} ${account.plan.lateCount === 1 ? 'installment is' : 'installments are'} late` : account.plan ? ' on an installment plan' : ''}. <Link className="font-medium underline" to={`/inventory/${id}`}>Record a payment</Link> before releasing, if your cooperative requires it.
          </Notice>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-xs text-muted">Released now</p>
          <p className="text-4xl font-bold text-brand-purple">{number(released)}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-xs text-muted">Still in storage</p>
          <p className="text-4xl font-bold">{number(remaining)}</p>
        </div>
      </div>

      {remaining > 0 ? (
        <Card className="mb-4">
          <Scanner onScan={onScan} allowTyping={false} />
          <p className="text-xs text-muted">Scan the tag on each sack as it leaves, then unclip the tag and keep it. Codes cannot be typed here.</p>
        </Card>
      ) : (
        <Card className="mb-4 text-center">
          <p className="font-medium">Every sack of this delivery has been released.</p>
        </Card>
      )}

      <Button className="w-full py-4 text-base" disabled={released === 0} onClick={() => navigate(`/inventory/releases/${releaseNo}`)}>
        <FileText size={20} /> Done: View Release Slip
      </Button>
      {released === 0 && <p className="mt-2 text-center text-xs text-muted">The release slip is ready once at least one sack is scanned out.</p>}

      {recent.length > 0 && (
        <Card title="Just Released" className="mt-4">
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.sackNo} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">Sack {r.sackNo}</span>
                <span className="font-mono text-xs">{r.code}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
