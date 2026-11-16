export type ProductType = 'service' | 'product';

export type UnitType = 'Std.' | 'Stk.' | 'Pauschal' | 'Tag';

export type TaxRate = 19 | 7 | 0;

export type InvoiceStatus = 'Entwurf' | 'Gesendet' | 'Bezahlt' | 'Storniert';

export type NavSection =
  | 'tracker'
  | 'analytics'
  | 'nfc'
  | 'customers'
  | 'products'
  | 'invoices'
  | 'settings';

export interface Customer {
  id: string;
  customerNumber: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  vatId: string;
  paymentTermDays: number;
  notes: string;
  createdAt: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  type: ProductType;
  unit: UnitType;
  unitPriceNet: number;
  taxRate: TaxRate;
  createdAt: string;
}

export interface NfcTask {
  id: string;
  tagUid: string;
  title: string;
  description: string;
  customerId: string;
  productId: string;
  autoStopPrevious: boolean;
  toggleOnRescan: boolean;
  triggerCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  customerId: string;
  productId: string;
  nfcTaskId: string | null;
  title: string;
  notes: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  hourlyRateNet: number;
  taxRate: TaxRate;
  billable: boolean;
  billedInvoiceId: string | null;
  source: 'manual' | 'timer' | 'nfc';
  createdAt: string;
}

export interface ActiveTimer {
  id: string;
  customerId: string;
  productId: string;
  nfcTaskId: string | null;
  title: string;
  notes: string;
  startTime: string;
  hourlyRateNet: number;
  taxRate: TaxRate;
  source: 'timer' | 'nfc';
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  detail: string;
  quantity: number;
  unit: UnitType;
  unitPriceNet: number;
  taxRate: TaxRate;
  netTotal: number;
  taxAmount: number;
  grossTotal: number;
  timeEntryIds: string[];
  productId: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerSnapshot: {
    companyName: string;
    contactName: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
    vatId: string;
    email: string;
  };
  issueDate: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  dueDate: string;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
  introText: string;
  outroText: string;
  isSmallBusiness?: boolean;
  smallBusinessNotice?: string;
  nextcloudUploadedAt: string | null;
  createdAt: string;
}

export type InvoiceAccentPreset = 'slate' | 'blue' | 'violet' | 'emerald' | 'rose';

export interface CompanyProfile {
  companyName: string;
  ownerName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  taxNumber: string;
  vatId: string;
  bankName: string;
  iban: string;
  bic: string;
  invoicePrefix: string;
  nextInvoiceSequence: number;
  defaultPaymentTermDays: number;
  logoDataUrl?: string;
  invoiceShowLogo?: boolean;
  invoiceNumberPattern?: string;
  invoiceSequenceDigits?: number;
  invoiceAccentColor?: InvoiceAccentPreset;
  invoiceHeaderTitle?: string;
  invoiceDefaultIntroText?: string;
  invoiceDefaultOutroText?: string;
  invoiceFooterNote?: string;
  smallBusinessMode?: boolean;
  smallBusinessNotice?: string;
}

export interface AppDatabase {
  version: number;
  updatedAt: string;
  company: CompanyProfile;
  customers: Customer[];
  products: Product[];
  nfcTasks: NfcTask[];
  timeEntries: TimeEntry[];
  activeTimer: ActiveTimer | null;
  invoices: Invoice[];
}

export interface NextcloudConfigInfo {
  configured: boolean;
  url: string;
  username: string;
  folder: string;
  autoSync: boolean;
  hasPassword: boolean;
  fromEnv: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}
