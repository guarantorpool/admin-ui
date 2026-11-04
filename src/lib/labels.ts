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

// a refund is owed, then entered by one admin, then paid once a second admin approves it (3.5 Refunds)
const REFUND_STATUS: Record<string, Label> = {
  owed: { text: 'Owed', tone: 'warn' },
  entered: { text: 'Entered', tone: 'warn' },
  paid: { text: 'Paid', tone: 'ok' }
};

export const refundStatus = (code: string | null | undefined) => pick(REFUND_STATUS, code);

// The refund types the Lipa API can owe, as the filter offers them; the last two below only exist from before D-039.
export const REFUND_TYPES = ['overpayment', 'window_lapsed', 'capacity_changed', 'stray_payment', 'amount_mismatch'] as const;

// why each type is owed, in the brief's words (screen 11)
const REFUND_WHY: Record<string, string> = {
  overpayment: 'More than the amount due arrived. The extra is owed back.',
  window_lapsed: 'The USDT arrived after the quote ended.',
  capacity_changed: 'The USDT arrived, but the pool had no capacity left for the guarantee.',
  stray_payment: "The USDT arrived for a quote already replaced or paid, or while a claim paused the member's new guarantees.",
  amount_mismatch: 'Less than the amount due arrived, so it was never credited. The quote stays open.',
  payment_failed: 'A direct payment, from before the Lipa API, failed after part of it arrived.',
  blocks_payment: 'Paid in BLOCKS on a payment started before premiums were priced in USDT, so it never activated.'
};

export const refundWhy = (code: string | null | undefined) => (code ? REFUND_WHY[code] ?? sentence(code) : '—');

// A guaranteed loan is open until the lender reports it repaid or defaulted. A default's claim is verified against
// its documents, paid once claim_waiting_days have passed, then recovered or written off (3.5).
interface LoanState {
  status?: string;
  claimPaid?: string;
  defaultVerifiedAt?: string;
  recoveryClosedAt?: string;
  writtenOff?: boolean;
}

export function loanStatus(l: LoanState): Label {
  if (l.status === 'open') return { text: 'Open', tone: 'ok' };
  if (l.status === 'repaid') return { text: 'Repaid', tone: 'neutral' };
  if (l.status !== 'defaulted') return pick({}, l.status);
  if (!l.claimPaid) return l.defaultVerifiedAt ? { text: 'Claim waiting', tone: 'bad' } : { text: 'Default, not verified', tone: 'bad' };
  if (l.writtenOff) return { text: 'Written off', tone: 'neutral' };
  return l.recoveryClosedAt ? { text: 'Recovered', tone: 'ok' } : { text: 'Claim paid, recovering', tone: 'warn' };
}

// what each step waiting on a loan, or done on it, is called
const STEP: Record<string, string> = {
  repayment: 'Repaid in full',
  default: 'Default reported',
  reversal: 'Default reversed',
  payout: 'Claim paid',
  write_off: 'Written off'
};

export const stepName = (code: string | null | undefined) => (code ? STEP[code] ?? sentence(code) : '—');

const STEP_STATUS: Record<string, Label> = {
  pending: { text: 'Waiting for approval', tone: 'warn' },
  approved: { text: 'Approved', tone: 'ok' },
  rejected: { text: 'Rejected', tone: 'bad' }
};

export const stepStatus = (code: string | null | undefined) => pick(STEP_STATUS, code);

export const loanSource = (code: string | null | undefined) => (code === 'guaranteed' ? 'Guaranteed' : code === 'lipa_onchain' ? 'Lipa API' : sentence(code ?? '—'));

// extra liquidity: a movement counts toward Liquid Funds only once a second admin approves it (3.4.3)
export const movementStatus = stepStatus;

// an admin's account has a member's statuses
export const adminStatus = memberStatus;

export const movementType = (code: string | null | undefined) => (code === 'top_up' ? 'Into Liquid Funds' : code === 'withdrawal' ? 'Out of Liquid Funds' : sentence(code ?? '—'));

