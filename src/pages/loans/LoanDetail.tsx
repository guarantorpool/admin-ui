import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '@/api/errors';
import { decideRecovery, decideStep, enterReversal, enterWriteOff, getClaimLiquidity, getLoan, listClaims, loanName, verifyDefault, type Claim, type Loan, type LoanAction, type LoanDetail as Detail, type Recovery } from '@/api/loans';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Fields, Item, Items, Muted, StatusPill } from '@/components/ui/parts';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatDate, formatDateTime, formatIn, formatNumber, formatUsdt } from '@/lib/format';
import { loanRecordedVia, loanStatus, stepName, stepStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useOpenFile } from '@/lib/useOpenFile';
import { useMemberName } from '@/pages/members/useMemberName';
import { useGrants, useSession } from '@/session/SessionProvider';
import { AttachDialog, ClaimPayoutDialog, DefaultDialog, RecoveryDialog, RepaymentDialog } from './LoanForms';

export const LOAN_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'reports', label: 'Lender reports' },
  { value: 'steps', label: 'Claim steps' },
  { value: 'documents', label: 'Documents' },
  { value: 'recoveries', label: 'Recoveries' }
] as const;

const link = 'font-medium text-ink-strong underline underline-offset-4';
const mono = (v: string | undefined) => <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{v ?? '—'}</span>;
const at = (who: string | undefined, when: string | undefined) => `${who ?? '—'}, ${formatDateTime(when, { zone: true })}`;
const sameAdmin = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// reports come from the lender; claim steps are what admins do about a default
const REPORTS = new Set(['repayment', 'default']);

/** How a payout or recovery was paid: "120,000 KES at 129.5 KES per USD". */
function paidIn(amount: string | undefined, currency: string | undefined, kesPerUsd?: string, usdtPerBlocks?: string) {
  const rate = currency === 'KES' && kesPerUsd ? ` at ${formatNumber(kesPerUsd)} KES per USD` : currency === 'BLOCKS' && usdtPerBlocks ? ` at ${formatNumber(usdtPerBlocks)} USDT per BLOCKS` : '';
  return `${formatIn(amount, currency, { full: true })}${rate}`;
}

