import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button, Notice } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';

// The QR print sheet is drawn here in the browser, not on the server.
// "Print" opens the browser's print dialog, which can also save a PDF.
export default function PrintSheet() {
  const { id } = useParams();
  const { data, error, loading } = useLoad(`/tag-lots/${id}/print`);
  const [images, setImages] = useState(null);

  useEffect(() => {
    if (!data) return;
    let current = true;
    Promise.all(data.tags.map((tag) => QRCode.toDataURL(tag.qr, { errorCorrectionLevel: 'Q', margin: 4, width: 360 })))
      .then((urls) => current && setImages(urls));
    return () => { current = false; };
  }, [data]);

  const back = (
    <Link to="/qr-tags?tab=lots" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> Tag lots
    </Link>
  );
  if (loading) return <>{back}<p className="mt-4 text-sm text-muted">Loading…</p></>;
  if (error) return <>{back}<div className="mt-4"><Notice>{error}</Notice></div></>;
  const { lot, tags } = data;

  const onPrint = async () => {
    await api(`/tag-lots/${id}/printed`, { method: 'POST' }).catch(() => {});
    window.print();
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          {back}
          <h1 className="mt-2 text-2xl">Lot {lot.lotNo} Print Sheet</h1>
          <p className="text-sm text-muted">{number(tags.length)} tags · {lot.firstCode} to {lot.lastCode}</p>
        </div>
        <Button onClick={onPrint} disabled={!images}><Printer size={16} /> Print or Save as PDF</Button>
      </div>
      <p className="mb-4 text-xs text-muted print:hidden">
        Print at 100% scale on A4. Each QR code holds only the tag code and a security code, never farmer or batch details.
      </p>

      {!images ? <p className="text-sm text-muted">Drawing QR codes…</p> : (
        <div className="grid grid-cols-3 gap-2 bg-white p-3 sm:grid-cols-4 print:grid-cols-4 print:gap-0 print:p-0">
          {tags.map((tag, index) => (
            <div key={tag.code} className="flex break-inside-avoid flex-col items-center border border-dashed border-line p-2 text-center">
              <img src={images[index]} alt={`QR code for tag ${tag.code}`} className="w-full max-w-[34mm]" />
              <p className="mt-1 font-mono text-[11px] font-semibold leading-tight text-ink">{tag.code}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
