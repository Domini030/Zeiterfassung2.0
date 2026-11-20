export type ProductType = 'service' | 'product';

export type UnitType = 'Std.' | 'Stk.' | 'Pauschal' | 'Tag';

export type TaxRate = 19 | 7 | 0;

export type TimeRoundingMinutes = 0 | 5 | 10 | 15 | 30;

export type InvoiceStatus = 'Entwurf' | 'Gesendet' | 'Bezahlt' | 'Storniert';

export type DocumentType = 'invoice' | 'quote';

export type DiscountType = 'percent' | 'fixed';

export type NavSection =
  | 'tracker'
  | 'calendar'
  | 'analytics'
  | 'nfc'
  | 'customers'
  | 'products'
  | 'expenses'
  | 'recurring'
  | 'invoices'
  | 'settings';

export interface LocationSnapshot {
  lat: number;
  lng: number;
  address?: string;
  accuracyMeters?: number;
  capturedAt: string;
}

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
  timeRoundingMinutes?: TimeRoundingMinutes | null;
  budgetHours?: number | null;
  budgetAmountNet?: number | null;
  budgetPeriod?: 'monthly' | 'total';
  category?: string;
  notes: string;
  createdAt: string;
}

export interface WorkPhoto {
  id: string;
  dataUrl: string;
  caption?: string;
  capturedAt: string;
  nextcloudPath?: string;
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
  category?: string;
  createdAt: string;
}

export type NfcTagActionMode = 'task' | 'pauseToggle';

export type NfcPreviousTimerAction = 'stop' | 'pause' | 'discard';

