import { sentence } from './labels';

// The audit log's codes as admins read them. The action filter is an exact match, so it offers the actions
// the backend writes, by area; a code this list doesn't know still shows, as a sentence.

export const ACTION_GROUPS: { label: string; actions: string[] }[] = [
  { label: 'Sign-in and passwords', actions: ['LOGIN', 'PASSWORD_SET', 'PASSWORD_RESET'] },
  { label: 'Admins and roles', actions: ['ADMIN_CREATED', 'ADMIN_UPDATED', 'ADMIN_ROLE_CHANGED', 'ADMIN_DISABLED', 'ADMIN_ENABLED', 'ADMIN_DELETED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED'] },
  { label: 'Service keys', actions: ['SERVICE_KEY_CREATED', 'SERVICE_KEY_ROTATED', 'SERVICE_KEY_REVOKED', 'SERVICE_KEY_USED'] },
  { label: 'Members', actions: ['MEMBER_REGISTERED', 'MEMBER_DISABLED', 'MEMBER_ENABLED', 'INVITE_CREATED', 'INVITE_REVOKED', 'WALLET_REPLACED', 'MEMBER_ASSET_BALANCES_ENTERED', 'MEMBER_ASSET_BALANCES_SET', 'MEMBER_ASSET_BALANCES_REJECTED', 'LOCKED_BLOCKS_REFRESHED'] },
  { label: 'Connections', actions: ['RELATIONSHIP_REQUESTED', 'RELATIONSHIP_CREATED', 'RELATIONSHIP_REMOVED'] },
  { label: 'KYC and address', actions: ['KYC_SUBMITTED', 'MEMBER_KYC_UPDATED', 'KYC_DETAILS_VIEWED', 'ADDRESS_PIN_SAVED', 'ADDRESS_DOCUMENT_SUBMITTED', 'ADDRESS_DOCUMENT_REVIEWED', 'ADDRESS_PROOF_VIEWED', 'PRIVATE_FILE_OPENED', 'UPLOAD_CREATED', 'UPLOAD_DELETED'] },
  { label: 'KYC encryption key', actions: ['KYC_REENCRYPTED', 'KYC_KEY_LOSS_RESET', 'KYC_KEY_LOSS_RESET_RUN'] },
  // a loan action is LOAN_{its type}_{ENTERED, APPROVED or REJECTED} (LoanRecordService)
  { label: 'Guarantees and loans', actions: ['GUARANTEE_CLOSE_ENTERED', 'GUARANTEE_CLOSED', 'GUARANTEE_CLOSE_REJECTED', 'LOAN_RECORDED', 'LOAN_DOCUMENT_ADDED', 'LOAN_REPAYMENT_ENTERED', 'LOAN_REPAYMENT_APPROVED', 'LOAN_REPAYMENT_REJECTED', 'LOAN_DEFAULT_ENTERED', 'LOAN_DEFAULT_APPROVED', 'LOAN_DEFAULT_REJECTED', 'LOAN_REVERSAL_ENTERED', 'LOAN_REVERSAL_APPROVED', 'LOAN_REVERSAL_REJECTED', 'LOAN_PAYOUT_ENTERED', 'LOAN_PAYOUT_APPROVED', 'LOAN_PAYOUT_REJECTED', 'LOAN_WRITE_OFF_ENTERED', 'LOAN_WRITE_OFF_APPROVED', 'LOAN_WRITE_OFF_REJECTED', 'LOAN_DEFAULT_VERIFIED', 'LOAN_RECOVERY_ENTERED', 'LOAN_RECOVERY_APPROVED', 'LOAN_RECOVERY_REJECTED', 'LOAN_RECOVERY_CLOSED'] },
  { label: 'Money', actions: ['REFUND_PAYOUT_ENTERED', 'REFUND_PAID', 'REFUND_PAYOUT_REJECTED', 'LIQUIDITY_ADJUSTMENT_ENTERED', 'LIQUIDITY_ADJUSTMENT_APPROVED', 'LIQUIDITY_ADJUSTMENT_REJECTED'] },
  { label: 'Pool', actions: ['POOL_WALLET_PROPOSED', 'POOL_WALLET_APPROVED', 'POOL_WALLET_REJECTED', 'PARAMETER_CHANGED', 'PARAMETER_CHANGE_PROPOSED', 'PARAMETER_CHANGE_APPROVED', 'PARAMETER_CHANGE_REJECTED', 'PARAMETER_CHANGE_SET_PROPOSED', 'PARAMETER_CHANGE_SET_APPROVED', 'PARAMETER_CHANGE_SET_REJECTED', 'ALERT_ACKNOWLEDGED'] },
  { label: 'Activity', actions: ['LEDGER_FACTS_IMPORTED'] }
];

