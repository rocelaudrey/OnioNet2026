import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import { Badge, Notice, Table, Td } from '../../components/ui.jsx';
import { date, dateTime, formatPHP, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { BATCH_STATUS, SACK_STATUS } from '../inventory/labels.jsx';
import { Schedule } from '../transactions/PlanCard.jsx';
import { CHARGE_KIND_LABELS, METHOD_LABELS, TYPE_LABELS, amountSign, quantityText } from '../transactions/labels.jsx';
import { balanceWords } from './MemberHome.jsx';
import { CONDITION_LABELS } from '../../../shared/statuses.js';

function Row({ label, children, strong }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 text-sm ${strong ? 'border-t border-line pt-2.5 font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted'}>{label}</dt><dd className="text-right">{children}</dd>
    </div>
  );
}

// One of the farmer's deliveries: where the sacks are, what is owed, and payments.
export default function MyBatch() {
  const { id } = useParams();
  const { data, error } = useLoad(`/me/batches/${id}`);
  const back = <Link to="/my-batches" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={16} /> My batches</Link>;
  if (error) return <>{back}<Notice>{error}</Notice></>;
  if (!data) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  const { delivery: d, sacks, releases } = data;
  const a = d.account;
  const where = new Map();
  for (const s of sacks) if (s.status === 'stored') where.set(s.quadrantCode, (where.get(s.quadrantCode) ?? 0) + 1);

  return (
    <>
      {back}
      <div className="mb-5">
        <h1 className="text-2xl">{d.batchNo}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge color={BATCH_STATUS[d.status]?.[1] ?? 'gray'}>{BATCH_STATUS[d.status]?.[0]}</Badge>
          {d.overdue && <Badge color="red">Past contract end</Badge>}
          <span>Received {date(d.receivedAt)}{d.variety && ` · ${d.variety}`}</span>
        </div>
      </div>

      {d.overdue && <div className="mb-4"><Notice>The contract ended on {date(d.contractEnd)}. {a?.lines?.find((l) => l.key === 'overdue')?.rateCentavos > 0 ? 'An overdue fee is added for every day each sack stays.' : 'Sacks still in storage may be charged an overdue fee.'}</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="My Sacks">
          <dl>
            <Row label="In storage now">{number(d.sacksStored)} of {number(d.sacksReceived)}</Row>
            {d.farmName && <Row label="From farm">{d.farmName}</Row>}
            {d.condition && <Row label="Condition">{CONDITION_LABELS[d.condition.rating]}{d.condition.notes && ` · ${d.condition.notes}`} <span className="text-xs text-muted">({date(d.condition.checkedAt)})</span></Row>}
            <Row label="Contract ends">{date(d.contractEnd)}</Row>
            {[...where.entries()].map(([code, count]) => <Row key={code} label={`Stored in ${code}`}>{number(count)} sacks</Row>)}
          </dl>
          {releases.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm">Taken out</h3>
              <ul className="text-sm">
                {releases.map((r) => <li key={r.releaseNo} className="flex justify-between gap-3 py-1"><span>{dateTime(r.at)}</span><span>{number(r.sacks)} sacks</span></li>)}
              </ul>
            </div>
          )}
        </Card>

        <Card title="What I Owe">
          <dl>
            {a.lines.filter((l) => l.discountable).map((l) => (
              <Row key={l.key} label={<>{l.label} <span className="text-xs">({quantityText(l.quantity, l.unit)} × {formatPHP(l.rateCentavos)})</span></>}>{formatPHP(l.amountCentavos)}</Row>
            ))}
            {a.discountCentavos > 0 && <Row label={`Member discount (${a.discountPercent}%)`}>−{formatPHP(a.discountCentavos)}</Row>}
            {a.autoOverdueCentavos > 0 && <Row label={<>Overdue fee <span className="text-xs">({quantityText(a.overdueSackDays, 'sack-day')})</span></>}><span className="text-critical">{formatPHP(a.autoOverdueCentavos)}</span></Row>}
            {a.lines.filter((l) => l.manual).map((l) => (
              <Row key={l.key} label={<>{l.label}{l.note && <span className="text-xs"> ({l.note})</span>}</>}>{formatPHP(l.amountCentavos)}</Row>
            ))}
            <Row label="Total" strong>{formatPHP(a.totalCentavos)}</Row>
            <Row label="Paid">−{formatPHP(a.paidCentavos + a.adjustedCentavos - a.refundedCentavos)}</Row>
            <Row label="Balance" strong><span className={a.balanceCentavos > 0 ? 'text-critical' : 'text-brand-green'}>{balanceWords(a.balanceCentavos)}</span></Row>
          </dl>
          <p className="mt-2 text-xs text-muted">As of {dateTime(a.asOf)}. Pay at the cooperative office.</p>
        </Card>

        {a.plan && (
          <Card title="My Installment Plan" className="lg:col-span-2">
            {a.plan.next && <p className="mb-3 text-sm">Next: <span className="font-semibold">{formatPHP(a.plan.next.amountCentavos - a.plan.next.paidCentavos)}</span> due {date(a.plan.next.dueDate)}</p>}
            <Schedule installments={a.plan.installments} />
          </Card>
        )}

        <Card title="My Payments and Charges" className="lg:col-span-2">
          {d.transactions.length === 0 ? <p className="text-sm text-muted">No payments or charges yet.</p> : (
            <Table minWidth={420} columns={['Date', 'Receipt No.', 'Type', 'Amount']}>
              {d.transactions.map((t) => (
                <tr key={t.id} className={t.voided ? 'text-muted line-through' : ''}>
                  <Td className="whitespace-nowrap">{date(t.paidAt)}</Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{t.receiptNo}</Td>
                  <Td>{t.type === 'charge' ? CHARGE_KIND_LABELS[t.chargeKind] ?? 'Charge' : TYPE_LABELS[t.type]}{t.method && ` (${METHOD_LABELS[t.method]})`}{t.voided && ' · cancelled'}</Td>
                  <Td className="whitespace-nowrap text-right">{amountSign(t)}{formatPHP(t.amountCentavos)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title={`All Sacks (${number(sacks.length)})`} className="lg:col-span-2">
          <Table minWidth={420} columns={['Sack', 'Where', 'Status', 'Taken out']}>
            {sacks.map((s) => (
              <tr key={s.sackNo}>
                <Td className="font-medium">Sack {s.sackNo}</Td><Td>{s.quadrantCode}</Td>
                <Td><Badge color={SACK_STATUS[s.status]?.[1] ?? 'gray'}>{SACK_STATUS[s.status]?.[0] ?? s.status}</Badge></Td>
                <Td className="whitespace-nowrap">{s.gateOutAt ? date(s.gateOutAt) : ''}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
