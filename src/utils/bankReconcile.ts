import type { Invoice } from '../types';

export interface ParsedBankTransaction {
  id: string;
  date: string;
  payer: string;
  purpose: string;
  amount: number;
}

export interface BankReconcileMatch {
  transaction: ParsedBankTransaction;
  invoice: Invoice;
  confidence: 'exact_number' | 'amount_and_name' | 'amount_only';
  reason: string;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseGermanNumber(raw: string): number | null {
  if (!raw) return null;
  let cleaned = raw
    .replace(/\s+/g, '')
    .replace(/EUR|€/gi, '')
    .replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;

  // Handle German 1.234,56 vs English 1,234.56
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma !== -1) {
    cleaned = cleaned.replace(/,/g, '');
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
}

function normalizeDateString(raw: string): string {
  const s = raw.trim();
  const deMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (deMatch) {
    const dd = deMatch[1].padStart(2, '0');
    const mm = deMatch[2].padStart(2, '0');
    const yy = deMatch[3].length === 2 ? `20${deMatch[3]}` : deMatch[3];
    return `${yy}-${mm}-${dd}`;
  }
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return s;
}

export function parseBankStatementCsv(csvText: string): ParsedBankTransaction[] {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const rawLines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length < 2) return [];

  // Find header line (German bank CSVs often have 3-10 metadata lines above the header)
  let headerIdx = -1;
  let delimiter = ';';

  for (let i = 0; i < Math.min(25, rawLines.length); i++) {
    const line = rawLines[i];
    const semiCount = (line.match(/;/g) || []).length;
    const commaCount = (line.match(/,/g) || []).length;
    const candDelim = semiCount >= commaCount && semiCount >= 2 ? ';' : ',';
    const cols = parseCsvLine(line, candDelim).map((c) => c.toLowerCase());
    const hasAmount = cols.some((c) =>
      /betrag|umsatz|haben|gutschrift|amount|eingang/i.test(c)
    );
    const hasDateOrPurpose = cols.some((c) =>
      /buchung|valuta|datum|date|verwendungszweck|auftraggeber|empfänger|zahler|purpose/i.test(
        c
      )
    );
    if (cols.length >= 3 && hasAmount && hasDateOrPurpose) {
      headerIdx = i;
      delimiter = candDelim;
      break;
    }
  }

  if (headerIdx === -1) {
    // Fallback: first line with >= 3 columns
    headerIdx = 0;
    const semi = (rawLines[0].match(/;/g) || []).length;
    const comma = (rawLines[0].match(/,/g) || []).length;
    delimiter = semi >= comma ? ';' : ',';
  }

  const headers = parseCsvLine(rawLines[headerIdx], delimiter).map((h) =>
    h.toLowerCase()
  );

  const findCol = (regex: RegExp): number => headers.findIndex((h) => regex.test(h));

  const dateCol = findCol(/buchungstag|buchungsdatum|valuta|wertstellung|datum|date/i);
  const amountCol = findCol(/^betrag|betrag\s*\(|umsatz|amount/i);
  const creditCol = findCol(/haben|gutschrift|eingang|credit/i);
  const payerCol = findCol(
    /begünstigter|auftraggeber|zahlungspflichtiger|name|empfänger|partner|sender|counterparty/i
  );
  const purposeCol = findCol(
    /verwendungszweck|buchungstext|beschreibung|referenz|purpose|info|notiz/i
  );

  const transactions: ParsedBankTransaction[] = [];

  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const cells = parseCsvLine(rawLines[i], delimiter);
    if (cells.length < 2) continue;

    let amount: number | null = null;
    if (amountCol >= 0 && cells[amountCol]) {
      amount = parseGermanNumber(cells[amountCol]);
    }
    if ((amount === null || amount === 0) && creditCol >= 0 && cells[creditCol]) {
      const creditVal = parseGermanNumber(cells[creditCol]);
      if (creditVal !== null && creditVal > 0) {
        amount = creditVal;
      }
    }

    // Fallback scan for first plausible currency value if header names were unusual
    if (amount === null) {
      for (let c = cells.length - 1; c >= 0; c--) {
        if (/^-?[\d.]+,\d{2}(\s*€|\s*EUR)?$/.test(cells[c])) {
          amount = parseGermanNumber(cells[c]);
          if (amount !== null) break;
        }
      }
    }

    // Only keep positive incoming payments (Gutschriften)
    if (amount === null || amount <= 0) continue;

    const date = dateCol >= 0 && cells[dateCol] ? normalizeDateString(cells[dateCol]) : '';
    const payer = payerCol >= 0 && cells[payerCol] ? cells[payerCol] : '';
    const purpose =
      purposeCol >= 0 && cells[purposeCol]
        ? cells[purposeCol]
        : cells.filter((_, idx) => idx !== dateCol && idx !== amountCol).join(' · ');

    transactions.push({
      id: `tx-${i}`,
      date,
      payer,
      purpose,
      amount,
    });
  }

