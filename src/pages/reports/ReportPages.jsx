import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Table, Td } from '../../components/ui.jsx';
import { date, dateTime, formatPHP, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { BATCH_STATUS } from '../inventory/labels.jsx';
import { TAG_STATUS } from '../tags/labels.jsx';
import { CHARGE_KIND_LABELS, METHOD_LABELS, PlanBadge, TYPE_LABELS, amountSign, lineText } from '../transactions/labels.jsx';
import ReportShell, { DateRange, Figures, Loading, Section, defaultRange } from './ReportShell.jsx';

const Empty = ({ children }) => <p className="py-3 text-sm text-muted">{children}</p>;
const peso = (c) => formatPHP(c);
const owed = (c) => (c > 0 ? <span className="font-medium text-critical">{formatPHP(c)}</span> : c < 0 ? `${formatPHP(-c)} credit` : 'Paid');

export function InventoryReport() {
  const { data, error } = useLoad('/reports/inventory');
  if (!data) return <Loading error={error} />;
  const { totals } = data;
  return (
    <ReportShell report="inventory" title="Inventory Report" generatedAt={data.generatedAt}>
      <Figures items={[
        ['Sacks in storage', number(totals.stored)], ['Space available', number(totals.available)],
        ['Still expected', number(totals.pending)], ['Total capacity', number(totals.capacity)],
      ]} />
      <Section title="By quadrant">
        <Table minWidth={420} columns={['Quadrant', 'Floor', 'Stored', 'Capacity', 'Available']}>
          {data.quadrants.map((q) => (
            <tr key={q.code}><Td className="font-medium">{q.code}{!q.active && ' (off)'}</Td><Td>{q.floor}</Td><Td>{number(q.stored)}</Td><Td>{number(q.capacity)}</Td><Td>{number(q.free)}</Td></tr>
          ))}
        </Table>
      </Section>
      <Section title="By farmer">
        {data.farmers.length === 0 ? <Empty>No sacks in storage.</Empty> : (
          <Table minWidth={420} columns={['Farmer', 'Member No.', 'Deliveries', 'Sacks stored']}>
            {data.farmers.map((f) => <tr key={f.memberNo ?? 'coop'}><Td className="font-medium">{f.ownerName}</Td><Td>{f.memberNo ?? ''}</Td><Td>{number(f.deliveries)}</Td><Td>{number(f.sacksStored)}</Td></tr>)}
          </Table>
        )}
      </Section>
      <Section title={`By delivery (${number(data.deliveries.length)})`}>
        {data.deliveries.length === 0 ? <Empty>No deliveries in storage.</Empty> : (
          <Table minWidth={760} columns={['Delivery No.', 'Owner', 'Received', 'Variety / size / grade', 'Sacks stored', 'Contract ends', 'Status']}>
            {data.deliveries.map((d) => (
              <tr key={d.batchNo}>
                <Td className="whitespace-nowrap">{d.batchNo}</Td><Td>{d.ownerName}</Td><Td className="whitespace-nowrap">{date(d.receivedAt)}</Td>
                <Td>{[d.variety, d.sizeClass, d.grade].filter(Boolean).join(' / ')}</Td>
                <Td>{number(d.sacksStored)} of {number(d.sacksReceived)}</Td><Td className="whitespace-nowrap">{date(d.contractEnd)}</Td>
                <Td>{BATCH_STATUS[d.status]?.[0]}{d.overdue && <span className="ml-1"><Badge color="red">Overdue</Badge></span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </ReportShell>
  );
}

export function MovementsReport() {
  const [r, setR] = useState(defaultRange);
  const { data, error } = useLoad(`/reports/movements?from=${r.from}&to=${r.to}`);
  return (
    <ReportShell report="movements" title="Movements Report" subtitle={`${date(`${r.from}T12:00:00`)} to ${date(`${r.to}T12:00:00`)}`} generatedAt={data?.generatedAt} filters={<DateRange {...r} onChange={setR} />}>
      {!data ? <Loading error={error} /> : (
        <>
          <Figures items={[['Sacks received', number(data.totals.entries)], ['Sacks moved', number(data.totals.moves)], ['Sacks released', number(data.totals.releases)], ['Days with activity', number(data.days.length)]]} />
          <Section title="By day">
            {data.days.length === 0 ? <Empty>No sacks were scanned in this period.</Empty> : (
              <Table minWidth={420} columns={['Day', 'Received', 'Moved', 'Released']}>
                {data.days.map((d) => <tr key={d.date}><Td>{date(`${d.date}T12:00:00`)}</Td><Td>{number(d.entries)}</Td><Td>{number(d.moves)}</Td><Td>{number(d.releases)}</Td></tr>)}
              </Table>
            )}
          </Section>
          {data.staff.length > 0 && (
            <Section title="By staff member">
              <Table minWidth={420} columns={['Name', 'Received', 'Moved', 'Released']}>
                {data.staff.map((s) => <tr key={s.name}><Td className="font-medium">{s.name}</Td><Td>{number(s.entries)}</Td><Td>{number(s.moves)}</Td><Td>{number(s.releases)}</Td></tr>)}
              </Table>
            </Section>
          )}
        </>
      )}
    </ReportShell>
  );
}

export function FeesReport() {
  const [r, setR] = useState(defaultRange);
  const { data, error } = useLoad(`/reports/fees?from=${r.from}&to=${r.to}`);
  return (
    <ReportShell report="fees" title="Fees and Collections" subtitle={`Collections from ${date(`${r.from}T12:00:00`)} to ${date(`${r.to}T12:00:00`)}`} generatedAt={data?.generatedAt} filters={<DateRange {...r} onChange={setR} />}>
      {!data ? <Loading error={error} /> : (
        <>
          <Section title="Collected in this period">
            <Figures items={[
              ['Payments received', peso(data.period.paymentsCentavos)], ['Refunds given', peso(data.period.refundsCentavos)],
              ['Net collected', peso(data.period.netCollectedCentavos), 'text-brand-green'], ['Waived or discounted', peso(data.period.waivedCentavos)],
            ]} />
            <div className="mt-3">
              <Table minWidth={380} columns={['Paid by', 'Payments', 'Refunds', 'Net']}>
                {data.period.byMethod.map((m) => (
                  <tr key={m.method}><Td>{METHOD_LABELS[m.method]}</Td><Td>{peso(m.paymentsCentavos)}</Td><Td>{peso(m.refundsCentavos)}</Td><Td className="font-medium">{peso(m.paymentsCentavos - m.refundsCentavos)}</Td></tr>
                ))}
              </Table>
            </div>
            {data.period.chargedCentavos > 0 && <p className="mt-2 text-xs text-muted">Manual charges added in this period (hauling, overdue, other): {peso(data.period.chargedCentavos)}. These are owed, not collected.</p>}
            {data.period.voidedEntries > 0 && <p className="mt-2 text-xs text-muted">{number(data.period.voidedEntries)} voided {data.period.voidedEntries === 1 ? 'entry is' : 'entries are'} not counted.</p>}
          </Section>
          <Section title="Balances as of today">
            <Figures items={[
              ['Unpaid balances', peso(data.asOfToday.outstandingCentavos), 'text-critical'], ['Deliveries owing', number(data.asOfToday.unpaidDeliveries)],
              ['Overdue fees so far', peso(data.asOfToday.overdueFeesCentavos)], ['Late on installments', number(data.asOfToday.latePlans)],
            ]} />
            <div className="mt-3">
              {data.deliveries.length === 0 ? <Empty>No charges yet.</Empty> : (
                <Table minWidth={720} columns={['Delivery No.', 'Farmer', 'Charges', 'Of which overdue', 'Paid, waived, or discounted', 'Balance']}>
                  {data.deliveries.map((d) => (
                    <tr key={d.batchNo}>
                      <Td className="whitespace-nowrap">{d.batchNo}</Td><Td>{d.ownerName}</Td><Td>{peso(d.totalCentavos)}</Td>
                      <Td>{d.overdueCentavos ? peso(d.overdueCentavos) : ''}</Td><Td>{peso(d.creditedCentavos)}</Td>
                      <Td className="whitespace-nowrap">{owed(d.balanceCentavos)}{d.planStatus && <span className="ml-1"><PlanBadge status={d.planStatus} /></span>}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </Section>
        </>
      )}
    </ReportShell>
  );
}

export function OverdueReport() {
  const { data, error } = useLoad('/reports/overdue');
  if (!data) return <Loading error={error} />;
  return (
    <ReportShell report="overdue" title="Overdue Deliveries" subtitle="Past the contract end, with sacks still in storage" generatedAt={data.generatedAt}>
      <Figures items={[
        ['Deliveries', number(data.totals.deliveries)], ['Sacks', number(data.totals.sacks)],
        ['Overdue fees so far', peso(data.totals.overdueCentavos), 'text-critical'], ['Still owed', peso(data.totals.balanceCentavos)],
      ]} />
      {data.deliveries.length === 0 ? <Empty>No deliveries are overdue.</Empty> : (
        <Table minWidth={820} columns={['Delivery No.', 'Farmer', 'Mobile', 'Contract ended', 'Days overdue', 'Sacks', 'Overdue fees', 'Balance']}>
          {data.deliveries.map((d) => (
            <tr key={d.batchNo}>
              <Td className="whitespace-nowrap">{d.batchNo}</Td><Td>{d.ownerName}</Td><Td className="whitespace-nowrap">{d.phone}</Td>
              <Td className="whitespace-nowrap">{date(d.contractEnd)}</Td><Td>{number(d.daysOverdue)}</Td><Td>{number(d.sacksStored)}</Td>
              <Td>{peso(d.overdueCentavos)}</Td><Td className="whitespace-nowrap">{owed(d.balanceCentavos)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </ReportShell>
  );
}

export function TagsReport() {
  const { data, error } = useLoad('/reports/tags');
  if (!data) return <Loading error={error} />;
  const { totals, reuse } = data;
  return (
    <ReportShell report="tags" title="Tags Report" generatedAt={data.generatedAt} personal={false}>
      <Figures items={[['All tags', number(totals.all)], ['Available', number(totals.available)], ['On sacks', number(totals.assigned)], ['Damaged or lost', number(totals.damaged + totals.lost), totals.damaged + totals.lost ? 'text-critical' : '']]} />
      <p className="text-sm text-muted">
        {number(reuse.usedAtLeastOnce)} tags have been used at least once, {number(reuse.totalUses)} times in all
        {reuse.usedAtLeastOnce ? ` (${reuse.averageUses} ${reuse.averageUses === 1 ? 'use' : 'uses'} each on average, ${number(reuse.mostUses)} at most)` : ''}. {number(totals.retired)} retired.
      </p>
      <Section title="By lot">
        {data.lots.length === 0 ? <Empty>No tag lots yet.</Empty> : (
          <Table minWidth={640} columns={['Lot', 'Codes', 'Tags', 'Available', 'On sacks', 'Damaged', 'Lost', 'Retired']}>
            {data.lots.map((l) => (
              <tr key={l.lotNo}>
                <Td className="whitespace-nowrap font-medium">Lot {l.lotNo}{l.source === 'imported' && ' (pre-printed)'}</Td>
                <Td className="whitespace-nowrap font-mono text-xs">{l.firstCode} to {l.lastCode}</Td>
                <Td>{number(l.quantity)}</Td><Td>{number(l.available)}</Td><Td>{number(l.assigned)}</Td><Td>{number(l.damaged)}</Td><Td>{number(l.lost)}</Td><Td>{number(l.retired)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <Section title="Damaged or lost tags">
        {data.problems.length === 0 ? <Empty>None.</Empty> : (
          <Table minWidth={420} columns={['Tag', 'Status', 'Lot', 'Last scanned']}>
            {data.problems.map((t) => (
              <tr key={t.code}><Td className="font-mono text-xs">{t.code}</Td><Td><Badge color={TAG_STATUS[t.status][1]}>{TAG_STATUS[t.status][0]}</Badge></Td><Td>{t.lotNo ? `Lot ${t.lotNo}` : ''}</Td><Td>{dateTime(t.lastScannedAt)}</Td></tr>
            ))}
          </Table>
        )}
      </Section>
    </ReportShell>
  );
}

export function MembersReport() {
  const { data, error } = useLoad('/reports/members');
  if (!data) return <Loading error={error} />;
  const { totals } = data;
  return (
    <ReportShell report="members" title="Farmer Masterlist" generatedAt={data.generatedAt}>
      <Figures items={[['All farmers', number(totals.all)], ['Members', number(totals.members)], ['Guests', number(totals.guests)], ['Inactive', number(totals.inactive)]]} />
      {data.members.length === 0 ? <Empty>No farmers yet.</Empty> : (
        <Table minWidth={1000} columns={['Member No.', 'Name', 'Type', 'Mobile', 'Address', 'Farm (ha)', 'RSBSA No.', 'Deliveries', 'Sacks stored', 'Balance']}>
          {data.members.map((m) => (
            <tr key={m.memberNo} className={m.status === 'inactive' ? 'text-muted' : ''}>
              <Td className="whitespace-nowrap">{m.memberNo}</Td><Td className="font-medium">{m.name}{m.status === 'inactive' && ' (inactive)'}</Td>
              <Td>{m.tier === 'guest' ? 'Guest' : 'Member'}</Td><Td className="whitespace-nowrap">{m.phone}</Td><Td>{m.address}</Td>
              <Td>{m.farmAreaHa ?? ''}</Td><Td className="whitespace-nowrap">{m.rsbsaNo}</Td><Td>{number(m.deliveries)}</Td><Td>{number(m.sacksStored)}</Td>
              <Td className="whitespace-nowrap">{m.deliveries ? owed(m.balanceCentavos) : ''}</Td>
            </tr>
          ))}
        </Table>
      )}
    </ReportShell>
  );
}

export function StatementReport() {
  const { memberId } = useParams();
  const { data, error } = useLoad(`/reports/statement/${memberId}`);
  if (!data) return <Loading error={error} />;
  const { member } = data;
  return (
    <ReportShell
      report="statement" printBody={{ memberId }} back={`/farmers/${memberId}`}
      title="Statement of Account" subtitle={`${member.name} · ${member.memberNo}`} generatedAt={data.generatedAt}
    >
      <StatementBody data={data} />
    </ReportShell>
  );
}

// The statement itself: used by the cooperative's report and the farmer's My Fees page.
export function StatementBody({ data, signatures = true }) {
  const { member, totals } = data;
  return (
    <>
      <dl className="grid gap-x-8 text-sm sm:grid-cols-2 print:grid-cols-2">
        {[['Farmer', member.name], ['Member No.', member.memberNo], ['Type', member.tier === 'guest' ? 'Guest' : 'Member'], ['Mobile', member.phone], ['Address', member.address], ['Sacks in storage', number(totals.sacksStored)]]
          .map(([l, v]) => <div key={l} className="flex justify-between gap-4 border-b border-line py-1.5"><dt className="text-muted">{l}</dt><dd className="text-right font-medium">{v || '—'}</dd></div>)}
      </dl>
      <Figures items={[
        ['Charges', peso(totals.chargesCentavos)], ['Paid', peso(totals.paidCentavos)],
        ['Waived', peso(totals.adjustedCentavos)], ['Refunded', peso(totals.refundedCentavos)],
        ['Balance', totals.balanceCentavos > 0 ? peso(totals.balanceCentavos) : totals.balanceCentavos < 0 ? `${peso(-totals.balanceCentavos)} credit` : 'Paid', totals.balanceCentavos > 0 ? 'text-critical' : 'text-brand-green'],
      ]} />
      {data.deliveries.length === 0 ? <Empty>This farmer has no deliveries.</Empty> : data.deliveries.map((d) => (
        <Section key={d.batchNo} title={`${d.batchNo} · received ${date(d.receivedAt)}`}>
          <p className="-mt-1 mb-2 text-xs text-muted">
            {BATCH_STATUS[d.status]?.[0]} · {number(d.sacksStored)} of {number(d.sacksReceived)} sacks in storage · contract ends {date(d.contractEnd)}
          </p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {/* The discount applies to the lines above it; the overdue fee comes after, undiscounted. */}
              {[...d.account.lines.filter((l) => l.discountable), 'discount', ...d.account.lines.filter((l) => !l.discountable && (l.key !== 'overdue' || l.amountCentavos > 0))].map((l) => (l === 'discount'
                ? d.account.discountCentavos > 0 && <tr key="discount"><td className="py-1.5 text-muted">Member discount ({d.account.discountPercent}%)</td><td className="py-1.5 text-right">−{peso(d.account.discountCentavos)}</td></tr>
                : <tr key={l.key}><td className="py-1.5">{l.label}{lineText(l, peso).detail && <span className="text-muted"> ({lineText(l, peso).detail})</span>}{l.manual && l.date && <span className="text-muted"> · {date(l.date)}</span>}</td><td className="py-1.5 text-right">{peso(l.amountCentavos)}</td></tr>))}
              <tr className="font-semibold"><td className="py-1.5">Charges</td><td className="py-1.5 text-right">{peso(d.account.totalCentavos)}</td></tr>
              {/* Charges are listed above with the fees; here only money paid, waived, or refunded. */}
              {d.transactions.filter((t) => t.type !== 'charge').map((t) => (
                <tr key={t.id} className={t.voided ? 'text-muted line-through' : ''}>
                  <td className="py-1.5">{date(t.paidAt)} · {t.type === 'charge' ? CHARGE_KIND_LABELS[t.chargeKind] ?? 'Charge' : TYPE_LABELS[t.type]}{t.method ? ` (${METHOD_LABELS[t.method]})` : ''} · <span className="font-mono text-xs">{t.receiptNo}</span>{t.voided && ' · voided'}</td>
                  <td className="py-1.5 text-right">{amountSign(t)}{peso(t.amountCentavos)}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-1.5">Balance</td><td className="py-1.5 text-right">{owed(d.account.balanceCentavos)}</td></tr>
            </tbody>
          </table>
          {d.account.plan && <p className="mt-2 text-xs text-muted">On an installment plan: {peso(d.account.plan.paidCentavos)} of {peso(d.account.plan.totalCentavos)} paid{d.account.plan.next ? `; next ${peso(d.account.plan.next.amountCentavos - d.account.plan.next.paidCentavos)} due ${date(d.account.plan.next.dueDate)}` : ''}.</p>}
        </Section>
      ))}
      {signatures && (
      <div className="grid grid-cols-2 gap-10 pt-8 text-center text-xs text-muted">
        <div><div className="border-t border-ink pt-1">Prepared by (name and signature)</div></div>
        <div><div className="border-t border-ink pt-1">Received by farmer (name and signature)</div></div>
      </div>
      )}
    </>
  );
}
