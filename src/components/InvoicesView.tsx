import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowRightCircle,
  Car,
  CheckCircle2,
  ChevronDown,
  Clock,
  CloudUpload,
  Download,
  Eye,
  FileCheck2,
  FileCode2,
  FilePlus2,
  FileSpreadsheet,
  MapPin,
  PenTool,
  Pencil,
  Percent,
  Plus,
  Printer,
  Receipt,
  Share2,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  AcceptanceSignature,
  CompanyProfile,
  Customer,
  DiscountType,
  DocumentType,
  Expense,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  NextcloudConfigInfo,
  Product,
  TaxRate,
  TimeEntry,
  TimeRoundingMinutes,
  UnitType,
} from '../types';
import {
  INVOICE_ACCENT_STYLES,
  INVOICE_FONT_OPTIONS,
  addDaysISO,
  calculateDocumentTotals,
  createId,
  formatCurrency,
  formatDateDE,
  formatDateTimeDE,
  formatDuration,
  formatInvoiceNumber,
  formatNumber,
  formatQuoteNumber,
  getOverdueDays,
  isInvoiceOverdue,
  roundDurationSeconds,
  toInputDate,
} from '../utils/format';
import {
  apiUploadInvoicePdf,
  apiUploadInvoiceTextFile,
} from '../utils/apiClient';
import { computeTravelFromBase } from '../utils/geolocation';
import {
  downloadAcceptanceProtocolPdf,
  downloadInvoicePdf,
  downloadPaymentReminderPdf,
  downloadTimesheetPdf,
  getAcceptanceProtocolPdfBase64,
  getInvoicePdfBase64,
  printInvoiceView,
  shareAcceptanceProtocolPdf,
  shareInvoicePdf,
} from '../utils/pdfInvoice';
import { buildXRechnungXml } from '../utils/eInvoiceXml';
import {
  downloadOrShareTextFile,
  invoicesToCsv,
} from '../utils/exportBackup';
import { generateGiroCodeDataUrl } from '../utils/epcQr';
import { SignaturePadModal } from './SignaturePadModal';
import { ThemedSelect } from './ThemedSelect';

interface InvoicesViewProps {
  company: CompanyProfile;
  customers: Customer[];
  products: Product[];
  timeEntries: TimeEntry[];
  expenses?: Expense[];
  invoices: Invoice[];
  nextcloud: NextcloudConfigInfo;
  preselectedDraft: { customerId: string; entryIds: string[] } | null;
  onClearPreselectedDraft: () => void;
  onCreateInvoice: (
    invoice: Invoice,
    billedEntryIds: string[],
    billedExpenseIds?: string[],
    billedTravelEntryIds?: string[]
  ) => void;
  onUpdateInvoice: (
    invoice: Invoice,
    billedEntryIds: string[],
    billedExpenseIds?: string[],
    billedTravelEntryIds?: string[]
  ) => void;
  onUpdateInvoiceStatus: (invoiceId: string, status: InvoiceStatus) => void;
  onMarkInvoiceUploaded: (invoiceId: string, uploadedAt: string) => void;
  onSaveSignature?: (invoiceId: string, signature: AcceptanceSignature) => void;
  onDeleteSignature?: (invoiceId: string) => void;
  onToggleArchiveInvoice?: (invoiceId: string) => void;
  onDeleteInvoice: (invoiceId: string) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

interface ExtraProductDraft {
  id: string;
  productId: string;
  description: string;
  detail?: string;
  unit?: UnitType;
  quantity: number;
  unitPriceNet: number;
  taxRate: TaxRate;
}

export function InvoicesView({
  company,
  customers,
  products,
  timeEntries,
  expenses = [],
  invoices,
  nextcloud,
  preselectedDraft,
  onClearPreselectedDraft,
  onCreateInvoice,
  onUpdateInvoice,
  onUpdateInvoiceStatus,
  onMarkInvoiceUploaded,
  onSaveSignature,
  onDeleteSignature,
  onToggleArchiveInvoice,
  onDeleteInvoice,
  onNotify,
}: InvoicesViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus | 'Überfällig'>('all');
  const [docFilter, setDocFilter] = useState<'all' | 'invoice' | 'quote'>('all');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [showPreviewMenu, setShowPreviewMenu] = useState(false);
  const [previewGiroCodeUrl, setPreviewGiroCodeUrl] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);

