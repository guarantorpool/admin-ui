import * as React from 'react';
import { attachDocument, enterDefault, enterPayout, enterRecovery, enterRepayment, recordLoan, type LoanDetail, type PaidIn, type Recovery } from '@/api/loans';
import { NOTE_HINT } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog, selectClass as select, textareaClass as textarea, useForm, type Rows } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { dayInZone, formatAmount, startOfDay } from '@/lib/format';

// the backend's limits on a reference, a lender's name and a note
const TEXT_MAX = 200;
const NOTE_MAX = 500;

/** A positive amount as typed, or null. */
const positive = (v: string) => (v.trim() && Number(v) > 0 ? Number(v) : null);

function NoteField({ id, value, onChange, hint }: { id: string; value: string; onChange: React.ChangeEventHandler<HTMLTextAreaElement>; hint: string }) {
  return (
    <Field id={id} label="Note (optional)" hint={`${NOTE_HINT} ${hint}`}>
      <textarea id={id} value={value} maxLength={NOTE_MAX} rows={2} onChange={onChange} aria-describedby={`${id}-hint`} className={textarea} />
    </Field>
  );
}

function DayField({ id, label, value, onChange, max, hint = 'In Nairobi time.' }: { id: string; label: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement>; max?: string; hint?: string }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} type="date" value={value} max={max} onChange={onChange} aria-describedby={`${id}-hint`} />
    </Field>
  );
}

export function RecordLoanDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (d: LoanDetail) => void }) {
  const [f, set] = useForm(open, { guaranteeId: '', lender: '', reference: '', amount: '', opened: '', due: '' });
  return (
    <FormDialog
      open={open}
      title="Record the loan a guarantee backs"
      description="For a loan the lender's system hasn't sent itself: enter it from the lender's report. One loan per active guarantee, in USDT."
      confirm="Record the loan"
      onClose={onClose}
      check={() => {
        if (!f.guaranteeId.trim() || !f.lender.trim() || !f.reference.trim() || !f.opened || !f.due) return 'Fill in every field.';
        if (!positive(f.amount)) return 'Enter the amount lent, more than 0.';
        if (f.due <= f.opened) return 'The final due date must be after the day it was lent.';
        return '';
      }}
      send={() =>
        recordLoan({ guaranteeId: f.guaranteeId.trim().toUpperCase(), lender: f.lender.trim(), reference: f.reference.trim(), amount: positive(f.amount)!, openedAt: startOfDay(f.opened), dueAt: startOfDay(f.due) })
      }
      saved={onSaved}
      done="Loan recorded."
    >
      <Field id="loan-guarantee" label="Active guarantee ID" hint="GPG-…">
        <Input id="loan-guarantee" value={f.guaranteeId} onChange={set('guaranteeId')} aria-describedby="loan-guarantee-hint" className="font-mono" />
      </Field>
      <Field id="loan-lender" label="Lender">
        <Input id="loan-lender" value={f.lender} maxLength={TEXT_MAX} onChange={set('lender')} />
      </Field>
      <Field id="loan-reference" label="Lender's loan reference">
        <Input id="loan-reference" value={f.reference} maxLength={TEXT_MAX} onChange={set('reference')} className="font-mono" />
      </Field>
      <Field id="loan-amount" label="Amount lent, in USDT">
        <Input id="loan-amount" inputMode="decimal" value={f.amount} onChange={set('amount')} />
      </Field>
      <DayField id="loan-opened" label="Lent on" value={f.opened} onChange={set('opened')} />
      <DayField id="loan-due" label="Final due date" value={f.due} onChange={set('due')} />
    </FormDialog>
  );
}