  return transactions;
}

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function matchBankTransactionsToInvoices(
  transactions: ParsedBankTransaction[],
  invoices: Invoice[]
): BankReconcileMatch[] {
  const openInvoices = invoices.filter(
    (inv) =>
      inv.documentType !== 'quote' &&
      !inv.isArchived &&
      (inv.status === 'Gesendet' || inv.status === 'Entwurf')
  );

  const matches: BankReconcileMatch[] = [];
  const usedInvoiceIds = new Set<string>();

  for (const tx of transactions) {
    const combinedNorm = normalizeToken(`${tx.purpose} ${tx.payer}`);
    const payerNorm = normalizeToken(`${tx.payer} ${tx.purpose}`);

    // 1) Exact invoice number match in purpose/payer
    let bestMatch: BankReconcileMatch | null = null;
    for (const inv of openInvoices) {
      if (usedInvoiceIds.has(inv.id)) continue;
      const payable = inv.isSmallBusiness ? inv.netTotal : inv.grossTotal;
      const numNorm = normalizeToken(inv.invoiceNumber);
      const amountMatches = Math.abs(tx.amount - payable) <= 0.02;

      if (numNorm.length >= 4 && combinedNorm.includes(numNorm)) {
        bestMatch = {
          transaction: tx,
          invoice: inv,
          confidence: 'exact_number',
          reason: amountMatches
            ? `Rechnungsnummer ${inv.invoiceNumber} & Betrag exakt gefunden`
            : `Rechnungsnummer ${inv.invoiceNumber} gefunden (Teil-/Abweichung: ${tx.amount.toFixed(2)} €)`,
        };
        break;
      }
    }

    // 2) Exact amount + customer name word match
    if (!bestMatch) {
      for (const inv of openInvoices) {
        if (usedInvoiceIds.has(inv.id)) continue;
        const payable = inv.isSmallBusiness ? inv.netTotal : inv.grossTotal;
        if (Math.abs(tx.amount - payable) > 0.02) continue;

        const nameTokens = inv.customerSnapshot.companyName
          .toLowerCase()
          .split(/[^a-zäöüß0-9]+/)
          .filter((w) => w.length >= 4 && !/^(gmbh|ug|ag|gbr|ohg|kg|co)$/.test(w));

        const nameHit = nameTokens.some((tok) => payerNorm.includes(normalizeToken(tok)));
        if (nameHit) {
          bestMatch = {
            transaction: tx,
            invoice: inv,
            confidence: 'amount_and_name',
            reason: `Betrag (${payable.toFixed(2)} €) & Kundenname stimmen überein`,
          };
          break;
        }
      }
    }

    // 3) Unique exact amount match
    if (!bestMatch) {
      const amountCandidates = openInvoices.filter((inv) => {
        if (usedInvoiceIds.has(inv.id)) return false;
        const payable = inv.isSmallBusiness ? inv.netTotal : inv.grossTotal;
        return Math.abs(tx.amount - payable) <= 0.02;
      });
      if (amountCandidates.length === 1) {
        const inv = amountCandidates[0];
        bestMatch = {
          transaction: tx,
          invoice: inv,
          confidence: 'amount_only',
          reason: `Eindeutiger Rechnungsbetrag (${tx.amount.toFixed(2)} €)`,
        };
      }
    }

    if (bestMatch) {
      usedInvoiceIds.add(bestMatch.invoice.id);
      matches.push(bestMatch);
    }
  }

  return matches;
}
