// How the backend's codes read on screen, and the colour of their status pills, as in the wireframe:
// green for done or in good standing, amber for waiting, red for refused or stopped, grey otherwise.

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad';

interface Label {
  text: string;
  tone: Tone;
}

const MEMBER_STATUS: Record<string, Label> = {
  active: { text: 'Active', tone: 'ok' },
  inactive: { text: 'Inactive', tone: 'neutral' },
  disabled: { text: 'Disabled', tone: 'bad' }
};

const KYC: Record<string, Label> = {
  not_submitted: { text: 'Not submitted', tone: 'neutral' },
  pending: { text: 'Pending', tone: 'warn' },
  verified: { text: 'Verified', tone: 'ok' },
  rejected: { text: 'Rejected', tone: 'bad' }
};

// complete is a document approved, partial a map pin only (BlockCoop #32)
const PROOF_OF_ADDRESS: Record<string, Label> = {
  complete: { text: 'Complete', tone: 'ok' },
  partial: { text: 'Map pin only', tone: 'warn' },
  none: { text: 'None', tone: 'neutral' }
};

const CONNECTION_STATUS: Record<string, Label> = {
  pending: { text: 'Pending', tone: 'warn' },
  accepted: { text: 'Accepted', tone: 'ok' },
  rejected: { text: 'Rejected', tone: 'bad' }
};

const GUARANTEE_STATUS: Record<string, Label> = {
  pending_payment: { text: 'Quote', tone: 'warn' },
  active: { text: 'Active', tone: 'ok' },
  in_claim: { text: 'In claim', tone: 'bad' },
  closed: { text: 'Closed', tone: 'neutral' },
  expired: { text: 'Expired', tone: 'neutral' }
};

function pick(table: Record<string, Label>, code: string | null | undefined): Label {
  if (!code) return { text: '—', tone: 'neutral' };
  return table[code] ?? { text: sentence(code), tone: 'neutral' };
}

/** A code the tables don't know yet, shown readably rather than hidden: `in_review` → "In review". */
export function sentence(code: string): string {
  const s = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const memberStatus = (code: string | null | undefined) => pick(MEMBER_STATUS, code);
export const kycStatus = (code: string | null | undefined) => pick(KYC, code);
export const proofOfAddress = (code: string | null | undefined) => pick(PROOF_OF_ADDRESS, code);
export const connectionStatus = (code: string | null | undefined) => pick(CONNECTION_STATUS, code);
export const guaranteeStatus = (code: string | null | undefined) => pick(GUARANTEE_STATUS, code);

const CONNECTION_TYPE: Record<string, string> = {
  mutual_trust: 'Mutual trust',
  trust: 'Trust',
  connection: 'Connection',
  referral: 'Referral'
};

export const connectionType = (code: string | null | undefined) => (code ? CONNECTION_TYPE[code] ?? sentence(code) : '—');

export const PILLARS = ['identity', 'relationship', 'activity', 'financial'] as const;

const PILLAR: Record<string, string> = {
  identity: 'Identity',
  relationship: 'Relationship',
  activity: 'Activity',
  financial: 'Financial'
};

export const pillarName = (code: string | null | undefined) => (code ? PILLAR[code] ?? sentence(code) : '—');

const METRIC: Record<string, string> = {
  kyc_verified: 'KYC verified',
  phone_verified: 'Phone verified',
  proof_of_address: 'Proof of address',
  account_age: 'Account age',
  network_size: 'Network size',
  relationship_longevity: 'Relationship longevity',
  network_value: 'Network value',
  deposit_transactions: 'Deposit transactions',
  deposit_volume: 'Deposit volume',
  locked_savings_frequency: 'Locked savings frequency',
  active_weeks: 'Active weeks',
  blocks_staked: 'BLOCKS staked',
  lp_held: 'LP tokens held',
  loans_taken: 'Loans taken',
  loans_repaid_on_time: 'Loans repaid on time',
  defaults: 'Defaults',
  external_credit: 'External credit'
};

export const metricName = (code: string | null | undefined) => (code ? METRIC[code] ?? sentence(code) : '—');

// what made the Trust Score change
const TRIGGER: Record<string, string> = {
  event: 'Something the member did',
  nightly: 'Nightly recalculation',
  parameter: 'A pool setting changed',
  valuation: 'Prices changed'
};

export const scoreTrigger = (code: string | null | undefined) => (code ? TRIGGER[code] ?? sentence(code) : '—');

/** A share held as a fraction (0.15) shown as a percentage ("15%"). */
export function percent(fraction: number | string | null | undefined): string {
  if (fraction === null || fraction === undefined || fraction === '') return '—';
  const n = Number(fraction);
  if (!Number.isFinite(n)) return '—';
  return `${Number((n * 100).toFixed(2))}%`;
}

// a proof of address document's review (BlockCoop D-025)
const DOCUMENT_STATUS: Record<string, Label> = {
  pending: { text: 'Pending', tone: 'warn' },
  approved: { text: 'Approved', tone: 'ok' },
  rejected: { text: 'Rejected', tone: 'bad' }
};

export const documentStatus = (code: string | null | undefined) => pick(DOCUMENT_STATUS, code);

const ID_TYPE: Record<string, string> = {
  national_id: 'National ID',
  passport: 'Passport',
  alien_id: 'Alien ID'
};

export const idType = (code: string | null | undefined) => (code ? ID_TYPE[code] ?? sentence(code) : '—');

const DOCUMENT_TYPE: Record<string, string> = {
  utility_bill: 'Utility bill',
  bank_statement: 'Bank statement'
};

export const documentType = (code: string | null | undefined) => (code ? DOCUMENT_TYPE[code] ?? sentence(code) : '—');

// an open quote is "quoted" in the API, and "Open" on screen as in the wireframe (BlockCoop #140)
const QUOTE_STATUS: Record<string, Label> = {
  quoted: { text: 'Open', tone: 'warn' },
  accepted: { text: 'Accepted', tone: 'warn' },
  paid: { text: 'Paid', tone: 'ok' },
  replaced: { text: 'Replaced', tone: 'neutral' },
  expired: { text: 'Expired', tone: 'neutral' }
};

export const quoteStatus = (code: string | null | undefined) => pick(QUOTE_STATUS, code);

const PAYMENT_STATUS: Record<string, Label> = {
  pending: { text: 'Pending', tone: 'warn' },
  confirmed: { text: 'Paid', tone: 'ok' },
  failed: { text: 'Failed', tone: 'bad' },
  refunded: { text: 'Refunded', tone: 'neutral' },
  needs_confirmation: { text: 'Needs confirmation', tone: 'warn' }
};

export const paymentStatus = (code: string | null | undefined) => pick(PAYMENT_STATUS, code);

// the Lipa API's own status for a payment on a quote
const LIPA_STATUS: Record<string, Label> = {
  PROCESSING: { text: 'Processing', tone: 'warn' },
  SUCCESS: { text: 'Success', tone: 'ok' },
  FAILED: { text: 'Failed', tone: 'bad' }
};

export const lipaStatus = (code: string | null | undefined) => pick(LIPA_STATUS, code);

const PAYMENT_METHOD: Record<string, string> = {
  lipa: 'Lipa API',
  wallet: 'Wallet',
  mobile_money: 'M-Pesa'
};

export const paymentMethod = (code: string | null | undefined) => (code ? PAYMENT_METHOD[code] ?? sentence(code) : '—');