/** One loan, with its lender reports, claim steps, documents and recoveries. */
export function LoanDetail({ loanId, tab, onTab }: { loanId: string; tab: string; onTab: (t: string) => void }) {
  const query = useQuery({ queryKey: ['loans', loanId], queryFn: () => getLoan(loanId) });
  const loan = query.data?.loan;
  const member = useMemberName(loan?.memberId);
  // the claim's figures (capped at the guarantee amount, and when it can be paid) are only on the claims list
  const waiting = loan?.status === 'defaulted' && !loan.claimPaid;
  const claims = useQuery({ queryKey: ['claims', 'list'], queryFn: listClaims, enabled: waiting });
  const claim = waiting ? claims.data?.find((c) => c.loanId === loanId) : undefined;

  if (query.isPending) return <Muted>Loading the loan…</Muted>;
  if (query.isError) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return <Banner tone="bad">{gone ? "There's no such loan." : errorMessage(query.error)}</Banner>;
  }
  const detail = query.data;
  const l = detail.loan!;
  const guaranteed = l.source === 'guaranteed';
  const tabs = guaranteed ? LOAN_TABS : LOAN_TABS.slice(0, 1);
  const current = tabs.some((t) => t.value === tab) ? tab : 'overview';
  const actions = detail.actions ?? [];

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold">Loan on {loanName(l)}</h2>
          <StatusPill label={loanStatus(l)} />
          {l.pendingAction ? <Badge tone="warn">{stepName(l.pendingAction)}: waiting</Badge> : null}
        </div>
        {guaranteed ? <Tabs label="Loan" idPrefix="loan" tabs={tabs} value={current} onChange={onTab} /> : null}
        <TabPanel key={current} idPrefix="loan" value={current} className="flex flex-col gap-3.5">
          {current === 'reports' ? (
            <Steps loan={l} actions={actions.filter((a) => REPORTS.has(a.type ?? ''))} recorded />
          ) : current === 'steps' ? (
            <Steps loan={l} actions={actions.filter((a) => !REPORTS.has(a.type ?? ''))} />
          ) : current === 'documents' ? (
            <Documents detail={detail} />
          ) : current === 'recoveries' ? (
            <Recoveries loan={l} recoveries={detail.recoveries ?? []} memberName={member.text} />
          ) : (
            <Fields
              rows={[
                { k: 'Member', v: member.link ? <Link to={member.link} className={link}>{member.text}</Link> : member.text },
                { k: 'Source', v: guaranteed ? 'Guaranteed by the pool' : 'From the Lipa API, for the Trust Score only' },
                ...(l.guaranteeId ? [{ k: 'Guarantee', v: <GuaranteeLink id={l.guaranteeId} /> }] : []),
                { k: 'Lender', v: l.lender ?? '—' },
                ...(guaranteed ? [{ k: 'Recorded', v: loanRecordedVia(l.recordedVia) }] : []),
                { k: guaranteed ? "Lender's reference" : 'Lipa reference', v: mono(l.externalId) },
                { k: 'Amount lent', v: formatIn(l.amount, l.currency, { full: true }) },
                { k: 'Lent on', v: formatDate(l.openedAt) },
                { k: 'Final due date', v: formatDate(l.dueAt) },
                ...(l.closedAt ? [{ k: l.status === 'repaid' ? 'Repaid' : 'Closed', v: formatDate(l.closedAt) }] : []),
                ...(l.defaultedAt
                  ? [
                      { k: 'Default approved', v: formatDateTime(l.defaultedAt, { zone: true }) },
                      { k: 'Still owed when it defaulted', v: formatUsdt(l.claimOwed, { full: true }) },
                      ...(l.defaultNote ? [{ k: 'Default note', v: l.defaultNote }] : []),
                      { k: 'Verified against its documents', v: l.defaultVerifiedAt ? at(l.defaultVerifiedBy, l.defaultVerifiedAt) : 'Not yet' }
                    ]
                  : []),
                ...(claim
                  ? [
                      { k: 'Claim', v: `${formatUsdt(claim.claim, { full: true })}, up to the guarantee amount of ${formatUsdt(claim.guaranteeAmount, { full: true })}` },
                      { k: 'Can be paid from', v: formatDateTime(claim.payableFrom, { zone: true }) }
                    ]
                  : []),
                ...(l.claimPaid
                  ? [
                      { k: 'Claim paid', v: `${formatUsdt(l.claimPaid, { full: true })}, ${formatDate(l.claimPaidAt)}` },
                      { k: 'Paid in', v: paidIn(l.payoutAmount, l.payoutCurrency, l.payoutKesPerUsd, l.payoutUsdtPerBlocks) },
                      { k: 'Payout reference', v: mono(l.claimReference) },
                      { k: 'Recovered', v: formatUsdt(l.recovered ?? '0', { full: true }) },
                      ...(l.recoveryClosedAt ? [{ k: l.writtenOff ? 'Rest written off' : 'Recovered in full', v: formatDate(l.recoveryClosedAt) }] : [])
                    ]
                  : [])
              ]}
            />
          )}
        </TabPanel>
      </section>
      {guaranteed ? <LoanActions detail={detail} claim={claim} memberName={member.text} /> : <Muted>Lipa loans only feed the Trust Score. They have no lender reports or claims.</Muted>}
    </>
  );
}

function GuaranteeLink({ id }: { id: string }) {
  return can(useGrants(), 'GUARANTEES.READ') ? (
    <Link to={`/guarantees/${id}`} className={link}>
      {id}
    </Link>
  ) : (
    <>{id}</>
  );
}

