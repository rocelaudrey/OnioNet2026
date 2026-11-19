import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import { Button, Table, Td } from '../../components/ui.jsx';
import { date, formatPHP } from '../../lib/format.js';
import RecordPayment from './RecordPayment.jsx';
import PlanCard from './PlanCard.jsx';
import { BalanceText, METHOD_LABELS, TypeBadge, amountSign, lineText, quantityText } from './labels.jsx';

function Row({ label, value, strong, muted }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 text-sm ${strong ? 'border-t border-line pt-2.5 font-semibold' : ''}`}>
      <dt className={muted ? 'text-muted' : ''}>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

// Charges, payments, and balance for one delivery. Every number here comes
// from the fee service on the server.
export default function AccountCard({ batch, account, transactions, onChanged }) {
  const navigate = useNavigate();
  const [recording, setRecording] = useState(null); // 'payment' | 'charge'
  if (batch.ownerType === 'coop_owned') return null;
  const canPay = batch.status !== 'cancelled';
  const credits = account.paidCentavos + account.adjustedCentavos - account.refundedCentavos;

  return (
    <Card className="lg:col-span-3">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base">Fees and Payments</h2>
          <p className="text-xs text-muted">Worked out as of {date(account.asOf)}.{account.lines.find((l) => l.key === 'overdue')?.rateCentavos > 0 && ' Overdue fees grow each day a sack stays past the contract end.'}</p>
        </div>
        {canPay && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setRecording('charge')}><Plus size={16} /> Add Charge</Button>
            <Button onClick={() => setRecording('payment')}><Plus size={16} /> Record Payment</Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <dl>
          {account.lines.filter((l) => l.discountable).map((l) => (
            <Row key={l.key} label={<>{l.label} <span className="text-muted">({lineText(l, formatPHP).detail})</span></>} value={formatPHP(l.amountCentavos)} />
          ))}
          {account.discountCentavos > 0 && <Row label={`Member discount (${account.discountPercent}%)`} value={`−${formatPHP(account.discountCentavos)}`} muted />}
          {account.autoOverdueCentavos > 0 && (
            <Row
              label={<>Overdue fee <span className="text-muted">({quantityText(account.overdueSackDays, 'sack-day')} on {account.overdueSacks} {account.overdueSacks === 1 ? 'sack' : 'sacks'} × {formatPHP(account.lines.find((l) => l.key === 'overdue').rateCentavos)})</span></>}
              value={<span className="text-critical">{formatPHP(account.autoOverdueCentavos)}</span>}
            />
          )}
          {account.lines.filter((l) => l.manual).map((l) => (
            <Row key={l.key} label={<>{l.label} <span className="text-muted">{[l.date && date(l.date), l.note].filter(Boolean).join(' · ')}</span></>} value={formatPHP(l.amountCentavos)} />
          ))}
          <Row label="Total charges" value={formatPHP(account.totalCentavos)} strong />
          <Row label="Paid, waived, or discounted" value={`−${formatPHP(credits)}`} muted />
          <Row label="Balance" value={<BalanceText centavos={account.balanceCentavos} format={formatPHP} />} strong />
        </dl>

        <div>
          <h3 className="mb-2 text-sm">Payments and charges</h3>
          {transactions.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
            <Table minWidth={420} columns={['Receipt', 'Date', 'Type', 'Amount']}>
              {transactions.map((t) => (
                <tr
                  key={t.id} tabIndex={0} role="link" aria-label={`Open receipt ${t.receiptNo}`}
                  onClick={() => navigate(`/transactions/${t.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/transactions/${t.id}`)}
                  className={`cursor-pointer hover:bg-page focus:bg-page focus:outline-none ${t.voided ? 'text-muted line-through' : ''}`}
                >
                  <Td className="whitespace-nowrap font-mono text-xs">{t.receiptNo}</Td>
                  <Td className="whitespace-nowrap">{date(t.paidAt)}</Td>
                  <Td><TypeBadge type={t.type} voided={t.voided} />{t.method && <span className="ml-1 text-xs text-muted">{METHOD_LABELS[t.method]}</span>}</Td>
                  <Td className="whitespace-nowrap text-right">{amountSign(t)}{formatPHP(t.amountCentavos)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>

      <PlanCard batch={batch} account={account} onChanged={onChanged} />

      {recording && (
        <RecordPayment
          delivery={{ id: batch.id, batchNo: batch.batchNo, ownerName: batch.ownerName, balanceCentavos: account.balanceCentavos }}
          initialType={recording}
          onClose={() => setRecording(null)}
          onDone={(t) => navigate(`/transactions/${t.id}`)}
        />
      )}
    </Card>
  );
}