  const [documentType, setDocumentType] = useState<DocumentType>('invoice');
  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? '');
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [groupByProduct, setGroupByProduct] = useState(true);
  const [includeLocation, setIncludeLocation] = useState<boolean>(
    Boolean(company.invoiceIncludeLocationDefault)
  );
  const [includeTimeNotes, setIncludeTimeNotes] = useState<boolean>(
    Boolean(company.invoiceIncludeTimeNotesDefault)
  );
  const [roundingMinutes, setRoundingMinutes] = useState<TimeRoundingMinutes>(
    company.defaultTimeRoundingMinutes ?? 0
  );
  const [extraItems, setExtraItems] = useState<ExtraProductDraft[]>([]);
  const [billedExpenseIds, setBilledExpenseIds] = useState<string[]>([]);
  const [billedTravelEntryIds, setBilledTravelEntryIds] = useState<string[]>([]);
  const [issueDate, setIssueDate] = useState(toInputDate());
  const [dueDateInput, setDueDateInput] = useState(() =>
    addDaysISO(toInputDate(), company.defaultPaymentTermDays || 14)
  );
  const [quoteValidUntil, setQuoteValidUntil] = useState(() =>
    addDaysISO(toInputDate(), 30)
  );
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountLabel, setDiscountLabel] = useState<string>('Rabatt');

  const defaultIntro =
    company.invoiceDefaultIntroText ??
    'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Vereinbarungsgemäß berechnen wir Ihnen folgende erbrachte Leistungen:';
  const defaultOutro =
    company.invoiceDefaultOutroText ??
    'Bitte überweisen Sie den Rechnungsbetrag innerhalb der Zahlungsfrist unter Angabe der Rechnungsnummer auf das unten genannte Konto.';
  const defaultQuoteIntro =
    company.quoteDefaultIntroText ??
    'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:';
  const defaultQuoteOutro =
    company.quoteDefaultOutroText ??
    'Dieses Angebot ist freibleibend. Bei Fragen oder zur Beauftragung freuen wir uns auf Ihre Rückmeldung.';

  const [introText, setIntroText] = useState(defaultIntro);
  const [outroText, setOutroText] = useState(defaultOutro);
  const [isSmallBusiness, setIsSmallBusiness] = useState(
    Boolean(company.smallBusinessMode)
  );
  const [builderError, setBuilderError] = useState('');

  const defaultSmallBusinessNotice =
    company.smallBusinessNotice ||
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

  const nextInvoiceSeqNumber = useMemo(
    () =>
      formatInvoiceNumber(
        company,
        company.nextInvoiceSequence ||
          invoices.filter((i) => i.documentType !== 'quote').length + 1
      ),
    [company, invoices]
  );

  const nextQuoteSeqNumber = useMemo(
    () =>
      formatQuoteNumber(
        company,
        company.nextQuoteSequence ||
          invoices.filter((i) => i.documentType === 'quote').length + 1
      ),
    [company, invoices]
  );

  const accentStyle =
    INVOICE_ACCENT_STYLES[company.invoiceAccentColor ?? 'slate'] ??
    INVOICE_ACCENT_STYLES.slate;
  const fontOption =
    INVOICE_FONT_OPTIONS[company.invoiceFontFamily ?? 'sans'] ??
    INVOICE_FONT_OPTIONS.sans;
  const layoutStyle = company.invoiceLayoutStyle ?? 'classic';
  const headerTitle = (company.invoiceHeaderTitle || 'Rechnung').trim();
  const quoteTitle = (company.quoteHeaderTitle || 'Angebot').trim();

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const getEffectiveRounding = (custId: string): TimeRoundingMinutes => {
    const cust = customerMap.get(custId);
    if (cust?.timeRoundingMinutes != null) {
      return cust.timeRoundingMinutes;
    }
    return company.defaultTimeRoundingMinutes ?? 0;
  };

  useEffect(() => {
    setShowPreviewMenu(false);
    let cancelled = false;
    if (!previewInvoice || previewInvoice.documentType === 'quote') {
      setPreviewGiroCodeUrl(null);
      return;
    }
    void generateGiroCodeDataUrl(previewInvoice, company).then((url) => {
      if (!cancelled) {
        setPreviewGiroCodeUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [previewInvoice, company]);

  useEffect(() => {
    if (!preselectedDraft) return;
    setDocumentType('invoice');
    setCustomerId(preselectedDraft.customerId);
    if (preselectedDraft.entryIds.length > 0) {
      setSelectedEntryIds(preselectedDraft.entryIds);
    } else {
      const openIds = timeEntries
        .filter(
          (t) =>
            t.customerId === preselectedDraft.customerId &&
            t.billable &&
            !t.billedInvoiceId
        )
        .map((t) => t.id);
      setSelectedEntryIds(openIds);
    }
    setEditingInvoice(null);
    setExtraItems([]);
    setBilledExpenseIds([]);
    setBilledTravelEntryIds([]);
    setIncludeLocation(Boolean(company.invoiceIncludeLocationDefault));
    setIncludeTimeNotes(Boolean(company.invoiceIncludeTimeNotesDefault));
    const today = toInputDate();
    setIssueDate(today);
    const custTerm =
      customerMap.get(preselectedDraft.customerId)?.paymentTermDays ||
      company.defaultPaymentTermDays ||
      14;
    setDueDateInput(addDaysISO(today, custTerm));
    setQuoteValidUntil(addDaysISO(today, 30));
    setInvoiceNumber(nextInvoiceSeqNumber);
    setDiscountType('percent');
    setDiscountValue(0);
    setDiscountLabel('Rabatt');
    setIntroText(defaultIntro);
    setOutroText(defaultOutro);
    setIsSmallBusiness(Boolean(company.smallBusinessMode));
    setRoundingMinutes(getEffectiveRounding(preselectedDraft.customerId));
    setBuilderError('');
    setShowBuilder(true);
    onClearPreselectedDraft();
  }, [
    preselectedDraft,
    timeEntries,
    nextInvoiceSeqNumber,
    defaultIntro,
    defaultOutro,
    company.smallBusinessMode,
    company.invoiceIncludeLocationDefault,
    company.invoiceIncludeTimeNotesDefault,
    company.defaultPaymentTermDays,
    company.defaultTimeRoundingMinutes,
    customerMap,
    onClearPreselectedDraft,
  ]);

  const openBuilderFresh = (type: DocumentType = 'invoice') => {
    const firstCust = customers[0]?.id ?? '';
    setEditingInvoice(null);
    setDocumentType(type);
    setCustomerId(firstCust);
    const openIds = timeEntries
      .filter((t) => t.customerId === firstCust && t.billable && !t.billedInvoiceId)
      .map((t) => t.id);
    setSelectedEntryIds(openIds);
    setExtraItems([]);
    setBilledExpenseIds([]);
    setBilledTravelEntryIds([]);
    setIncludeLocation(Boolean(company.invoiceIncludeLocationDefault));
    setIncludeTimeNotes(Boolean(company.invoiceIncludeTimeNotesDefault));
    const today = toInputDate();
    setIssueDate(today);
    const custTerm =
      customerMap.get(firstCust)?.paymentTermDays ||
      company.defaultPaymentTermDays ||
      14;
    setDueDateInput(addDaysISO(today, custTerm));
    setQuoteValidUntil(addDaysISO(today, 30));
    setInvoiceNumber(type === 'quote' ? nextQuoteSeqNumber : nextInvoiceSeqNumber);
    setDiscountType('percent');
    setDiscountValue(0);
    setDiscountLabel('Rabatt');
    setIntroText(type === 'quote' ? defaultQuoteIntro : defaultIntro);
    setOutroText(type === 'quote' ? defaultQuoteOutro : defaultOutro);
    setIsSmallBusiness(Boolean(company.smallBusinessMode));
    setRoundingMinutes(getEffectiveRounding(firstCust));
    setBuilderError('');
    setShowBuilder(true);
  };

  const handleBuilderDocTypeChange = (nextType: DocumentType) => {
    setDocumentType(nextType);
    if (!editingInvoice) {
      setInvoiceNumber(nextType === 'quote' ? nextQuoteSeqNumber : nextInvoiceSeqNumber);
      setIntroText(nextType === 'quote' ? defaultQuoteIntro : defaultIntro);
      setOutroText(nextType === 'quote' ? defaultQuoteOutro : defaultOutro);
    }
  };

  const openEditBuilder = (inv: Invoice) => {
    setPreviewInvoice(null);
    setEditingInvoice(inv);
    setDocumentType(inv.documentType ?? 'invoice');
    setCustomerId(inv.customerId);

    const linkedIds = timeEntries
      .filter((t) => t.billedInvoiceId === inv.id)
      .map((t) => t.id);
    const fallbackIds = inv.lineItems
      .flatMap((li) => li.timeEntryIds || [])
      .filter((id) => timeEntries.some((t) => t.id === id));
    const entryIds = Array.from(new Set([...linkedIds, ...fallbackIds]));
    setSelectedEntryIds(entryIds);

    const timeBasedLineItems = inv.lineItems.filter(
      (li) => (li.timeEntryIds?.length ?? 0) > 0
    );
    if (timeBasedLineItems.length > 0) {
      setGroupByProduct(
        timeBasedLineItems.some((li) => (li.timeEntryIds?.length ?? 0) > 1) ||
          entryIds.length === timeBasedLineItems.length
      );
    }
    setIncludeLocation(
      inv.includeLocation ??
        (inv.lineItems.some((li) => li.detail?.includes('Ort:')) ||
          Boolean(company.invoiceIncludeLocationDefault))
    );
    setIncludeTimeNotes(
      inv.includeTimeNotes ?? Boolean(company.invoiceIncludeTimeNotesDefault)
    );

    const manualRows: ExtraProductDraft[] = inv.lineItems
      .filter((li) => (li.timeEntryIds?.length ?? 0) === 0)
      .map((li) => ({
        id: createId('ext'),
        productId: li.productId || products[0]?.id || '',
        description: li.description,
        detail: li.detail,
        unit: li.unit,
        quantity: li.quantity,
        unitPriceNet: li.unitPriceNet,
        taxRate: li.taxRate,
      }));
    setExtraItems(manualRows);
    setBilledExpenseIds(
      expenses.filter((ex) => ex.billedInvoiceId === inv.id).map((ex) => ex.id)
    );
    setBilledTravelEntryIds(
      timeEntries
        .filter((t) => t.travelBilledInvoiceId === inv.id)
        .map((t) => t.id)
    );
    setIssueDate(inv.issueDate);
    setDueDateInput(inv.dueDate);
    setQuoteValidUntil(inv.quoteValidUntil || inv.dueDate);
    setInvoiceNumber(inv.invoiceNumber);
    setDiscountType(inv.discountType ?? 'percent');
    setDiscountValue(inv.discountValue ?? 0);
    setDiscountLabel(inv.discountLabel ?? 'Rabatt');
    setIntroText(inv.introText ?? '');
    setOutroText(inv.outroText ?? '');
    setIsSmallBusiness(inv.isSmallBusiness ?? Boolean(company.smallBusinessMode));
    setRoundingMinutes(getEffectiveRounding(inv.customerId));
    setBuilderError('');
    setShowBuilder(true);
  };

  const handleBuilderCustomerChange = (newCustId: string) => {
    setCustomerId(newCustId);
    const openIds = timeEntries
      .filter(
        (t) =>
          t.customerId === newCustId &&
          t.billable &&
          (!t.billedInvoiceId ||
            (editingInvoice !== null && t.billedInvoiceId === editingInvoice.id))
      )
      .map((t) => t.id);
    setSelectedEntryIds(openIds);
    setBilledExpenseIds([]);
    setBilledTravelEntryIds([]);
    setRoundingMinutes(getEffectiveRounding(newCustId));
    if (!editingInvoice) {
      const custTerm =
        customerMap.get(newCustId)?.paymentTermDays ||
        company.defaultPaymentTermDays ||
        14;
      setDueDateInput(addDaysISO(issueDate, custTerm));
    }
  };

  const unbilledForCustomer = useMemo(
    () =>
      timeEntries.filter(
        (t) =>
          t.customerId === customerId &&
          t.billable &&
          (!t.billedInvoiceId ||
            (editingInvoice !== null && t.billedInvoiceId === editingInvoice.id))
      ),
    [timeEntries, customerId, editingInvoice]
  );

  const openBillableExpensesForCustomer = useMemo(
    () =>
      expenses.filter(
        (exp) =>
          exp.customerId === customerId &&
          exp.billableToCustomer &&
          !exp.billedInvoiceId &&
          !billedExpenseIds.includes(exp.id)
      ),
    [expenses, customerId, billedExpenseIds]
  );

  const openTravelEntriesForCustomer = useMemo(
    () =>
      unbilledForCustomer.filter((entry) => {
        if (billedTravelEntryIds.includes(entry.id) || entry.travelBilledInvoiceId) {
          return false;
        }
        if ((entry.travelCostNet ?? 0) > 0) return true;
        return Boolean(company.homeBaseLocation && entry.location);
      }),
    [unbilledForCustomer, billedTravelEntryIds, company.homeBaseLocation]
  );

  const toggleEntry = (id: string) => {
    setSelectedEntryIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const addExtraProductRow = () => {
    const defaultProd = products.find((p) => p.type === 'product') ?? products[0];
    if (!defaultProd) return;
    setExtraItems((prev) => [
      ...prev,
      {
        id: createId('ext'),
        productId: defaultProd.id,
        description: defaultProd.name,
        quantity: 1,
        unitPriceNet: defaultProd.unitPriceNet,
        taxRate: defaultProd.taxRate,
      },
    ]);
  };

  const updateExtraRow = (id: string, patch: Partial<ExtraProductDraft>) => {
    setExtraItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.productId) {
          const p = productMap.get(patch.productId);
          if (p) {
            next.description = p.name;
            next.unitPriceNet = p.unitPriceNet;
            next.taxRate = p.taxRate;
          }
        }
        return next;
      })
    );
  };

  const handleImportBillableExpenses = () => {
    if (openBillableExpensesForCustomer.length === 0) return;
    const newRows: ExtraProductDraft[] = openBillableExpensesForCustomer.map((exp) => ({
      id: createId('ext'),
      productId: products[0]?.id ?? '',
      description: `${exp.vendor} — ${exp.description}`,
      detail: `Beleg vom ${formatDateDE(exp.date)} (${exp.category})`,
      unit: 'Stk.',
      quantity: 1,
      unitPriceNet: exp.netAmount,
      taxRate: exp.taxRate,
    }));
    setExtraItems((prev) => [...prev, ...newRows]);
    setBilledExpenseIds((prev) => [
      ...prev,
      ...openBillableExpensesForCustomer.map((e) => e.id),
    ]);
    onNotify(`${newRows.length} Kunden-Beleg(e) als Position(en) übernommen.`);
  };

  const handleImportTravelCosts = () => {
    const rate = company.travelRatePerKm ?? 0.3;
    const roundTrip = company.travelRoundTripDefault !== false;
    let totalKm = 0;
    let totalCost = 0;
    const matchedIds: string[] = [];
    const addresses = new Set<string>();

    for (const entry of openTravelEntriesForCustomer) {
      let km = entry.travelDistanceKm ?? 0;
      let cost = entry.travelCostNet ?? 0;
      if (cost <= 0 && company.homeBaseLocation && entry.location) {
        const calc = computeTravelFromBase(
          company.homeBaseLocation,
          entry.location,
          rate,
          roundTrip
        );
        km = calc.distanceKm;
        cost = calc.costNet;
      }
      if (cost > 0 || km > 0) {
        totalKm += km;
        totalCost += cost;
        matchedIds.push(entry.id);
        if (entry.location?.address) {
          addresses.add(entry.location.address);
        }
      }
    }

    if (matchedIds.length === 0) {
      onNotify(
        'Keine abrechenbaren Fahrtkosten vorhanden (Standort & Startadresse nötig).',
        true
      );
      return;
    }

    const kmRounded = Math.round(totalKm * 10) / 10;
    const costRounded = Math.round(totalCost * 100) / 100;
    setExtraItems((prev) => [
      ...prev,
      {
        id: createId('ext'),
        productId: products[0]?.id ?? '',
        description: `Fahrtkosten / Anfahrt (${kmRounded} km)`,
        detail: `${matchedIds.length} Einsatzfahrten (${rate.toFixed(2)} €/km)${
          addresses.size > 0 ? ` · Ziele: ${Array.from(addresses).slice(0, 2).join('; ')}` : ''
        }`,
        unit: 'Pauschal',
        quantity: 1,
        unitPriceNet: costRounded,
        taxRate: 19,
      },
    ]);
    setBilledTravelEntryIds((prev) => [...prev, ...matchedIds]);
    onNotify(
      `Fahrtkosten (${kmRounded} km · ${formatCurrency(costRounded)}) als Position übernommen.`
    );
  };

  const formatEntryLocation = (entry: TimeEntry): string => {
    if (!entry.location) return '';
    return (
      entry.location.address ||
      `${entry.location.lat.toFixed(4)}, ${entry.location.lng.toFixed(4)}`
    );
  };

  const computedLineItems = useMemo((): InvoiceLineItem[] => {
    const selectedEntries = unbilledForCustomer.filter((e) =>
      selectedEntryIds.includes(e.id)
    );
    const items: InvoiceLineItem[] = [];

    if (groupByProduct) {
      const grouped = new Map<string, TimeEntry[]>();
      for (const e of selectedEntries) {
        const key = `${e.productId}::${e.hourlyRateNet}::${e.taxRate}`;
        const list = grouped.get(key) ?? [];
        list.push(e);
        grouped.set(key, list);
      }

      for (const [, group] of grouped.entries()) {
        const first = group[0];
        const prod = productMap.get(first.productId);
        const rawSeconds = group.reduce((acc, g) => acc + g.durationSeconds, 0);
        const totalSeconds = roundDurationSeconds(rawSeconds, roundingMinutes);
        const hours = Math.round((totalSeconds / 3600) * 100) / 100;
        const net = Math.round(hours * first.hourlyRateNet * 100) / 100;
        const effectiveTaxRate: TaxRate = isSmallBusiness ? 0 : first.taxRate;
        const tax = Math.round(net * (effectiveTaxRate / 100) * 100) / 100;
        const taskTitles = Array.from(new Set(group.map((g) => g.title))).join(', ');
        const notesList = includeTimeNotes
          ? Array.from(
              new Set(group.map((g) => (g.notes || '').trim()).filter(Boolean))
            )
          : [];
        const notesSuffix =
          notesList.length > 0 ? ` · Notizen: ${notesList.join('; ')}` : '';
        const locations = includeLocation
          ? Array.from(
              new Set(group.map((g) => formatEntryLocation(g)).filter(Boolean))
            )
          : [];
        const locSuffix = locations.length > 0 ? ` · Ort: ${locations.join('; ')}` : '';

        items.push({
          id: createId('li'),
          description: prod?.name ?? first.title,
          detail: `${group.length} Zeiteinträge: ${taskTitles}${notesSuffix}${locSuffix}`,
          quantity: hours,
          unit: 'Std.',
          unitPriceNet: first.hourlyRateNet,
          taxRate: effectiveTaxRate,
          netTotal: net,
          taxAmount: tax,
          grossTotal: Math.round((net + tax) * 100) / 100,
          timeEntryIds: group.map((g) => g.id),
          productId: first.productId,
        });
      }
    } else {
      for (const e of selectedEntries) {
        const prod = productMap.get(e.productId);
        const effectiveSeconds = roundDurationSeconds(e.durationSeconds, roundingMinutes);
        const hours = Math.round((effectiveSeconds / 3600) * 100) / 100;
        const net = Math.round(hours * e.hourlyRateNet * 100) / 100;
        const effectiveTaxRate: TaxRate = isSmallBusiness ? 0 : e.taxRate;
        const tax = Math.round(net * (effectiveTaxRate / 100) * 100) / 100;
        const locText = includeLocation ? formatEntryLocation(e) : '';
        const noteText = includeTimeNotes ? (e.notes || '').trim() : '';
        items.push({
          id: createId('li'),
          description: `${prod?.name ?? 'Leistung'} — ${e.title}`,
          detail: `${formatDateDE(e.startTime)}${noteText ? ` · ${noteText}` : ''}${
            locText ? ` · Ort: ${locText}` : ''
          }`,
          quantity: hours,
          unit: 'Std.',
          unitPriceNet: e.hourlyRateNet,
          taxRate: effectiveTaxRate,
          netTotal: net,
          taxAmount: tax,
          grossTotal: Math.round((net + tax) * 100) / 100,
          timeEntryIds: [e.id],
          productId: e.productId,
        });
      }
    }

    for (const extra of extraItems) {
      const prod = productMap.get(extra.productId);
      const qty = Math.max(0, Number(extra.quantity) || 0);
      const net = Math.round(qty * extra.unitPriceNet * 100) / 100;
      const effectiveTaxRate: TaxRate = isSmallBusiness ? 0 : extra.taxRate;
      const tax = Math.round(net * (effectiveTaxRate / 100) * 100) / 100;
      items.push({
        id: createId('li'),
        description: extra.description || prod?.name || 'Position',
        detail: extra.detail ?? prod?.description ?? '',
        quantity: qty,
        unit: extra.unit ?? prod?.unit ?? 'Stk.',
        unitPriceNet: extra.unitPriceNet,
        taxRate: effectiveTaxRate,
        netTotal: net,
        taxAmount: tax,
        grossTotal: Math.round((net + tax) * 100) / 100,
        timeEntryIds: [],
        productId: extra.productId,
      });
    }

    return items;
  }, [
    unbilledForCustomer,
    selectedEntryIds,
    groupByProduct,
    includeLocation,
    includeTimeNotes,
    roundingMinutes,
    extraItems,
    productMap,
    isSmallBusiness,
  ]);

  const builderTotals = useMemo(
    () =>
      calculateDocumentTotals(
        computedLineItems,
        isSmallBusiness,
        discountType,
        discountValue
      ),
    [computedLineItems, isSmallBusiness, discountType, discountValue]
  );

  const handleSaveInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    setBuilderError('');
    const cust = customerMap.get(customerId);
    if (!cust) {
      setBuilderError('Bitte einen Kunden auswählen.');
      return;
    }
    if (computedLineItems.length === 0) {
      setBuilderError('Bitte mindestens einen Zeiteintrag oder ein Produkt auswählen.');
      return;
    }

    const selectedEntries = unbilledForCustomer.filter((entry) =>
      selectedEntryIds.includes(entry.id)
    );
    const dates = selectedEntries
      .map((entry) => entry.startTime.slice(0, 10))
      .sort();
    const servicePeriodStart = dates[0] ?? issueDate;
    const servicePeriodEnd = dates[dates.length - 1] ?? issueDate;
    const dueDate =
      dueDateInput ||
      addDaysISO(
        issueDate,
        cust.paymentTermDays || company.defaultPaymentTermDays || 14
      );
    const fallbackNum =
      documentType === 'quote' ? nextQuoteSeqNumber : nextInvoiceSeqNumber;

    const savedInvoice: Invoice = {
      id: editingInvoice?.id ?? createId(documentType === 'quote' ? 'quote' : 'inv'),
      documentType,
      invoiceNumber: invoiceNumber.trim() || fallbackNum,
      customerId: cust.id,
      customerSnapshot: {
        companyName: cust.companyName,
        contactName: cust.contactName,
        street: cust.street,
        postalCode: cust.postalCode,
        city: cust.city,
        country: cust.country,
        vatId: cust.vatId,
        email: cust.email,
      },
      issueDate,
      servicePeriodStart,
      servicePeriodEnd,
      dueDate: documentType === 'quote' ? quoteValidUntil || dueDate : dueDate,
      quoteValidUntil: documentType === 'quote' ? quoteValidUntil || dueDate : undefined,
      status: editingInvoice?.status ?? 'Entwurf',
      includeLocation,
      includeTimeNotes,
      isArchived: editingInvoice?.isArchived ?? false,
      archivedAt: editingInvoice?.archivedAt ?? null,
      lineItems: computedLineItems,
      subtotalNetBeforeDiscount: builderTotals.subtotalNetBeforeDiscount,
      discountType: discountValue > 0 ? discountType : undefined,
      discountValue: discountValue > 0 ? discountValue : undefined,
      discountLabel: discountValue > 0 ? discountLabel.trim() || 'Rabatt' : undefined,
      discountNetAmount:
        builderTotals.discountNetAmount > 0 ? builderTotals.discountNetAmount : undefined,
      netTotal: builderTotals.netTotal,
      taxTotal: builderTotals.taxTotal,
      grossTotal: builderTotals.grossTotal,
      introText: introText.trim(),
      outroText: outroText.trim(),
      isSmallBusiness,
      smallBusinessNotice: isSmallBusiness ? defaultSmallBusinessNotice : undefined,
      signature: editingInvoice?.signature,
      nextcloudUploadedAt: null,
      createdAt: editingInvoice?.createdAt ?? new Date().toISOString(),
    };

    const entryIdsToBill = documentType === 'quote' ? [] : selectedEntryIds;
    const expIdsToBill = documentType === 'quote' ? [] : billedExpenseIds;
    const travelIdsToBill = documentType === 'quote' ? [] : billedTravelEntryIds;
    if (editingInvoice) {
      onUpdateInvoice(savedInvoice, entryIdsToBill, expIdsToBill, travelIdsToBill);
    } else {
      onCreateInvoice(savedInvoice, entryIdsToBill, expIdsToBill, travelIdsToBill);
    }
    setShowBuilder(false);
    setEditingInvoice(null);
    setPreviewInvoice(savedInvoice);

    if (nextcloud.configured && nextcloud.autoSync) {
      void handleUploadToNextcloud(savedInvoice);
    }
  };

  const handleConvertQuoteToInvoice = (quote: Invoice) => {
    const today = toInputDate();
    const cust = customerMap.get(quote.customerId);
    const term = cust?.paymentTermDays || company.defaultPaymentTermDays || 14;
    const due = addDaysISO(today, term);

    const quotedEntryIds = new Set(
      quote.lineItems.flatMap((li) => li.timeEntryIds || [])
    );
    const toBillIds = timeEntries
      .filter((t) => quotedEntryIds.has(t.id) && t.billable && !t.billedInvoiceId)
      .map((t) => t.id);

    const converted: Invoice = {
      ...quote,
      id: createId('inv'),
      documentType: 'invoice',
      invoiceNumber: nextInvoiceSeqNumber,
      issueDate: today,
      dueDate: due,
      quoteValidUntil: undefined,
      status: 'Entwurf',
      introText: defaultIntro,
      outroText: defaultOutro,
      nextcloudUploadedAt: null,
      createdAt: new Date().toISOString(),
    };

    onCreateInvoice(converted, toBillIds);
    setShowPreviewMenu(false);
    setPreviewInvoice(converted);
  };

  const handleUploadToNextcloud = async (inv: Invoice) => {
    if (!nextcloud.configured) {
      onNotify(
        'Bitte konfiguriere zuerst deine Nextcloud-Verbindung unter "Nextcloud & Setup".',
        true
      );
      return;
    }
    setUploadingId(inv.id);
    try {
      const pdfBase64 = await getInvoicePdfBase64(inv, company);
      const result = await apiUploadInvoicePdf(`${inv.invoiceNumber}.pdf`, pdfBase64);
      onMarkInvoiceUploaded(inv.id, result.uploadedAt);
      setPreviewInvoice((prev) =>
        prev?.id === inv.id ? { ...prev, nextcloudUploadedAt: result.uploadedAt } : prev
      );
      onNotify(`Rechnung als PDF nach Nextcloud (${result.path}) hochgeladen.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Nextcloud-Upload fehlgeschlagen.',
        true
      );
    } finally {
      setUploadingId(null);
    }
  };

  const handleOpenPdf = async (inv: Invoice) => {
    try {
      await downloadInvoicePdf(inv, company);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'PDF konnte nicht geöffnet werden.',
        true
      );
    }
  };

  const handleSharePdf = async (inv: Invoice) => {
    try {
      await shareInvoicePdf(inv, company);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'PDF konnte nicht geteilt werden.',
        true
      );
    }
  };

  const handlePaymentReminderPdf = async (inv: Invoice) => {
    try {
      await downloadPaymentReminderPdf(inv, company);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Zahlungserinnerung konnte nicht erstellt werden.',
        true
      );
    }
  };

  const getLinkedEntriesForInvoice = (inv: Invoice): TimeEntry[] => {
    const idSet = new Set<string>();
    for (const li of inv.lineItems) {
      for (const tid of li.timeEntryIds ?? []) {
        idSet.add(tid);
      }
    }
    return timeEntries.filter(
      (t) => t.billedInvoiceId === inv.id || idSet.has(t.id)
    );
  };

  const handleDownloadTimesheet = async (inv: Invoice) => {
    const linked = getLinkedEntriesForInvoice(inv);
    if (linked.length === 0) {
      onNotify('Diese Rechnung enthält keine verknüpften Zeiteinträge.', true);
      return;
    }
    try {
      await downloadTimesheetPdf(
        `Tätigkeitsbericht ${inv.invoiceNumber}`,
        `Taetigkeitsbericht-${inv.invoiceNumber}.pdf`,
        customerMap.get(inv.customerId),
        linked,
        company,
        `Leistungszeitraum: ${formatDateDE(inv.servicePeriodStart)} – ${formatDateDE(inv.servicePeriodEnd)}`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Tätigkeitsbericht konnte nicht erstellt werden.',
        true
      );
    }
  };

  const handleDownloadXRechnungXml = async (inv: Invoice) => {
    try {
      const xml = buildXRechnungXml(inv, company);
      await downloadOrShareTextFile(
        `XRechnung-${inv.invoiceNumber}.xml`,
        xml,
        'application/xml'
      );
      onNotify(`XRechnung ${inv.invoiceNumber} (.xml) exportiert.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'XRechnung konnte nicht exportiert werden.',
        true
      );
    }
  };

  const handleUploadXRechnungXml = async (inv: Invoice) => {
    if (!nextcloud.configured) {
      onNotify(
        'Bitte konfiguriere zuerst deine Nextcloud-Verbindung unter "Nextcloud & Setup".',
        true
      );
      return;
    }
    setUploadingId(inv.id);
    try {
      const xml = buildXRechnungXml(inv, company);
      const result = await apiUploadInvoiceTextFile(
        `XRechnung-${inv.invoiceNumber}.xml`,
        xml,
        'application/xml; charset=utf-8'
      );
      onNotify(`XRechnung nach Nextcloud (${result.path}) hochgeladen.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'XRechnung-Upload fehlgeschlagen.',
        true
      );
    } finally {
      setUploadingId(null);
    }
  };

  const handlePrint = async (inv: Invoice) => {
    try {
      await printInvoiceView(inv.invoiceNumber);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Drucken fehlgeschlagen.',
        true
      );
    }
  };

  const handleDownloadProtocolPdf = async (inv: Invoice) => {
    try {
      await downloadAcceptanceProtocolPdf(inv, company);
      onNotify(`Abnahmeprotokoll ${inv.invoiceNumber} erstellt.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Abnahmeprotokoll konnte nicht erstellt werden.',
        true
      );
    }
  };

  const handleShareProtocolPdf = async (inv: Invoice) => {
    try {
      await shareAcceptanceProtocolPdf(inv, company);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Abnahmeprotokoll konnte nicht geteilt werden.',
        true
      );
    }
  };

  const handleUploadProtocolToNextcloud = async (inv: Invoice) => {
    if (!nextcloud.configured) {
      onNotify('Bitte verbinde zuerst Nextcloud unter "Nextcloud & Setup".', true);
      return;
    }
    setUploadingId(inv.id);
    try {
      const pdfBase64 = await getAcceptanceProtocolPdfBase64(inv, company);
      const res = await apiUploadInvoicePdf(`Abnahme-${inv.invoiceNumber}.pdf`, pdfBase64);
      onNotify(`Abnahmeprotokoll in Nextcloud (${res.path}) gespeichert.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Upload fehlgeschlagen.',
        true
      );
    } finally {
      setUploadingId(null);
    }
  };

  const overdueCount = useMemo(
    () => invoices.filter((inv) => !inv.isArchived && isInvoiceOverdue(inv)).length,
    [invoices]
  );

  const activeCount = useMemo(
    () => invoices.filter((inv) => !inv.isArchived).length,
    [invoices]
  );
  const archivedCount = useMemo(
    () => invoices.filter((inv) => Boolean(inv.isArchived)).length,
    [invoices]
  );

  const filteredInvoices = useMemo(() => {
    return [...invoices]
      .filter((inv) => {
        if (archiveFilter === 'active' && inv.isArchived) return false;
        if (archiveFilter === 'archived' && !inv.isArchived) return false;
        const isQuote = inv.documentType === 'quote';
        if (docFilter === 'invoice' && isQuote) return false;
        if (docFilter === 'quote' && !isQuote) return false;
        if (statusFilter === 'all') return true;
        if (statusFilter === 'Überfällig') return !inv.isArchived && isInvoiceOverdue(inv);
        return inv.status === statusFilter;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invoices, statusFilter, docFilter, archiveFilter]);

  const handleExportCsv = async () => {
    try {
      const csv = invoicesToCsv(filteredInvoices);
      await downloadOrShareTextFile(
        `taktwerk-rechnungen-${toInputDate()}.csv`,
        csv,
        'text/csv'
      );
      onNotify('Rechnungsliste als CSV exportiert.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'CSV-Export fehlgeschlagen.',
        true
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Rechnungen &amp; Angebote
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Rechnungen, Angebote mit Rabatten, rechtssichere PDFs, GiroCodes, XRechnungen und Tätigkeitsberichte erstellen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {invoices.length > 0 && (
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4" />
              CSV-Export
            </button>
          )}
          <button
            type="button"
            onClick={() => openBuilderFresh('quote')}
            disabled={customers.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Neues Angebot
          </button>
          <button
            type="button"
            onClick={() => openBuilderFresh('invoice')}
            disabled={customers.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FilePlus2 className="h-4 w-4" />
            Neue Rechnung erstellen
          </button>
        </div>
      </div>

      {/* Invoice / Quote Builder */}
      {showBuilder && (
        <section className="no-print rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                {editingInvoice
                  ? `${documentType === 'quote' ? 'Angebot' : 'Rechnung'} ${editingInvoice.invoiceNumber} bearbeiten`
                  : documentType === 'quote'
                    ? 'Neues Angebot erstellen'
                    : 'Rechnung aus Arbeitszeiten generieren'}
              </h2>
              {!editingInvoice && (
                <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
                  {(['invoice', 'quote'] as const).map((dt) => (
                    <button
                      key={dt}
                      type="button"
                      onClick={() => handleBuilderDocTypeChange(dt)}
                      className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        documentType === dt
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                      }`}
                    >
                      {dt === 'invoice' ? 'Rechnung' : 'Angebot'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowBuilder(false);
                setEditingInvoice(null);
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer"
            >
              Schließen
            </button>
          </div>

          <form onSubmit={handleSaveInvoice} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Kunde
                </label>
                <ThemedSelect
                  value={customerId}
                  onChange={handleBuilderCustomerChange}
                  ariaLabel="Kunde für Dokument auswählen"
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.companyName,
                    hint: c.city || undefined,
                  }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {documentType === 'quote' ? 'Angebotsnummer' : 'Rechnungsnummer'}
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {documentType === 'quote' ? 'Angebotsdatum' : 'Rechnungsdatum'}
                </label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {documentType === 'quote' ? 'Gültig bis' : 'Fällig bis'}
                </label>
                <input
                  type="date"
                  value={documentType === 'quote' ? quoteValidUntil : dueDateInput}
                  onChange={(e) =>
                    documentType === 'quote'
                      ? setQuoteValidUntil(e.target.value)
                      : setDueDateInput(e.target.value)
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                />
              </div>
            </div>

            {/* Unbilled time entries selection */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Offene abrechenbare Arbeitszeiten ({unbilledForCustomer.length})
                </h3>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      Zeitrundung:
                    </label>
                    <ThemedSelect
                      size="sm"
                      value={String(roundingMinutes)}
                      onChange={(val) =>
                        setRoundingMinutes(Number(val) as TimeRoundingMinutes)
                      }
                      ariaLabel="Zeitrundung auswählen"
                      className="min-w-44"
                      options={[
                        { value: '0', label: 'Exakt (keine Rundung)' },
                        { value: '5', label: 'Auf 5 Min. aufrunden' },
                        { value: '10', label: 'Auf 10 Min. aufrunden' },
                        { value: '15', label: 'Auf 15 Min. aufrunden' },
                        { value: '30', label: 'Auf 30 Min. aufrunden' },
                      ]}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={groupByProduct}
                      onChange={(e) => setGroupByProduct(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                    />
                    Gleichartige Leistungen zusammenfassen
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeLocation}
                      onChange={(e) => setIncludeLocation(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                    />
                    <MapPin className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Einsatzort in Rechnung angeben
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeTimeNotes}
                      onChange={(e) => setIncludeTimeNotes(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                    />
                    <StickyNote className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                    Auftragsnotizen auf Rechnung ausgeben
                  </label>
                </div>
              </div>

              {unbilledForCustomer.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/50 dark:text-slate-400">
                  Für diesen Kunden liegen aktuell keine offenen Zeiteinträge vor. Du kannst trotzdem Produkte/Pauschalen unten hinzufügen.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-200 dark:border-[#2e2349] dark:divide-[#2e2349]">
                  {unbilledForCustomer.map((entry) => {
                    const prod = productMap.get(entry.productId);
                    const roundedSecs = roundDurationSeconds(
                      entry.durationSeconds,
                      roundingMinutes
                    );
                    const net = (roundedSecs / 3600) * entry.hourlyRateNet;
                    return (
                      <label
                        key={entry.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-[#211936]/60 cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedEntryIds.includes(entry.id)}
                            onChange={() => toggleEntry(entry.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                              {entry.title}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span>
                                {formatDateDE(entry.startTime)} · {prod?.name ?? 'Leistung'}
                              </span>
                              {entry.location && (
                                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                  <MapPin className="h-3 w-3" />
                                  {entry.location.address || 'GPS'}
                                </span>
                              )}
                              {(entry.travelCostNet ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-violet-950/60 dark:text-violet-300">
                                  <Car className="h-3 w-3" />
                                  {entry.travelDistanceKm} km · {formatCurrency(entry.travelCostNet ?? 0)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatCurrency(net)}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {formatDuration(entry.durationSeconds)}
                            {roundingMinutes > 0 && !groupByProduct && roundedSecs !== entry.durationSeconds
                              ? ` → ${formatDuration(roundedSecs)}`
                              : ''}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Extra catalog items */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Zusätzliche Produkte / Pauschalen &amp; Auslagen
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {openTravelEntriesForCustomer.length > 0 && (
                    <button
                      type="button"
                      onClick={handleImportTravelCosts}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-violet-700/60 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-900/50 cursor-pointer"
                    >
                      <Car className="h-3.5 w-3.5" />
                      Fahrtkosten ({openTravelEntriesForCustomer.length}) übernehmen
                    </button>
                  )}
                  {openBillableExpensesForCustomer.length > 0 && (
                    <button
                      type="button"
                      onClick={handleImportBillableExpenses}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-900/50 cursor-pointer"
                    >
                      <Receipt className="h-3.5 w-3.5" />
                      Offene Belege ({openBillableExpensesForCustomer.length}) übernehmen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addExtraProductRow}
                    disabled={products.length === 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Position hinzufügen
                  </button>
                </div>
              </div>
              {extraItems.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#2e2349] dark:bg-[#211936]/50 sm:grid-cols-12"
                >
                  <div className="sm:col-span-3">
                    <ThemedSelect
                      size="sm"
                      value={row.productId}
                      onChange={(val) =>
                        updateExtraRow(row.id, { productId: val })
                      }
                      ariaLabel="Katalog-Position auswählen"
                      options={products.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) =>
                        updateExtraRow(row.id, { description: e.target.value })
                      }
                      placeholder="Positionsbeschreibung"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={row.quantity}
                      onChange={(e) =>
                        updateExtraRow(row.id, { quantity: Number(e.target.value) })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                      placeholder="Menge"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.unitPriceNet}
                      onChange={(e) =>
                        updateExtraRow(row.id, {
                          unitPriceNet: Number(e.target.value),
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                      placeholder="Netto €"
                    />
                  </div>
                  <div className="flex items-center justify-between sm:col-span-2">
                    <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(row.quantity * row.unitPriceNet)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExtraItems((prev) => prev.filter((x) => x.id !== row.id))
                      }
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals summary */}
            <div className="flex flex-col justify-between gap-4 border-t border-slate-200 pt-4 dark:border-[#2e2349] sm:flex-row sm:items-end">
              <div className="flex-1 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Einleitungstext
                  </label>
                  <textarea
                    rows={2}
                    value={introText}
                    onChange={(e) => setIntroText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Schlusstext / Zahlungshinweis
                  </label>
                  <textarea
                    rows={2}
                    value={outroText}
                    onChange={(e) => setOutroText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                  />
                </div>
              </div>
              <div className="w-full space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-[#2e2349] dark:bg-[#211936]/70 sm:w-96">
                <label className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-[#3b2d5e] text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSmallBusiness}
                    onChange={(e) => setIsSmallBusiness(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                  />
                  Kleinunternehmerregelung (§ 19 UStG)
                </label>

                {/* Rabatt-Konfiguration */}
                <div className="space-y-1.5 border-b border-slate-200 pb-2.5 dark:border-[#3b2d5e]">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                    <Percent className="h-3.5 w-3.5 text-blue-700 dark:text-violet-400" />
                    Rabatt (optional)
                  </div>
                  <div className="grid grid-cols-12 gap-1.5">
                    <input
                      type="text"
                      value={discountLabel}
                      onChange={(e) => setDiscountLabel(e.target.value)}
                      placeholder="Bezeichnung"
                      className="col-span-5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-100"
                    />
                    <div className="col-span-3">
                      <ThemedSelect
                        size="sm"
                        value={discountType}
                        onChange={(val) => setDiscountType(val as DiscountType)}
                        ariaLabel="Rabatt-Art"
                        options={[
                          { value: 'percent', label: '%' },
                          { value: 'fixed', label: '€ Netto' },
                        ]}
                      />
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))}
                      className="col-span-4 rounded-md border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-100"
                    />
                  </div>
                </div>

                {builderTotals.discountNetAmount > 0 && (
                  <>
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>Zwischensumme Netto</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(builderTotals.subtotalNetBeforeDiscount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-400">
                      <span>
                        {discountLabel || 'Rabatt'} (
                        {discountType === 'percent' ? `${discountValue}%` : formatCurrency(discountValue)})
                      </span>
                      <span className="font-mono tabular-nums">
                        − {formatCurrency(builderTotals.discountNetAmount)}
                      </span>
                    </div>
                  </>
                )}

                {!isSmallBusiness ? (
                  <>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>Summe Netto</span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatCurrency(builderTotals.netTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>MwSt. gesamt</span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatCurrency(builderTotals.taxTotal)}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-violet-300/80">
                    {defaultSmallBusinessNotice}
                  </p>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900 dark:border-[#3b2d5e] dark:text-slate-100">
                  <span>
                    {isSmallBusiness
                      ? documentType === 'quote'
                        ? 'Angebotsbetrag'
                        : 'Rechnungsbetrag'
                      : 'Gesamt Brutto'}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(builderTotals.grossTotal)}
                  </span>
                </div>
              </div>
            </div>

            {builderError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                {builderError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowBuilder(false);
                  setEditingInvoice(null);
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                {editingInvoice
                  ? 'Änderungen speichern'
                  : documentType === 'quote'
                    ? 'Angebot erzeugen (Zeiten bleiben offen)'
                    : 'Rechnung erzeugen & Zeiten verbuchen'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Invoices & Quotes Table */}
      <section className="no-print rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-[#2e2349]">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
            {(['all', 'Entwurf', 'Gesendet', 'Überfällig', 'Bezahlt', 'Storniert'] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                      : st === 'Überfällig' && overdueCount > 0
                        ? 'text-red-700 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {st === 'all'
                    ? 'Alle'
                    : st === 'Überfällig' && overdueCount > 0
                      ? `Überfällig (${overdueCount})`
                      : st}
                </button>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
              {([
                { id: 'active', label: `Aktiv (${activeCount})` },
                { id: 'archived', label: `Archiv (${archivedCount})` },
                { id: 'all', label: 'Alle' },
              ] as const).map((af) => (
                <button
                  key={af.id}
                  type="button"
                  onClick={() => setArchiveFilter(af.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    archiveFilter === af.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {af.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
              {([
                { id: 'all', label: 'Alle Typen' },
                { id: 'invoice', label: 'Rechnungen' },
                { id: 'quote', label: 'Angebote' },
              ] as const).map((dt) => (
                <button
                  key={dt.id}
                  type="button"
                  onClick={() => setDocFilter(dt.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    docFilter === dt.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {dt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {archiveFilter === 'archived'
                ? 'Noch keine archivierten Dokumente vorhanden.'
                : 'Noch keine Dokumente in dieser Ansicht vorhanden.'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {archiveFilter === 'archived'
                ? 'Archiviere bezahlte oder abgeschlossene Rechnungen über das Archiv-Symbol in der Tabelle.'
                : 'Erfasse Arbeitszeiten für einen Kunden oder erstelle ein Angebot mit einem Klick.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/70 dark:text-violet-200/70">
                  <th className="px-4 py-3">Nr. / Typ</th>
                  <th className="px-4 py-3">Kunde</th>
                  <th className="px-4 py-3">Datum / Fällig</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Betrag (Brutto)</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {filteredInvoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setPreviewInvoice(inv)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50/75 dark:hover:bg-[#211936]/50 ${
                      inv.isArchived ? 'opacity-80' : ''
                    }`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {inv.invoiceNumber}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {inv.documentType === 'quote' && (
                          <span className="inline-block text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                            Angebot
                          </span>
                        )}
                        {inv.isArchived && (
                          <span className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-[#2c2147] dark:text-slate-300">
                            Archiviert
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {inv.customerSnapshot.companyName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {inv.lineItems.length} Positionen
                        {(inv.discountNetAmount ?? 0) > 0
                          ? ` · inkl. Rabatt (−${formatCurrency(inv.discountNetAmount ?? 0)})`
                          : ''}
                        {inv.nextcloudUploadedAt
                          ? ` · Nextcloud-PDF gesichert`
                          : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      <div>{formatDateDE(inv.issueDate)}</div>
                      <div className="text-slate-400 dark:text-slate-500">
                        Fällig {formatDateDE(inv.dueDate)}
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col items-start gap-1">
                        <ThemedSelect
                          size="sm"
                          value={inv.status}
                          onChange={(val) =>
                            onUpdateInvoiceStatus(inv.id, val as InvoiceStatus)
                          }
                          ariaLabel={`Status für ${inv.invoiceNumber}`}
                          className="w-32"
                          options={[
                            { value: 'Entwurf', label: 'Entwurf' },
                            { value: 'Gesendet', label: 'Gesendet' },
                            { value: 'Bezahlt', label: 'Bezahlt' },
                            { value: 'Storniert', label: 'Storniert' },
                          ]}
                        />
                        {inv.signature && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3 shrink-0" />
                            Abgenommen
                          </span>
                        )}
                        {(() => {
                          const overdueDays = getOverdueDays(inv);
                          if (overdueDays <= 0) return null;
                          return (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400 whitespace-nowrap">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              {overdueDays} {overdueDays === 1 ? 'Tag' : 'Tage'} überfällig
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                      {formatCurrency(inv.grossTotal)}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditBuilder(inv)}
                          title="Rechnung bearbeiten"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewInvoice(inv)}
                          title="Vorschau öffnen"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Vorschau
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleOpenPdf(inv)}
                          title="PDF öffnen / herunterladen"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSharePdf(inv)}
                          title="PDF teilen / auf Gerät speichern"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUploadToNextcloud(inv)}
                          disabled={uploadingId === inv.id}
                          title="PDF in Nextcloud (/Rechnungen) speichern"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:text-violet-400 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <CloudUpload className="h-4 w-4" />
                        </button>
                        {onToggleArchiveInvoice && (
                          <button
                            type="button"
                            onClick={() => onToggleArchiveInvoice(inv.id)}
                            title={
                              inv.isArchived
                                ? 'Aus dem Archiv wiederherstellen'
                                : 'Dokument archivieren'
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
                          >
                            {inv.isArchived ? (
                              <ArchiveRestore className="h-4 w-4" />
                            ) : (
                              <Archive className="h-4 w-4" />
                            )}
                          </button>
                        )}
                        {confirmDeleteId === inv.id ? (
                          <div className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 dark:border-red-900/60 dark:bg-red-950/60">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteInvoice(inv.id);
                                setConfirmDeleteId(null);
                                if (previewInvoice?.id === inv.id) {
                                  setPreviewInvoice(null);
                                }
                              }}
                              className="text-[11px] font-semibold text-red-700 hover:underline dark:text-red-300 cursor-pointer whitespace-nowrap"
                            >
                              Löschen (Zeiten bleiben)
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(inv.id)}
                            title="Rechnung löschen (Arbeitszeiten bleiben erhalten)"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Invoice / Quote Document Preview Modal */}
      {previewInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          data-no-swipe="true"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0e0a18]/75 p-4 sm:p-8"
        >
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl dark:border-[#3b2d5e]">
            <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4 rounded-t-xl dark:border-[#2e2349] dark:bg-[#171126]">
              <div className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {previewInvoice.documentType === 'quote' ? 'Angebotsvorschau' : 'Rechnungsvorschau'} · {previewInvoice.invoiceNumber}
                {previewInvoice.isArchived && (
                  <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-[#2c2147] dark:text-slate-300">
                    Archiviert
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Dropdown: Weitere Aktionen */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPreviewMenu((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Weitere Aktionen
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>

                  {showPreviewMenu && (
                    <div className="absolute left-0 top-full z-30 mt-1.5 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-[#3b2d5e] dark:bg-[#1e1730]">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPreviewMenu(false);
                          openEditBuilder(previewInvoice);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Bearbeiten
                      </button>

                      {onToggleArchiveInvoice && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextArchived = !previewInvoice.isArchived;
                            onToggleArchiveInvoice(previewInvoice.id);
                            setPreviewInvoice({
                              ...previewInvoice,
                              isArchived: nextArchived,
                              archivedAt: nextArchived ? new Date().toISOString() : null,
                            });
                            setShowPreviewMenu(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                        >
                          {previewInvoice.isArchived ? (
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                          {previewInvoice.isArchived ? 'Aus Archiv wiederherstellen' : 'Archivieren'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setShowPreviewMenu(false);
                          void handleOpenPdf(previewInvoice);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF öffnen / herunterladen
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowPreviewMenu(false);
                          void handlePrint(previewInvoice);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Drucken
                      </button>

                      {previewInvoice.documentType === 'quote' && (
                        <button
                          type="button"
                          onClick={() => handleConvertQuoteToInvoice(previewInvoice)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:text-violet-300 dark:hover:bg-[#2a2045] cursor-pointer"
                        >
                          <ArrowRightCircle className="h-3.5 w-3.5" />
                          In Rechnung umwandeln
                        </button>
                      )}

                      {getLinkedEntriesForInvoice(previewInvoice).length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowPreviewMenu(false);
                            void handleDownloadTimesheet(previewInvoice);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                        >
                          <Clock className="h-3.5 w-3.5" />
                          Tätigkeitsbericht (PDF)
                        </button>
                      )}

                      {isInvoiceOverdue(previewInvoice) && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowPreviewMenu(false);
                            void handlePaymentReminderPdf(previewInvoice);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/60 cursor-pointer"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Zahlungserinnerung (PDF)
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setShowPreviewMenu(false);
                          setSignatureModalOpen(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-[#2a2045] cursor-pointer"
                      >
                        <PenTool className="h-3.5 w-3.5" />
                        {previewInvoice.signature
                          ? 'Abnahme / Unterschrift bearbeiten'
                          : 'Abnahme unterschreiben'}
                      </button>

                      {previewInvoice.signature && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPreviewMenu(false);
                              void handleDownloadProtocolPdf(previewInvoice);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                          >
                            <FileCheck2 className="h-3.5 w-3.5" />
                            Abnahmeprotokoll (PDF)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPreviewMenu(false);
                              void handleShareProtocolPdf(previewInvoice);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            Abnahmeprotokoll teilen
                          </button>
                          {nextcloud.configured && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowPreviewMenu(false);
                                void handleUploadProtocolToNextcloud(previewInvoice);
                              }}
                              disabled={uploadingId === previewInvoice.id}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-[#2a2045] cursor-pointer"
                            >
                              <CloudUpload className="h-3.5 w-3.5" />
                              Abnahme-PDF → Nextcloud
                            </button>
                          )}
                        </>
                      )}

                      {previewInvoice.documentType !== 'quote' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPreviewMenu(false);
                              void handleDownloadXRechnungXml(previewInvoice);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                          >
                            <FileCode2 className="h-3.5 w-3.5" />
                            XRechnung (.xml)
                          </button>
                          {nextcloud.configured && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowPreviewMenu(false);
                                void handleUploadXRechnungXml(previewInvoice);
                              }}
                              disabled={uploadingId === previewInvoice.id}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-[#2a2045] cursor-pointer"
                            >
                              <CloudUpload className="h-3.5 w-3.5" />
                              XML → Nextcloud
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {!previewInvoice.signature && onSaveSignature && (
                  <button
                    type="button"
                    onClick={() => setSignatureModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <PenTool className="h-3.5 w-3.5" />
                    Abnahme
                  </button>
                )}

                {/* Directly visible top-bar buttons: Teilen, PDF -> Nextcloud, Löschen, Schließen */}
                <button
                  type="button"
                  onClick={() => void handleSharePdf(previewInvoice)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Teilen
                </button>

                <button
                  type="button"
                  onClick={() => void handleUploadToNextcloud(previewInvoice)}
                  disabled={uploadingId === previewInvoice.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  {uploadingId === previewInvoice.id
                    ? 'Lade hoch...'
                    : 'PDF → Nextcloud'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (confirmDeleteId === previewInvoice.id) {
                      onDeleteInvoice(previewInvoice.id);
                      setConfirmDeleteId(null);
                      setPreviewInvoice(null);
                    } else {
                      setConfirmDeleteId(previewInvoice.id);
                    }
                  }}
                  title="Dokument löschen (Arbeitszeiten bleiben erhalten)"
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer ${
                    confirmDeleteId === previewInvoice.id
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300'
                      : 'border-slate-200 text-red-600 hover:bg-red-50 dark:border-[#3b2d5e] dark:text-red-400 dark:hover:bg-red-950/40'
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {confirmDeleteId === previewInvoice.id
                    ? 'Wirklich löschen? (Zeiten bleiben)'
                    : 'Löschen'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    setShowPreviewMenu(false);
                    setPreviewInvoice(null);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#231b38] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {layoutStyle === 'modern' && (
              <div className={`h-3 w-full ${accentStyle.bgClass}`} />
            )}

            {/* DIN-inspired Printable Sheet (always crisp white paper) */}
            <div className={`p-8 sm:p-12 bg-white text-slate-900 rounded-b-xl ${fontOption.previewClass}`}>
              <div className="flex flex-col justify-between gap-6 sm:flex-row">
                <div>
                  <div className="text-[11px] text-slate-500 underline">
                    {company.companyName} · {company.street} · {company.postalCode}{' '}
                    {company.city}
                  </div>
                  <div className="mt-4 text-sm">
                    <div className="font-semibold">
                      {previewInvoice.customerSnapshot.companyName}
                    </div>
                    {previewInvoice.customerSnapshot.contactName && (
                      <div>{previewInvoice.customerSnapshot.contactName}</div>
                    )}
                    <div>{previewInvoice.customerSnapshot.street}</div>
                    <div>
                      {previewInvoice.customerSnapshot.postalCode}{' '}
                      {previewInvoice.customerSnapshot.city}
                    </div>
                    {previewInvoice.customerSnapshot.vatId && (
                      <div className="mt-1 text-xs text-slate-500">
                        USt-IdNr.: {previewInvoice.customerSnapshot.vatId}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  {company.logoDataUrl && company.invoiceShowLogo !== false && (
                    <div className="mb-3 flex sm:justify-end">
                      <img
                        src={company.logoDataUrl}
                        alt={`${company.companyName} Logo`}
                        className="max-h-14 max-w-[180px] object-contain"
                      />
                    </div>
                  )}
                  <div className={`text-lg font-bold ${accentStyle.textClass}`}>
                    {company.companyName}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 space-y-0.5">
                    <div>{company.ownerName}</div>
                    <div>{company.street}</div>
                    <div>
                      {company.postalCode} {company.city}
                    </div>
                    <div>{company.email}</div>
                  </div>

                  <div
                    className={`mt-5 rounded-lg p-3 text-xs space-y-1 text-left ${
                      layoutStyle === 'minimal'
                        ? 'border-l-2 border-slate-300 bg-transparent pl-3'
                        : 'border border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">
                        {previewInvoice.documentType === 'quote' ? 'Angebotsnr.' : 'Rechnungsnr.'}
                      </span>
                      <span className="font-mono font-semibold">
                        {previewInvoice.invoiceNumber}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">Datum</span>
                      <span className="font-mono tabular-nums">
                        {formatDateDE(previewInvoice.issueDate)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">Leistungszeitraum</span>
                      <span className="font-mono tabular-nums">
                        {formatDateDE(previewInvoice.servicePeriodStart)} –{' '}
                        {formatDateDE(previewInvoice.servicePeriodEnd)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">
                        {previewInvoice.documentType === 'quote' ? 'Gültig bis' : 'Fällig bis'}
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatDateDE(previewInvoice.quoteValidUntil || previewInvoice.dueDate)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <h2 className={`mt-8 text-xl font-bold ${accentStyle.textClass}`}>
                {previewInvoice.documentType === 'quote' ? quoteTitle : headerTitle}{' '}
                {previewInvoice.invoiceNumber}
              </h2>
              {previewInvoice.introText && (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                  {previewInvoice.introText}
                </p>
              )}

              {(() => {
                const previewSmallBiz =
                  previewInvoice.isSmallBusiness ?? Boolean(company.smallBusinessMode);
                const smallBizText =
                  previewInvoice.smallBusinessNotice ||
                  company.smallBusinessNotice ||
                  'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

                return (
                  <>
                    <table className="mt-6 w-full text-left text-sm">
                      <thead>
                        <tr className={`border-b-2 ${accentStyle.borderClass} text-xs font-semibold text-slate-600`}>
                          <th className="py-2 pr-2">Pos.</th>
                          <th className="py-2 pr-2">Beschreibung</th>
                          <th className="py-2 px-2 text-right">Menge</th>
                          <th className="py-2 px-2 text-right">Einzelpreis</th>
                          {!previewSmallBiz && (
                            <th className="py-2 px-2 text-right">MwSt.</th>
                          )}
                          <th className="py-2 pl-2 text-right">
                            {previewSmallBiz ? 'Gesamt' : 'Netto'}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {previewInvoice.lineItems.map((item, idx) => (
                          <tr key={item.id}>
                            <td className="py-3 pr-2 font-mono text-xs text-slate-500 align-top">
                              {idx + 1}
                            </td>
                            <td className="py-3 pr-2 align-top">
                              <div className="font-medium text-slate-900">
                                {item.description}
                              </div>
                              {item.detail && (
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {item.detail}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs tabular-nums align-top whitespace-nowrap">
                              {formatNumber(item.quantity, 2)} {item.unit}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs tabular-nums align-top whitespace-nowrap">
                              {formatCurrency(item.unitPriceNet)}
                            </td>
                            {!previewSmallBiz && (
                              <td className="py-3 px-2 text-right font-mono text-xs tabular-nums align-top whitespace-nowrap">
                                {item.taxRate} %
                              </td>
                            )}
                            <td className="py-3 pl-2 text-right font-mono text-sm font-medium tabular-nums align-top whitespace-nowrap">
                              {formatCurrency(item.netTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-6 flex justify-end">
                      <div className="w-full max-w-xs space-y-1.5 text-sm">
                        {(previewInvoice.discountNetAmount ?? 0) > 0 && (
                          <>
                            <div className="flex justify-between text-slate-600">
                              <span>Zwischensumme Netto</span>
                              <span className="font-mono tabular-nums">
                                {formatCurrency(
                                  previewInvoice.subtotalNetBeforeDiscount ??
                                    previewInvoice.netTotal + (previewInvoice.discountNetAmount ?? 0)
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between text-emerald-700">
                              <span>
                                {previewInvoice.discountLabel || 'Rabatt'}
                                {previewInvoice.discountType === 'percent' && previewInvoice.discountValue
                                  ? ` (${previewInvoice.discountValue}%)`
                                  : ''}
                              </span>
                              <span className="font-mono tabular-nums">
                                − {formatCurrency(previewInvoice.discountNetAmount ?? 0)}
                              </span>
                            </div>
                          </>
                        )}
                        {!previewSmallBiz && (
                          <>
                            <div className="flex justify-between text-slate-600">
                              <span>Summe Netto</span>
                              <span className="font-mono tabular-nums">
                                {formatCurrency(previewInvoice.netTotal)}
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-600">
                              <span>Umsatzsteuer</span>
                              <span className="font-mono tabular-nums">
                                {formatCurrency(previewInvoice.taxTotal)}
                              </span>
                            </div>
                          </>
                        )}
                        <div className={`flex justify-between border-t-2 ${accentStyle.borderClass} pt-2 text-base font-bold ${accentStyle.textClass}`}>
                          <span>
                            {previewInvoice.documentType === 'quote'
                              ? 'Angebotsbetrag'
                              : 'Rechnungsbetrag'}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatCurrency(
                              previewSmallBiz
                                ? previewInvoice.netTotal
                                : previewInvoice.grossTotal
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {previewSmallBiz && (
                      <p className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-700">
                        {smallBizText}
                      </p>
                    )}
                  </>
                );
              })()}

              <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  {previewInvoice.outroText && (
                    <p className="whitespace-pre-line text-xs text-slate-600">
                      {previewInvoice.outroText}
                    </p>
                  )}

                  {company.invoiceFooterNote && (
                    <p className="mt-3 whitespace-pre-line text-xs italic text-slate-500">
                      {company.invoiceFooterNote}
                    </p>
                  )}
                </div>

                {previewGiroCodeUrl && (
                  <div className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
                    <img
                      src={previewGiroCodeUrl}
                      alt="GiroCode (EPC-QR-Code)"
                      className="mx-auto h-24 w-24"
                    />
                    <div className="mt-1 text-[10px] font-semibold text-slate-600">
                      GiroCode (EPC-QR)
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-10 grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 text-[11px] text-slate-500 sm:grid-cols-3">
                <div>
                  <div className="font-semibold text-slate-700">{company.companyName}</div>
                  <div>
                    {company.street}, {company.postalCode} {company.city}
                  </div>
                </div>
                <div>
                  <div>Bank: {company.bankName}</div>
                  <div>IBAN: {company.iban}</div>
                  <div>BIC: {company.bic}</div>
                </div>
                <div>
                  <div>Steuernr.: {company.taxNumber}</div>
                  <div>USt-IdNr.: {company.vatId}</div>
                  <div>E-Mail: {company.email}</div>
                </div>
              </div>

              {previewInvoice.signature && (
                <div className="mt-6 flex flex-col gap-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 text-xs text-slate-700">
                    <div className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />
                      Leistungsabnahme digital unterschrieben
                    </div>
                    <div>
                      Unterzeichner: <span className="font-semibold">{previewInvoice.signature.signedBy}</span>
                      {previewInvoice.signature.signedRole ? ` (${previewInvoice.signature.signedRole})` : ''}
                    </div>
                    <div className="text-slate-500">
                      Datum: {formatDateTimeDE(previewInvoice.signature.signedAt)}
                      {previewInvoice.signature.locationAddress ? ` · Ort: ${previewInvoice.signature.locationAddress}` : ''}
                    </div>
                    {previewInvoice.signature.notes && (
                      <div className="italic text-slate-600">
                        Hinweis: {previewInvoice.signature.notes}
                      </div>
                    )}
                    {onDeleteSignature && (
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteSignature(previewInvoice.id);
                          setPreviewInvoice((prev) =>
                            prev ? { ...prev, signature: undefined } : null
                          );
                        }}
                        className="no-print mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline cursor-pointer"
                      >
                        Unterschrift entfernen
                      </button>
                    )}
                  </div>
                  <div className="shrink-0 rounded-lg border border-slate-200 bg-white p-2">
                    <img
                      src={previewInvoice.signature.signatureDataUrl}
                      alt={`Unterschrift ${previewInvoice.signature.signedBy}`}
                      className="h-20 w-48 object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {previewInvoice && (
        <SignaturePadModal
          open={signatureModalOpen}
          title={`Abnahmeprotokoll · ${previewInvoice.invoiceNumber}`}
          subtitle={`${previewInvoice.customerSnapshot.companyName} (${formatCurrency(previewInvoice.grossTotal)})`}
          initialSignature={previewInvoice.signature}
          defaultSignerName={previewInvoice.customerSnapshot.contactName || previewInvoice.customerSnapshot.companyName}
          onClose={() => setSignatureModalOpen(false)}
          onSave={(sig) => {
            if (onSaveSignature) {
              onSaveSignature(previewInvoice.id, sig);
              setPreviewInvoice((prev) => (prev ? { ...prev, signature: sig } : null));
            }
            setSignatureModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