/** The lender's reports (with the loan being recorded), or the claim steps (with the default's verification). */
function Steps({ loan: l, actions, recorded }: { loan: Loan; actions: LoanAction[]; recorded?: boolean }) {
  const verified = !recorded && l.defaultVerifiedAt;
  if (!actions.length && !recorded && !verified) return <Muted>No claim steps. This loan has no default.</Muted>;
  return (
    <Items label={recorded ? 'Lender reports' : 'Claim steps'}>
      {recorded ? <Item title={l.recordedVia === 'lender_api' ? 'Loan sent by the lender' : 'Loan recorded'} sub={`${formatIn(l.amount, l.currency, { full: true })} from ${l.lender ?? '—'}, lent ${formatDate(l.openedAt)}, due ${formatDate(l.dueAt)}`} /> : null}
      {verified ? <Item title="Default verified against its documents" sub={at(l.defaultVerifiedBy, l.defaultVerifiedAt)} /> : null}
      {actions.map((a) => (
        <Item
          key={a.actionId}
          title={stepName(a.type)}
          sub={
            <>
              {a.type === 'default' && a.claimOwed ? `${formatUsdt(a.claimOwed, { full: true })} still owed. ` : null}
              {a.type === 'repayment' && a.repaidAt ? `Repaid ${formatDate(a.repaidAt)}. ` : null}
              {a.type === 'payout' && a.claimPaid ? `${formatUsdt(a.claimPaid, { full: true })}, paid in ${paidIn(a.payoutAmount, a.payoutCurrency, a.payoutKesPerUsd, a.payoutUsdtPerBlocks)}, ${formatDate(a.claimPaidAt)}. ` : null}
              {a.note ? `${a.note}. ` : null}
              Entered by {at(a.enteredBy, a.enteredAt)}
              {a.decidedBy ? `; ${a.status === 'rejected' ? 'rejected' : 'approved'} by ${at(a.decidedBy, a.decidedAt)}` : ''}
              {a.decisionNote ? `: ${a.decisionNote}` : ''}
            </>
          }
          status={<StatusPill label={stepStatus(a.status)} />}
        />
      ))}
    </Items>
  );
}

function Documents({ detail }: { detail: Detail }) {
  const { open, opening } = useOpenFile();
  const docs = detail.documents ?? [];
  if (!docs.length) return <Muted>No documents yet.</Muted>;
  return (
    <Items label="Documents">
      {docs.map((d) => (
        <Item
          key={d.id}
          title={d.label || 'Lender document'}
          sub={`Attached ${formatDateTime(d.createdAt, { zone: true })}`}
          actions={
            <Button variant="outline" size="sm" disabled={opening === d.id} onClick={() => void open(d.id!)}>
              {opening === d.id ? 'Opening…' : 'Open the file'}
            </Button>
          }
        />
      ))}
    </Items>
  );
}

function useSaved(loanId: string) {
  const qc = useQueryClient();
  return (updated?: Detail) => {
    if (updated) qc.setQueryData(['loans', loanId], updated);
    else void qc.invalidateQueries({ queryKey: ['loans', loanId] });
    void qc.invalidateQueries({ queryKey: ['loans', 'list'] });
    void qc.invalidateQueries({ queryKey: ['claims'] });
  };
}