export interface NfcTask {
  id: string;
  tagUid: string;
  title: string;
  description: string;
  entryType?: 'project' | 'internal';
  internalCategory?: string;
  customerId: string;
  productId: string;
  actionMode?: NfcTagActionMode;
  previousTimerAction?: NfcPreviousTimerAction;
  autoResumePausedOnStop?: boolean;
  autoStopPrevious: boolean;
  toggleOnRescan: boolean;
  triggerCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface GeoFenceRule {
  id: string;
  name: string;
  enabled: boolean;
  lat: number;
  lng: number;
  address?: string;
  radiusMeters: number;
  customerId: string;
  productId: string;
  taskTitle: string;
  notes: string;
  autoStopOnExit?: boolean;
  lastTriggeredAt?: string | null;
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
  source: 'manual' | 'timer' | 'nfc' | 'geo';
  location?: LocationSnapshot | null;
  travelDistanceKm?: number;
  travelCostNet?: number;
  travelBilledInvoiceId?: string | null;
  entryType?: 'project' | 'internal';
  internalCategory?: string;
  photos?: WorkPhoto[];
  createdAt: string;
}

export interface ActiveTimer {
  id: string;
  customerId: string;
  productId: string;
  nfcTaskId: string | null;
  geoFenceRuleId?: string | null;
  title: string;
  notes: string;
  startTime: string;
  pausedAt?: string | null;
  accumulatedPausedMs?: number;
  hourlyRateNet: number;
  taxRate: TaxRate;
  source: 'timer' | 'nfc' | 'geo';
  location?: LocationSnapshot | null;
  entryType?: 'project' | 'internal';
  internalCategory?: string;
  photos?: WorkPhoto[];
  pausedByNfcTaskId?: string | null;
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

export interface AcceptanceSignature {
  signedBy: string;
  signedRole?: string;
  signedAt: string;
  locationAddress?: string;
  notes?: string;
  signatureDataUrl: string;
}

export interface Invoice {
  id: string;
  documentType?: DocumentType;
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
  quoteValidUntil?: string;
  status: InvoiceStatus;
  includeLocation?: boolean;
  includeTimeNotes?: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
  lineItems: InvoiceLineItem[];
  subtotalNetBeforeDiscount?: number;
  discountType?: DiscountType;
  discountValue?: number;
  discountLabel?: string;
  discountNetAmount?: number;
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
  introText: string;
  outroText: string;
  isSmallBusiness?: boolean;
  smallBusinessNotice?: string;
  signature?: AcceptanceSignature | null;
  nextcloudUploadedAt: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  date: string;
  vendor: string;
  description: string;
  category: string;
  expenseType?: 'project' | 'operating';
  netAmount: number;
  taxRate: TaxRate;
  grossAmount: number;
  customerId?: string | null;
  billableToCustomer?: boolean;
  billedInvoiceId?: string | null;
  receiptImageDataUrl?: string;
  notes?: string;
  isRecurring?: boolean;
  recurringExpenseId?: string | null;
  nextcloudUploadedAt?: string | null;
  createdAt: string;
}

export type RecurringInterval = 'monthly' | 'quarterly' | 'yearly';

export interface RecurringLineItemDraft {
  id: string;
  productId?: string | null;
  description: string;
  detail?: string;
  quantity: number;
  unit: UnitType;
  unitPriceNet: number;
  taxRate: TaxRate;
}

export interface RecurringInvoiceTemplate {
  id: string;
  title: string;
  customerId: string;
  interval: RecurringInterval;
  active: boolean;
  nextRunDate: string;
  lastRunDate?: string | null;
  generatedCount: number;
  lineItems: RecurringLineItemDraft[];
  discountType?: DiscountType;
  discountValue?: number;
  discountLabel?: string;
  introText?: string;
  outroText?: string;
  isSmallBusiness?: boolean;
  autoMarkSent?: boolean;
  createdAt: string;
}

export interface RecurringExpense {
  id: string;
  vendor: string;
  description: string;
  category: string;
  netAmount: number;
  taxRate: TaxRate;
  grossAmount: number;
  interval: RecurringInterval;
  active: boolean;
  nextDueDate: string;
  lastBookedDate?: string | null;
  receiptImageDataUrl?: string;
  notes?: string;
  createdAt: string;
}

export interface HomeBaseLocation {
  address: string;
  lat: number;
  lng: number;
}

export type InvoiceAccentPreset =
  | 'slate'
  | 'blue'
  | 'violet'
  | 'emerald'
  | 'rose'
  | 'teal'
  | 'amber'
  | 'indigo'
  | 'custom';

export type InvoiceFontFamily = 'sans' | 'serif' | 'mono';

export type InvoiceLayoutStyle = 'classic' | 'modern' | 'minimal';

export type UiAccentPreset = 'violet' | 'blue' | 'emerald' | 'amber' | 'rose' | 'custom';

export type UiDensity = 'comfortable' | 'compact';

export type UiFontScale = 'normal' | 'large';

export type ReminderSoundPreset =
  | 'device'
  | 'popcorn'
  | 'eureka'
  | 'chord'
  | 'droplet'
  | 'crystal'
  | 'marimba'
  | 'piano'
  | 'chime'
  | 'bell'
  | 'woodblock'
  | 'sonar'
  | 'fanfare'
  | 'pulse'
  | 'alarm'
  | 'silent';

export type AutoBackupFrequency = 'daily' | 'weekly' | 'monthly';

export type AutoBackupFormat = 'json' | 'csv' | 'excel' | 'pdf' | 'invoices_zip';

export interface AutoBackupConfig {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  formats: AutoBackupFormat[];
  uploadToNextcloud: boolean;
  localDownload: boolean;
  lastRunAt: string | null;
  lastRunSummary?: string | null;
  maxBackupVersions?: number;
}

export interface BackupVersionEntry {
  id: string;
  label: string;
  createdAt: string;
  filename: string;
  sizeBytes: number;
  source: 'manual' | 'auto' | 'pre-restore';
  nextcloudPath?: string;
  counts: {
    timeEntries: number;
    invoices: number;
    customers: number;
    products: number;
  };
}

export interface NextcloudCalendarConfig {
  selectedCalendarUrl: string;
  selectedCalendarName: string;
  autoSyncTimeEntries: boolean;
}

export interface CalendarAppointment {
  id: string;
  uid?: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
  calendarName?: string;
  source: 'nextcloud' | 'local';
  customerId?: string | null;
  productId?: string | null;
}

export interface EmailTemplatesConfig {
  invoiceSubject: string;
  invoiceBody: string;
  quoteSubject: string;
  quoteBody: string;
  reminderSubject: string;
  reminderBody: string;
}

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
  defaultTimeRoundingMinutes?: TimeRoundingMinutes;
  logoDataUrl?: string;
  invoiceShowLogo?: boolean;
  invoiceNumberPattern?: string;
  invoiceSequenceDigits?: number;
  invoiceAccentColor?: InvoiceAccentPreset;
  invoiceCustomAccentHex?: string;
  invoiceFontFamily?: InvoiceFontFamily;
  invoiceLayoutStyle?: InvoiceLayoutStyle;
  invoiceHeaderTitle?: string;
  invoiceDefaultIntroText?: string;
  invoiceDefaultOutroText?: string;
  invoiceFooterNote?: string;
  quotePrefix?: string;
  nextQuoteSequence?: number;
  quoteNumberPattern?: string;
  quoteHeaderTitle?: string;
  quoteDefaultIntroText?: string;
  quoteDefaultOutroText?: string;
  productPrefix?: string;
  nextProductSequence?: number;
  productSequenceDigits?: number;
  productNumberPattern?: string;
  skuFieldLabel?: string;
  customerCategories?: string[];
  productCategories?: string[];
  expenseCategories?: string[];
  smallBusinessMode?: boolean;
  smallBusinessNotice?: string;
  uiAccent?: UiAccentPreset;
  uiCustomAccentHex?: string;
  uiDensity?: UiDensity;
  uiFontScale?: UiFontScale;
  defaultStartSection?: NavSection;
  swipeNavigationEnabled?: boolean;
  autoCaptureLocation?: boolean;
  invoiceIncludeLocationDefault?: boolean;
  invoiceIncludeTimeNotesDefault?: boolean;
  internalCategories?: string[];
  autoLocationStartEnabled?: boolean;
  geoFenceCheckIntervalSec?: number;
  homeBaseLocation?: HomeBaseLocation | null;
  travelRatePerKm?: number;
  travelRoundTripDefault?: boolean;
  autoCalculateTravelOnStop?: boolean;
  dailyGoalHours?: number;
  timerReminderEnabled?: boolean;
  timerReminderMinutes?: number;
  timerReminderSound?: ReminderSoundPreset;
  timerReminderSystemSoundUri?: string;
  timerReminderSystemSoundTitle?: string;
  autoBackup?: AutoBackupConfig;
  calendarConfig?: NextcloudCalendarConfig;
  emailTemplates?: EmailTemplatesConfig;
  githubUpdateRepo?: string;
  autoCheckUpdates?: boolean;
  geoExitConfirmMode?: 'ask' | 'auto';
  breakAssistantEnabled?: boolean;
  breakTriggerHours?: number;
  breakDefaultMinutes?: number;
  overnightReminderHour?: number;
  appLockEnabled?: boolean;
  appLockBiometric?: boolean;
  appLockPinHash?: string;
  appLockTimeoutMinutes?: number;
  lockscreenTimerControlsEnabled?: boolean;
}

export interface AppDatabase {
  version: number;
  updatedAt: string;
  syncDeviceId?: string;
  activeTimerUpdatedAt?: string;
  pausedTimersUpdatedAt?: string;
  companyUpdatedAt?: string;
  deletedIds?: Record<string, string>;
  recordUpdatedAt?: Record<string, string>;
  company: CompanyProfile;
  customers: Customer[];
  products: Product[];
  nfcTasks: NfcTask[];
  geoFenceRules?: GeoFenceRule[];
  timeEntries: TimeEntry[];
  activeTimer: ActiveTimer | null;
  pausedTimers?: ActiveTimer[];
  invoices: Invoice[];
  expenses?: Expense[];
  recurringExpenses?: RecurringExpense[];
  recurringInvoices?: RecurringInvoiceTemplate[];
  calendarEvents?: CalendarAppointment[];
}

export interface NextcloudConfigInfo {
  configured: boolean;
  url: string;
  username: string;
  folder: string;
  autoSync: boolean;
  syncIntervalSec?: number;
  pendingPush?: boolean;
  hasPassword: boolean;
  fromEnv: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface SyncPairingPayload {
  v: 1;
  url: string;
  username: string;
  appPassword: string;
  folder: string;
  autoSync: boolean;
  syncIntervalSec?: number;
  calendarUrl?: string;
  calendarName?: string;
  autoSyncTimeEntries?: boolean;
}