export function RepaymentDialog({ open, loanId, rows, onClose, onSaved }: { open: boolean; loanId: string; rows: Rows; onClose: () => void; onSaved: (d: LoanDetail) => void }) {
  const [f, set] = useForm(open, { day: '', note: '' });
  const today = dayInZone();
  return (
    <FormDialog
      open={open}
      title="Enter a repayment in full"
      description="The lender reports the loan repaid, early included. Once a second admin approves it, the loan is repaid and its guarantee closes."
      rows={rows}
      confirm="Enter the repayment"
      onClose={onClose}
      check={() => (!f.day ? 'Enter the date it was repaid.' : f.day > today ? "The date repaid can't be in the future." : '')}
      send={() => enterRepayment(loanId, { repaidAt: startOfDay(f.day), ...(f.note.trim() ? { note: f.note.trim() } : {}) })}
      saved={onSaved}
      done="Repayment entered. A second admin approves it."
    >
      <DayField id="repaid-on" label="Repaid on" value={f.day} max={today} onChange={set('day')} />
      <NoteField id="repaid-note" value={f.note} onChange={set('note')} hint="Kept with the loan and in the audit log." />
    </FormDialog>
  );
}

export function DefaultDialog({ open, loanId, rows, onClose, onSaved }: { open: boolean; loanId: string; rows: Rows; onClose: () => void; onSaved: (d: LoanDetail) => void }) {
  const [f, set] = useForm(open, { owed: '', note: '' });
  return (
    <FormDialog
      open={open}
      title="Enter a default"
      description="The lender reports the loan defaulted. A second admin approves it, and a different admin from you then verifies it against its documents."
      rows={rows}
      confirm="Enter the default"
      onClose={onClose}
      check={() => (positive(f.owed) ? '' : 'Enter the USDT still owed, more than 0.')}
      send={() => enterDefault(loanId, { claimOwed: positive(f.owed)!, ...(f.note.trim() ? { note: f.note.trim() } : {}) })}
      saved={onSaved}
      done="Default entered. A second admin approves it."
    >
      <Field id="default-owed" label="Still owed, in USDT" hint="As the lender's documents give it. The claim is this, up to the guarantee amount.">
        <Input id="default-owed" inputMode="decimal" value={f.owed} onChange={set('owed')} aria-describedby="default-owed-hint" />
      </Field>
      <NoteField id="default-note" value={f.note} onChange={set('note')} hint="Kept with the loan and in the audit log." />
    </FormDialog>
  );
}

export function AttachDialog({ open, loanId, rows, onClose, onSaved }: { open: boolean; loanId: string; rows: Rows; onClose: () => void; onSaved: (d: LoanDetail) => void }) {
  const [label, setLabel] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  React.useEffect(() => {
    setLabel('');
    setFile(null);
  }, [open]);
  return (
    <FormDialog
      open={open}
      title="Attach a lender's document"
      description="A PDF or an image from the lender. It's kept private and can't be deleted."
      rows={rows}
      confirm="Attach"
      onClose={onClose}
      check={() => (file ? '' : 'Choose the file.')}
      send={() => attachDocument(loanId, file!, label.trim() || undefined)}
      saved={onSaved}
      done="Document attached."
    >
      <Field id="doc-file" label="Document">
        <Input id="doc-file" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field id="doc-label" label="What it is (optional)" hint="For example, the lender's default notice.">
        <Input id="doc-label" value={label} maxLength={TEXT_MAX} onChange={(e) => setLabel(e.target.value)} aria-describedby="doc-label-hint" />
      </Field>
    </FormDialog>
  );
}

/** The asset paid in, the amount in it and, for KES or BLOCKS, the rate used, with what it comes to in USDT. */
function PaidInFields({ id, f, set }: { id: string; f: { asset: string; amount: string; rate: string }; set: (k: 'asset' | 'amount' | 'rate') => React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> }) {
  const amount = positive(f.amount);
  const rate = positive(f.rate);
  const usdt = !amount ? null : f.asset === 'USDT' ? amount : !rate ? null : f.asset === 'KES' ? amount / rate : amount * rate;
  return (
    <>
      <Field id={`${id}-asset`} label="Paid in">
        <select id={`${id}-asset`} value={f.asset} onChange={set('asset')} className={select}>
          <option value="USDT">USDT</option>
          <option value="KES">KES</option>
          <option value="BLOCKS">BLOCKS</option>
        </select>
      </Field>
      <Field id={`${id}-amount`} label={`Amount, in ${f.asset}`}>
        <Input id={`${id}-amount`} inputMode="decimal" value={f.amount} onChange={set('amount')} />
      </Field>
      {f.asset !== 'USDT' ? (
        <Field id={`${id}-rate`} label={f.asset === 'KES' ? 'KES per USD that day' : 'USDT per BLOCKS that day'} hint={usdt ? `Comes to ${Math.round(usdt * 100) === usdt * 100 ? '' : 'about '}${formatAmount(usdt, 'USDT')}.` : 'The rate used.'}>
          <Input id={`${id}-rate`} inputMode="decimal" value={f.rate} onChange={set('rate')} aria-describedby={`${id}-rate-hint`} />
        </Field>
      ) : null}
    </>
  );
}