function Recoveries({ loan: l, recoveries, memberName }: { loan: Loan; recoveries: Recovery[]; memberName: string }) {
  const canManage = can(useGrants(), 'GUARANTEES.MANAGE');
  const { session } = useSession();
  const saved = useSaved(l.loanId!);
  const [decision, setDecision] = React.useState<Decision | null>(null);

  const decide = (r: Recovery, approve: boolean) =>
    setDecision({
      title: approve ? 'Approve this recovery?' : 'Reject this recovery?',
      description: approve ? 'It adds to the recovered total and to Liquid Funds.' : "It's kept as rejected, and adds to nothing.",
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [
        { k: 'Loan on', v: loanName(l) },
        { k: 'Member', v: memberName },
        { k: 'Recovered', v: paidIn(r.amount, r.currency, r.kesPerUsd, r.usdtPerBlocks) },
        { k: 'In USDT', v: formatUsdt(r.amountUsdt, { full: true }) },
        { k: 'Entered by', v: at(r.enteredBy, r.createdAt) }
      ],
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Kept in the audit log.` },
      run: async (note) => {
        await decideRecovery(r.recoveryId!, approve ? 'approve' : 'reject', note || undefined);
        saved();
      },
      done: () => toast.success(approve ? `Recovery on ${loanName(l)} approved.` : `Recovery on ${loanName(l)} rejected.`)
    });

  if (!recoveries.length) return <Muted>{l.claimPaid ? 'Nothing recovered yet.' : 'Recoveries are entered once the claim is paid.'}</Muted>;
  return (
    <>
      <Items label="Recoveries">
        {recoveries.map((r) => {
          const mine = sameAdmin(r.enteredBy, session?.email);
          return (
            <Item
              key={r.recoveryId}
              title={`${formatUsdt(r.amountUsdt, { full: true })}${r.currency !== 'USDT' ? `, from ${paidIn(r.amount, r.currency, r.kesPerUsd, r.usdtPerBlocks)}` : ''}`}
              sub={`${r.note ? `${r.note}. ` : ''}Entered by ${mine ? 'you' : r.enteredBy}, ${formatDateTime(r.createdAt, { zone: true })}${r.approvedBy ? `; approved by ${at(r.approvedBy, r.approvedAt)}` : r.rejectedBy ? `; rejected by ${r.rejectedBy}` : ''}${r.decisionNote ? `: ${r.decisionNote}` : ''}`}
              status={<StatusPill label={stepStatus(r.status)} />}
              actions={
                r.status === 'pending' && canManage ? (
                  <>
                    <Button variant="danger" size="sm" disabled={mine} onClick={() => decide(r, false)}>
                      Reject
                    </Button>
                    <Button size="sm" disabled={mine} onClick={() => decide(r, true)}>
                      Approve
                    </Button>
                  </>
                ) : null
              }
            />
          );
        })}
      </Items>
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

type Form = 'repayment' | 'default' | 'attach' | 'payout' | 'recovery' | null;

/**
 * What can be done to the loan now: one admin enters a lender's report or a claim step and a different admin
 * approves or rejects it; marking a default verified is one step, by a different admin from who entered it.
 */
function LoanActions({ detail, claim, memberName }: { detail: Detail; claim?: Claim; memberName: string }) {
  const grants = useGrants();
  const { session } = useSession();
  const l = detail.loan!;
  const id = l.loanId!;
  const saved = useSaved(id);
  const [form, setForm] = React.useState<Form>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const canManage = can(grants, 'GUARANTEES.MANAGE');
  const name = loanName(l);
  const rows = [
    { k: 'Loan on', v: name },
    { k: 'Member', v: memberName },
    { k: 'Lender', v: l.lender ?? '—' }
  ];
  const mine = sameAdmin(l.pendingBy, session?.email);
  const docs = detail.documents?.length ?? 0;
  const paid = !!l.claimPaid;
  const recovering = paid && !l.recoveryClosedAt;
  const takesDocuments = l.status === 'open' || (l.status === 'defaulted' && !paid);
  // the approved default's entry, as only a different admin can verify it
  const defaultBy = detail.actions?.find((a) => a.type === 'default' && a.status === 'approved')?.enteredBy;
  const verifyBlocked = sameAdmin(defaultBy, session?.email);

  const liquidity = useQuery({ queryKey: ['claims', 'liquidity'], queryFn: getClaimLiquidity, enabled: form === 'payout' });
  const payoutRows = [
    ...rows,
    { k: 'Claim, in USDT', v: claim ? formatUsdt(claim.claim, { full: true }) : '…' },
    { k: 'Liquid Funds', v: liquidity.data ? formatUsdt(liquidity.data.liquidFunds) : '…' }
  ];

  const pending = detail.actions?.find((a) => a.status === 'pending');
  const decide = (approve: boolean) =>
    setDecision({
      title: approve ? `Approve: ${stepName(l.pendingAction)}?` : `Reject: ${stepName(l.pendingAction)}?`,
      description: approve ? APPROVED[l.pendingAction ?? ''] ?? 'It takes effect now.' : 'Nothing changes on the loan. It can be entered afresh.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [...rows, { k: 'Entered by', v: at(l.pendingBy, l.pendingAt) }, ...(pending?.note ? [{ k: 'Note', v: pending.note }] : [])],
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Kept in the audit log.` },
      run: async (note) => saved(await decideStep(id, approve ? 'approve' : 'reject', note || undefined)),
      done: () => toast.success(approve ? `${stepName(l.pendingAction)} on ${name} approved.` : `${stepName(l.pendingAction)} on ${name} rejected.`)
    });

  const reasoned = (title: string, description: string, confirm: string, send: (reason: string) => Promise<Detail>, done: string) =>
    setDecision({
      title,
      description,
      confirm,
      rows,
      note: { label: 'Reason', hint: `${NOTE_HINT} Kept with the loan and in the audit log.`, required: 'Write the reason.' },
      run: async (reason) => saved(await send(reason)),
      done: () => toast.success(done)
    });

  const verify = () =>
    setDecision({
      title: 'Mark this default verified?',
      description: 'You confirm it matches its documents. Its claim can then be paid once the waiting period ends.',
      confirm: 'Mark verified',
      rows: [...rows, { k: 'Documents', v: `${docs} attached` }, { k: 'Default entered by', v: defaultBy ?? '—' }],
      run: async () => saved(await verifyDefault(id)),
      done: () => toast.success(`Default on ${name} verified.`)
    });

  const buttons: React.ReactNode[] = [];
  if (canManage && !l.pendingAction) {
    if (l.status === 'open') {
      buttons.push(
        <Button key="repayment" variant="outline" onClick={() => setForm('repayment')}>
          Enter a repayment in full
        </Button>,
        <Button key="default" variant="outline" disabled={!docs} onClick={() => setForm('default')}>
          Enter a default
        </Button>
      );
    }
    if (l.status === 'defaulted' && !paid) {
      if (!l.defaultVerifiedAt)
        buttons.push(
          <Button key="verify" disabled={verifyBlocked} onClick={verify}>
            Mark verified
          </Button>
        );
      else
        buttons.push(
          <Button key="payout" onClick={() => setForm('payout')}>
            Enter the payout
          </Button>
        );
      buttons.push(
        <Button
          key="reversal"
          variant="outline"
          onClick={() => reasoned('Enter a reversal of this default?', 'For a default entered wrongly. Once a second admin approves it, the loan is open again and its guarantee active.', 'Enter the reversal', (r) => enterReversal(id, r), 'Reversal entered. A second admin approves it.')}
        >
          Enter a reversal
        </Button>
      );
    }
    if (recovering) {
      buttons.push(
        <Button key="recovery" onClick={() => setForm('recovery')}>
          Enter a recovery
        </Button>,
        <Button
          key="write-off"
          variant="outline"
          onClick={() => reasoned('Enter a write-off?', "What wasn't recovered is written off. Once a second admin approves it, the recovery closes and the member's block is lifted.", 'Enter the write-off', (r) => enterWriteOff(id, r), 'Write-off entered. A second admin approves it.')}
        >
          Enter a write-off
        </Button>
      );
    }
  }
  if (canManage && takesDocuments)
    buttons.push(
      <Button key="attach" variant="outline" onClick={() => setForm('attach')}>
        Attach a lender's document
      </Button>
    );

  return (
    <>
      {l.pendingAction ? (
        <section aria-label="Waiting for approval" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <Banner tone="warn">
            Waiting for approval: {stepName(l.pendingAction).toLowerCase()}, entered by {mine ? 'you' : l.pendingBy}, {formatDateTime(l.pendingAt, { zone: true })}.
          </Banner>
          {canManage ? (
            <>
              {mine ? <Muted>You entered it, so a different admin approves or rejects it.</Muted> : null}
              <div className="flex flex-wrap justify-end gap-2.5">
                <Button variant="danger" disabled={mine} onClick={() => decide(false)}>
                  Reject
                </Button>
                <Button disabled={mine} onClick={() => decide(true)}>
                  Approve
                </Button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      {canManage && !l.pendingAction && l.status === 'open' && !docs ? <Muted>Attach the lender's default documents before entering a default.</Muted> : null}
      {canManage && !l.pendingAction && verifyBlocked && !l.defaultVerifiedAt && l.status === 'defaulted' ? <Muted>You entered this default, so a different admin verifies it.</Muted> : null}
      {buttons.length ? <div className="flex flex-wrap gap-2.5">{buttons}</div> : null}
      <RepaymentDialog open={form === 'repayment'} loanId={id} rows={rows} onClose={() => setForm(null)} onSaved={saved} />
      <DefaultDialog open={form === 'default'} loanId={id} rows={rows} onClose={() => setForm(null)} onSaved={saved} />
      <AttachDialog open={form === 'attach'} loanId={id} rows={rows} onClose={() => setForm(null)} onSaved={saved} />
      <ClaimPayoutDialog open={form === 'payout'} loanId={id} rows={payoutRows} onClose={() => setForm(null)} onSaved={saved} />
      <RecoveryDialog open={form === 'recovery'} loanId={id} rows={rows} onClose={() => setForm(null)} onSaved={() => saved()} />
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

// what approving each step does, in the backend's words
const APPROVED: Record<string, string> = {
  repayment: 'The loan is repaid and its guarantee closes, leaving Total Outstanding.',
  default: 'The loan is defaulted and its guarantee goes into claim. A different admin then verifies it against its documents.',
  reversal: "The loan is open again, its guarantee active, and the member's block is lifted.",
  payout: 'The claim is paid from Liquid Funds and its guarantee closes.',
  write_off: "The recovery closes and the member's block is lifted."
};
