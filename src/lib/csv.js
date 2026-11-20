// Turns the tables of a report, as shown on screen, into a CSV file for Excel
// or other programs. Using what is shown keeps the numbers identical to the
// printed report; peso amounts become plain numbers so they can be added up.

const MONEY = /^([−-])?₱([\d,]+\.\d{2})$/;

function cellValue(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const money = MONEY.exec(t);
  if (money) return `${money[1] ? '-' : ''}${money[2].replaceAll(',', '')}`;
  return t;
}

// Text that a spreadsheet would run as a formula is prefixed with ' (CSV injection).
function quote(value) {
  let v = value;
  if (/^[=+@\t\r]/.test(v) || /^-(?!\d)/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

// Rows for every table inside `root`, each table under its section heading.
export function tablesToRows(root) {
  const rows = [];
  for (const table of root.querySelectorAll('table')) {
    const heading = table.closest('section')?.querySelector('h2')?.textContent?.trim();
    if (rows.length) rows.push([]);
    if (heading) rows.push([heading]);
    for (const tr of table.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('th, td')].map((c) => cellValue(c.textContent ?? ''));
      if (cells.some(Boolean)) rows.push(cells);
    }
  }
  return rows;
}

export function toCsv(rows) {
  return rows.map((r) => r.map((v) => quote(String(v ?? ''))).join(',')).join('\r\n');
}

export function downloadCsv(filename, rows) {
  // The byte-order mark makes Excel read ₱ and ñ correctly.
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