// a pool wallet is proposed, then current once approved, and retired when the next one is approved (BlockCoop #68)
const WALLET_STATUS: Record<string, Label> = {
  proposed: { text: 'Waiting for approval', tone: 'warn' },
  current: { text: 'Current', tone: 'ok' },
  retired: { text: 'Retired', tone: 'neutral' },
  rejected: { text: 'Rejected', tone: 'bad' }
};

export const walletStatus = (code: string | null | undefined) => pick(WALLET_STATUS, code);

// what last recalculated the Correction Factor
const FACTOR_TRIGGER: Record<string, string> = {
  scheduled: 'Scheduled recalculation',
  change: 'A pool total moved',
  parameter: 'A pool setting changed',
  valuation: 'Prices changed'
};

export const factorTrigger = (code: string | null | undefined) => (code ? FACTOR_TRIGGER[code] ?? sentence(code) : '—');

// a pool setting's change: one that applies at once is applied as it's made; any other waits for a second admin
const CHANGE_STATUS: Record<string, Label> = {
  ...STEP_STATUS,
  applied: { text: 'Applied at once', tone: 'ok' }
};

export const changeStatus = (code: string | null | undefined) => pick(CHANGE_STATUS, code);

// Pool alerts (#67): how serious each is, and whether it's open, acknowledged by an admin with a note, or cleared.
const ALERT_LEVEL: Record<string, Label> = {
  CRITICAL: { text: 'Critical', tone: 'bad' },
  WARNING: { text: 'Warning', tone: 'warn' },
  INFO: { text: 'Info', tone: 'neutral' }
};

export const alertLevel = (code: string | null | undefined) => pick(ALERT_LEVEL, code);

export const ALERT_LEVELS = ['CRITICAL', 'WARNING', 'INFO'] as const;

const ALERT_STATUS: Record<string, Label> = {
  OPEN: { text: 'Open', tone: 'bad' },
  ACKNOWLEDGED: { text: 'Acknowledged', tone: 'warn' },
  RESOLVED: { text: 'Resolved', tone: 'ok' }
};

export const alertStatus = (code: string | null | undefined) => pick(ALERT_STATUS, code);

// what raised each alert; the last three are from before the Lipa API (D-039) and only show on old alerts
const ALERT_TYPE: Record<string, string> = {
  LIPA_PAYMENT_REFUSED: 'Lipa payment refused',
  DIRECT_PAYMENT_UNSETTLED: 'Direct payment not settled',
  KES_RATE_STALE: 'KES rate out of date',
  BLOCKS_PRICE_STALE: 'BLOCKS price out of date',
  VALUATION_FAILED: 'Revaluing backing failed',
  BOOK_RATIO_BELOW_TARGET: 'Book ratio below target',
  POOL_WALLET_CHANGED: 'Pool wallet changed',
  RETIRED_WALLET_PAYMENT: 'Payment to a retired wallet',
  REFUND_VOLUME: 'Many refunds',
  REFUND_HELD_TOO_LONG: 'Refunds owed too long',
  ONCHAIN_READER_FAILING: 'On-chain reader failing',
  MOBILE_MONEY_PAUSED: 'Mobile money paused',
  PAYBILL_MISMATCH: 'Paybill mismatch',
  MPESA_REFUND_FAILED: 'M-Pesa refund failed'
};

export const ALERT_TYPES = Object.keys(ALERT_TYPE);

// what an activity record says happened; the last six are read on-chain, never imported (BlockCoop D-017, D-019)
const FACT_TYPE: Record<string, string> = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  LOAN_DISBURSED: 'Loan paid out',
  LOAN_REPAYMENT: 'Loan repayment',
  BLOCKS_STAKED: 'BLOCKS staked',
  BLOCKS_UNSTAKED: 'BLOCKS unstaked',
  BLOCKS_LOCKED: 'BLOCKS locked',
  BLOCKS_UNLOCKED: 'BLOCKS unlocked',
  LIPA_PAYMENT: 'Lipa payment in BLOCKS',
  LIPA_TOKEN_PAYMENT: 'Lipa payment in USDT',
  LIPA_BUY: 'BLOCKS bought through Lipa',
  LIPA_LOCK: 'Lipa savings lock'
};