const paidIn = (f: { asset: string; amount: string; rate: string }) => {
  const rate = positive(f.rate) ?? undefined;
  return { amount: positive(f.amount)!, currency: f.asset as PaidIn, ...(f.asset === 'KES' ? { kesPerUsd: rate } : f.asset === 'BLOCKS' ? { usdtPerBlocks: rate } : {}) };
};

const checkPaidIn = (f: { asset: string; amount: string; rate: string }) =>
  !positive(f.amount) ? 'Enter the amount, more than 0.' : f.asset !== 'USDT' && !positive(f.rate) ? `Enter the rate used for ${f.asset}.` : '';

export function ClaimPayoutDialog({ open, loanId, rows, onClose, onSaved }: { open: boolean; loanId: string; rows: Rows; onClose: () => void; onSaved: (d: LoanDetail) => void }) {
  const [f, set] = useForm(open, { asset: 'USDT', amount: '', rate: '', reference: '', day: '', note: '' });
  const today = dayInZone();
  return (
    <FormDialog
      open={open}
      title="Enter this claim's payout"
      description="Enter a payout made outside the system. A second admin must approve it. It's refused when Liquid Funds don't cover the claim."
      rows={rows}
      confirm="Enter the payout"
      onClose={onClose}
      check={() => checkPaidIn(f) || (!f.reference.trim() || !f.day ? 'Enter the reference and the date.' : f.day > today ? "The date paid can't be in the future." : '')}
      send={() => enterPayout(loanId, { ...paidIn(f), reference: f.reference.trim(), paidAt: startOfDay(f.day), ...(f.note.trim() ? { note: f.note.trim() } : {}) })}
      saved={onSaved}
      done="Payout entered. A second admin approves it."
    >
      <PaidInFields id="claim-payout" f={f} set={set} />
      <Field id="claim-payout-reference" label="Reference" hint="The transfer's transaction hash, or the reference it was sent with.">
        <Input id="claim-payout-reference" value={f.reference} maxLength={TEXT_MAX} onChange={set('reference')} aria-describedby="claim-payout-reference-hint" className="font-mono" />
      </Field>
      <DayField id="claim-payout-date" label="Date paid" value={f.day} max={today} onChange={set('day')} />
      <NoteField id="claim-payout-note" value={f.note} onChange={set('note')} hint="Kept with the claim and in the audit log." />
    </FormDialog>
  );
}

export function RecoveryDialog({ open, loanId, rows, onClose, onSaved }: { open: boolean; loanId: string; rows: Rows; onClose: () => void; onSaved: (r: Recovery) => void }) {
  const [f, set] = useForm(open, { asset: 'USDT', amount: '', rate: '', note: '' });
  return (
    <FormDialog
      open={open}
      title="Enter an amount recovered"
      description="Money recovered after the claim was paid, from the borrower or returned by the lender. A second admin must approve it before it adds to Liquid Funds."
      rows={rows}
      confirm="Enter the recovery"
      onClose={onClose}
      check={() => checkPaidIn(f)}
      send={() => enterRecovery(loanId, { ...paidIn(f), ...(f.note.trim() ? { note: f.note.trim() } : {}) })}
      saved={onSaved}
      done="Recovery entered. A second admin approves it."
    >
      <PaidInFields id="recovery" f={f} set={set} />
      <NoteField id="recovery-note" value={f.note} onChange={set('note')} hint="Kept with the recovery and in the audit log." />
    </FormDialog>
  );
}
