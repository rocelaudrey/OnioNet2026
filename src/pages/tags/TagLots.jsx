import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, Printer, Upload } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import Scanner from '../../components/Scanner.jsx';
import { Badge, Button, Field, Modal, Notice, Table, Td, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, number } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';
import { useLoad, useSave } from '../../lib/useLoad.js';

function GenerateForm({ maxLotSize, onDone, onClose }) {
  const save = useSave();
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => onDone((await api('/tag-lots', { method: 'POST', body: { quantity: Number(quantity), notes } })).lot));
  };
  return (
    <Modal title="Make New Tags" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-muted">This creates new tag codes with the next numbers in line. Print the sheet afterwards and attach the QR codes to your PVC tags.</p>
        <TextField
          label="How many tags" type="number" min="1" max={maxLotSize} step="1" required
          value={quantity} onChange={(e) => setQuantity(e.target.value)} hint={`Up to ${number(maxLotSize)} at a time.`}
        />
        <TextField label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. First order from the printer" />
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Making tags…' : 'Make Tags'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Reads the first column of each CSV line; drops a header line and blanks.
function codesFromText(text) {
  return text.split(/\r?\n/)
    .map((line) => line.split(',')[0].replace(/^["'\s]+|["'\s]+$/g, ''))
    .filter((cell, index) => cell && !(index === 0 && /^(tag|code|tag code|tag id)$/i.test(cell)));
}

function ImportForm({ onDone, onClose }) {
  const save = useSave();
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [problems, setProblems] = useState([]);
  const [scanning, setScanning] = useState(false);
  const codes = codesFromText(text);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
    e.target.value = '';
  };
  const onScan = (scanned) => {
    if (codesFromText(text).includes(scanned)) return { kind: 'warning', message: 'Already in the list.' };
    setText((current) => (current.trim() ? `${current.trim()}\n${scanned}` : scanned));
    return { kind: 'ok', message: `Added ${scanned.split('.')[0]}` };
  };
  const onSubmit = (e) => {
    e.preventDefault();
    setProblems([]);
    save.run(async () => {
      try {
        onDone((await api('/tag-lots/import', { method: 'POST', body: { entries: codes, notes } })).lot);
      } catch (err) {
        setProblems(err.details ?? []);
        throw err;
      }
    });
  };

  return (
    <Modal title="Import Pre-printed Tags" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-muted">Register tags that were printed elsewhere. Upload a CSV file with one tag code per line, paste the codes, or scan the tags one by one.</p>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-page">
            <Upload size={16} /> Choose CSV File
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={onFile} />
          </label>
          <Button variant="secondary" onClick={() => setScanning(!scanning)}>{scanning ? 'Hide Scanner' : 'Scan Tags'}</Button>
        </div>
        {scanning && <Scanner onScan={onScan} allowTyping={false} />}
        <Field label={`Tag codes (${number(codes.length)})`}>
          <textarea
            rows={6} className={`${inputClass} font-mono`} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'FAF-000123-K\nFAF-000124-L'} spellCheck={false}
          />
        </Field>
        <TextField label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Notice>{save.error}</Notice>
        {problems.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-3 text-xs">
            {problems.map((p) => (
              <li key={p.line}><span className="font-medium">Line {p.line}</span> <span className="font-mono">{p.text}</span>: {p.problem}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy || codes.length === 0}>{save.busy ? 'Importing…' : `Import ${number(codes.length)} Tags`}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function TagLots({ onChanged }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad('/tag-lots');
  const [dialog, setDialog] = useState(null); // 'generate' | 'import'
  const [made, setMade] = useState(null);
  const isAdmin = user.role === 'coop_admin';
  const canImport = isAdmin && user.features.includes('tag_import');

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <Notice>{error}</Notice>;

  const done = (lot) => {
    setDialog(null);
    setMade(lot);
    reload();
    onChanged?.();
  };

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base">Tag Lots</h2>
          <p className="text-xs text-muted">Each lot is a set of tags made or registered together.</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {canImport && <Button variant="secondary" onClick={() => setDialog('import')}><Upload size={16} /> Import Tags</Button>}
            <Button onClick={() => setDialog('generate')}><Plus size={16} /> Make New Tags</Button>
          </div>
        )}
      </div>

      {made && (
        <div className="mb-4">
          <Notice kind="success">
            Lot {made.lotNo} is ready: {number(made.quantity)} tags, {made.firstCode} to {made.lastCode}.
            {made.source === 'generated' && <> <Link className="font-medium underline" to={`/qr-tags/lots/${made.id}/print`}>Open the print sheet</Link></>}
          </Notice>
        </div>
      )}

      {data.lots.length === 0 ? (
        <EmptyState icon={Layers} title="No tag lots yet" detail={isAdmin ? 'Make your first set of tags, then print the sheet.' : 'A Cooperative Admin can make tags here.'} />
      ) : (
        <Table minWidth={760} columns={['Lot', 'Type', 'Tags', 'Codes', 'Created', 'Printed', '']}>
          {data.lots.map((lot) => (
            <tr key={lot.id}>
              <Td className="whitespace-nowrap font-medium">Lot {lot.lotNo}</Td>
              <Td>{lot.source === 'imported' ? <Badge color="orange">Pre-printed</Badge> : <Badge color="purple">Made here</Badge>}</Td>
              <Td>{number(lot.quantity)}</Td>
              <Td className="whitespace-nowrap font-mono text-xs">{lot.firstCode}{lot.quantity > 1 && <> to {lot.lastCode}</>}</Td>
              <Td className="whitespace-nowrap">{date(lot.createdAt)}<span className="block text-xs text-muted">{lot.createdByName}</span></Td>
              <Td className="whitespace-nowrap">{lot.printedAt ? date(lot.printedAt) : <span className="text-muted">Not yet</span>}</Td>
              <Td className="text-right">
                {isAdmin && lot.source === 'generated' && (
                  <Link to={`/qr-tags/lots/${lot.id}/print`} className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-page">
                    <Printer size={16} /> Print
                  </Link>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {dialog === 'generate' && <GenerateForm maxLotSize={data.maxLotSize} onDone={done} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportForm onDone={done} onClose={() => setDialog(null)} />}
    </Card>
  );
}