const ACTION: Record<string, string> = {
  LOGIN: 'Signed in',
  KYC_REENCRYPTED: 'KYC details re-encrypted',
  KYC_KEY_LOSS_RESET: 'KYC details reset after key loss',
  KYC_KEY_LOSS_RESET_RUN: 'Key-loss reset run',
  MEMBER_KYC_UPDATED: 'KYC reviewed',
  LEDGER_FACTS_IMPORTED: 'Activity records imported',
  PRIVATE_FILE_OPENED: 'Private file opened',
  RELATIONSHIP_REQUESTED: 'Connection requested',
  RELATIONSHIP_CREATED: 'Connection made',
  RELATIONSHIP_REMOVED: 'Connection removed',
  PARAMETER_CHANGED: 'Pool setting changed',
  PARAMETER_CHANGE_PROPOSED: 'Pool setting change proposed',
  PARAMETER_CHANGE_APPROVED: 'Pool setting change approved',
  PARAMETER_CHANGE_REJECTED: 'Pool setting change rejected',
  PARAMETER_CHANGE_SET_PROPOSED: 'Pool setting change set proposed',
  PARAMETER_CHANGE_SET_APPROVED: 'Pool setting change set approved',
  PARAMETER_CHANGE_SET_REJECTED: 'Pool setting change set rejected',
  MEMBER_ASSET_BALANCES_ENTERED: 'Backing entered',
  MEMBER_ASSET_BALANCES_SET: 'Backing approved',
  MEMBER_ASSET_BALANCES_REJECTED: 'Backing rejected',
  LOCKED_BLOCKS_REFRESHED: 'Locked BLOCKS read again',
  LIQUIDITY_ADJUSTMENT_ENTERED: 'Extra liquidity movement entered',
  LIQUIDITY_ADJUSTMENT_APPROVED: 'Extra liquidity movement approved',
  LIQUIDITY_ADJUSTMENT_REJECTED: 'Extra liquidity movement rejected'
};

export const auditAction = (code: string | null | undefined) => (code ? ACTION[code] ?? sentence(code) : '—');

export const KNOWN_ACTIONS = ACTION_GROUPS.flatMap((g) => g.actions);

/** The kinds of record an entry is about, in the order the record filter offers them. */
const RECORD: Record<string, string> = {
  member: 'Member',
  admin: 'Admin',
  account: 'Account',
  role: 'Role',
  service_key: 'Service key',
  member_invite: 'Invitation',
  relationship: 'Connection',
  upload: 'File',
  address_document: 'Address document',
  kyc_key: 'KYC encryption key',
  guarantee: 'Guarantee',
  loan_record: 'Loan',
  loan_recovery: 'Recovery',
  payment_refund: 'Refund',
  liquidity_adjustment: 'Extra liquidity movement',
  pool_wallet: 'Pool wallet',
  pool_parameter: 'Pool setting',
  parameter_change: 'Pool setting change',
  parameter_change_set: 'Pool setting change set',
  ledger_import: 'Activity import'
};

export const RECORD_TYPES = Object.keys(RECORD);

export const recordType = (code: string | null | undefined) => (code ? RECORD[code] ?? sentence(code) : '—');

/** The portal page a record opens on, where it has one. */
export function recordPath(type: string | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  const e = encodeURIComponent(id);
  switch (type) {
    case 'member':
      return `/members/${e}`;
    case 'role':
      return `/admins/roles/${e}`;
    case 'guarantee':
      return `/guarantees/${e}`;
    case 'loan_record':
      return `/loans/${e}`;
    case 'payment_refund':
      return `/refunds/${e}`;
    case 'pool_wallet':
      return `/pool/wallets/${e}`;
    default:
      return null;
  }
}

const ACTOR: Record<string, string> = { ADMIN: 'Admin', MEMBER: 'Member', SERVICE: 'Service key', SYSTEM: 'The GP API' };

/** Who did it: the admin's or member's name or email, the key's name, or the GP API itself. */
export function actorName(type: string | null | undefined, label: string | null | undefined): string {
  if (type === 'SYSTEM') return ACTOR.SYSTEM!;
  return label || (type ? ACTOR[type] ?? sentence(type) : '—');
}

export const actorKind = (type: string | null | undefined) => (type ? ACTOR[type] ?? sentence(type) : '');