export const FACT_TYPES = Object.keys(FACT_TYPE);

/** The types a CSV file may hold. */
export const IMPORTABLE_FACT_TYPES = FACT_TYPES.slice(0, 6);

export const factType = (code: string | null | undefined) => (code ? FACT_TYPE[code] ?? sentence(code) : '—');

const FACT_VIA: Record<string, string> = { API: 'Service key', CSV: 'CSV import', SEED: 'Seed data', ONCHAIN: 'On-chain' };

/** How an activity record reached the GP API. */
export const factVia = (code: string | null | undefined) => (code ? FACT_VIA[code] ?? sentence(code) : '—');

export const alertType = (code: string | null | undefined) => (code ? ALERT_TYPE[code] ?? sentence(code) : '—');

// the figures an alert carries, by their key in its details
const ALERT_DETAIL: Record<string, string> = {
  quoteId: 'Quote',
  guaranteeId: 'Guarantee',
  paymentId: 'Payment ID',
  txHash: 'Transaction',
  reason: 'Why it was refused',
  amountAsked: 'Amount asked',
  paymentReference: 'Payment reference',
  rateSource: 'Rate from',
  rateUpdatedAt: 'Rate last updated',
  maxAgeHours: 'Oldest allowed, hours',
  usdtPerBlocks: 'Last BLOCKS price, USDT',
  blocksReadAt: 'BLOCKS price read',
  error: 'Error',
  lockMisses: 'Locks not read',
  bookRatio: 'Book ratio',
  target: 'Target',
  totalPremiumUsdt: 'Premiums, USDT',
  totalExpectedLossUsdt: 'Expected loss, USDT',
  checkedAt: 'Checked',
  previous: 'Previous wallet',
  previousWatchedUntil: 'Previous wallet watched until',
  proposedBy: 'Proposed by',
  approvedBy: 'Approved by',
  threshold: 'Threshold',
  wallet: 'Wallet',
  reference: 'Reference',
  arrivedAt: 'Arrived',
  watchedUntil: 'Watched until',
  refunds: 'Refunds',
  windowHours: 'Within, hours',
  heldHours: 'Owed for more than, hours',
  oldestRefundId: 'Oldest refund',
  oldestSince: 'Oldest owed since',
  reader: 'Reader',
  failedMembers: 'Members failed last run',
  runsInARow: 'Runs failed in a row'
};

/** A detail's name: `amountAsked` → "Amount asked", for one the table doesn't know too. */
export const alertDetail = (key: string) => ALERT_DETAIL[key] ?? sentence(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2'));

const KEY_STATUS: Record<string, Label> = {
  active: { text: 'In use', tone: 'ok' },
  rotated: { text: 'Rotated', tone: 'neutral' },
  revoked: { text: 'Revoked', tone: 'bad' }
};

/** A service key: in use, or revoked by hand or by rotating it. */
export const keyStatus = (code: string | null | undefined) => pick(KEY_STATUS, code);

const SCOPE: Record<string, string> = { 'facts:write': 'Send activity records', 'facts:read': 'Read activity records' };

export const scopeLabel = (code: string | null | undefined) => (code ? SCOPE[code] ?? code : '—');

// what waits in the approvals inbox (BlockCoop's approvals inbox, #142 B3)
const APPROVAL_KIND: Record<string, string> = {
  guarantee_close: 'Guarantee close',
  loan_step: 'Loan report or claim step',
  default_verification: 'Default to verify',
  loan_recovery: 'Recovery',
  refund_payout: 'Refund payout',
  liquidity_adjustment: 'Extra liquidity',
  pool_wallet: 'New pool wallet',
  parameter_change: 'Setting change',
  parameter_change_set: 'Setting changes, together',
  backing_change: 'Backing change'
};

export const APPROVAL_KINDS = Object.keys(APPROVAL_KIND);
export const approvalKind = (code: string | null | undefined) => (code ? APPROVAL_KIND[code] ?? sentence(code) : '—');
