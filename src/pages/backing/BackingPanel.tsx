import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { decideAssetBalances, getAssetBalances, pendingBackingKey, setAssetBalances, type AssetBalances } from '@/api/members';
import type { Prices } from '@/api/pool';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lines } from '@/components/ui/card';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog, textareaClass } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Muted, SectionTitle, StatTiles } from '@/components/ui/parts';
import { formatAmount, formatDateTime, formatNumber, formatUsdt } from '@/lib/format';
import { percent } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { readValue, sameValue } from '@/lib/settings';
import { useGrants, useSession } from '@/session/SessionProvider';

// A member's backing (screen 15, and the member's Backing tab): locked BLOCKS read on-chain, and KES deposits and
// vault savings, which an admin enters until the Lipa API sends them and a different admin approves.

// the backend's limit on a note
const NOTE_MAX = 500;

// D-002: a detail view, and amounts entered for approval, are at full precision.
const usdt = (v: string | null | undefined) => formatUsdt(v, { full: true });
const kes = (v: string | null | undefined) => formatAmount(v, 'KES', { full: true });
const usdtFigure = (v: string | null | undefined) => usdt(v).replace(/ USDT$/, '');

/** An amount as typed into a field: 1250.5, with no commas; 0 when none is set. */
const plainAmount = (v: string | null | undefined) => (v ? formatNumber(v).replace(/,/g, '') : '0');

export const backingKey = (id: string) => ['members', id, 'backing'];

/** The prices backing is valued at, and the three haircuts, as the latest stored valuation has them. */
export function PriceLines({ prices: v }: { prices: Prices | undefined }) {
  return (
    <Lines
      rows={[
        { k: 'BLOCKS price', v: v?.usdtPerBlocks ? `${formatNumber(v.usdtPerBlocks)} USDT per BLOCKS` : 'Not read yet, so locked BLOCKS count for 0' },
        ...(v?.blocksReadAt ? [{ k: 'BLOCKS price read', v: formatDateTime(v.blocksReadAt, { zone: true }) }] : []),
        { k: 'KES rate', v: v?.kesPerUsd ? `${formatNumber(v.kesPerUsd)} KES per USD` : 'Not read yet, so KES deposits count for 0' },
        { k: 'Prices stored', v: v?.readAt ? formatDateTime(v.readAt, { zone: true }) : 'None stored yet' },
        { k: 'Locked BLOCKS count at', v: percent(v?.blocksHaircut) },
        { k: 'KES deposits count at', v: percent(v?.kesDepositHaircut) },
        { k: 'Vault savings count at', v: percent(v?.vaultSavingsHaircut) }
      ]}
    />
  );
}

/** A member's backing, with entering new KES deposits and vault savings and deciding a waiting change. */
export function BackingPanel({ memberId, prices = true }: { memberId: string; prices?: boolean }) {
  const query = useQuery({ queryKey: backingKey(memberId), queryFn: () => getAssetBalances(memberId) });
  if (query.isPending) return <Muted>Loading backing…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  return <Backing memberId={memberId} b={query.data} prices={prices} />;
}

function Backing({ memberId, b, prices }: { memberId: string; b: AssetBalances; prices: boolean }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const canUpdate = can(useGrants(), 'MEMBERS.UPDATE');
  const [entering, setEntering] = React.useState(false);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const p = b.pending;
  const mine = !!p && p.enteredBy?.toLowerCase() === session?.email.toLowerCase();

  // an approved change revalues the member and everyone whose Relationship Value counts them, and the pool totals
  // (and an entered or decided change joins or leaves the list waiting for approval)
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['members', memberId] }), qc.invalidateQueries({ queryKey: pendingBackingKey }), qc.invalidateQueries({ queryKey: ['pool'] })]);

  const decide = (approve: boolean) =>
    setDecision({
      title: approve ? 'Approve this backing change?' : 'Reject this backing change?',
      description: approve
        ? "The new amounts count from now on, and everyone whose Relationship Value includes this member's backing is revalued."
        : 'The KES deposits and vault savings stay as they are.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [
        { k: 'KES deposits', v: `${kes(b.kesDeposits?.amount)} → ${kes(p?.kesDeposits)}` },
        { k: 'Vault savings', v: `${usdt(b.usdtVaultSavings?.amount)} → ${usdt(p?.usdtVaultSavings)}` },
        { k: 'Entered by', v: `${p?.enteredBy ?? '—'}, ${formatDateTime(p?.enteredAt, { zone: true })}` },
        ...(p?.note ? [{ k: 'Note', v: p.note }] : [])
      ],
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Kept in the audit log.` },
      run: async (note) => {
        const saved = await decideAssetBalances(memberId, approve ? 'approve' : 'reject', note || undefined);
        qc.setQueryData(backingKey(memberId), saved);
        await refresh();
      },
      done: () => toast.success(approve ? 'The new KES deposits and vault savings count from now on.' : 'Backing change rejected.')
    });

  return (
    <div className="flex flex-col gap-3.5">
      {p ? (
        <section aria-label="Waiting for approval" className="flex flex-col gap-3">
          <Banner tone="warn">
            Waiting for a second admin: KES deposits {kes(p.kesDeposits)} and vault savings {usdt(p.usdtVaultSavings)}, entered by {mine ? 'you' : p.enteredBy ?? 'an admin'} on {formatDateTime(p.enteredAt, { zone: true })}.
            {p.note ? ` Note: ${p.note}` : ''}
          </Banner>
          {canUpdate ? (
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
      <StatTiles tiles={[{ label: 'Backing', value: usdtFigure(b.backingUsdt), unit: 'USDT', note: 'What the three assets count for, after their haircuts' }]} />
      <Lines
        rows={[
          { k: 'Locked BLOCKS (read on-chain)', v: `${formatAmount(b.lockedBlocks?.amount, 'BLOCKS', { full: true })} → ${usdt(b.lockedBlocks?.valueUsdt)}` },
          { k: 'KES non-withdrawable deposits', v: `${kes(b.kesDeposits?.amount)} → ${usdt(b.kesDeposits?.valueUsdt)}` },
          { k: 'USDT vault savings', v: `${usdt(b.usdtVaultSavings?.amount)} → ${usdt(b.usdtVaultSavings?.valueUsdt)}` },
          {
            k: 'KES deposits and vault savings last set',
            v: b.updatedAt ? `${formatDateTime(b.updatedAt, { zone: true })}${b.updatedBy ? `, entered by ${b.updatedBy}` : ''}` : 'Never set'
          }
        ]}
      />
      {canUpdate ? (
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {p ? <Muted>New amounts can be entered once the waiting change is approved or rejected.</Muted> : null}
          <Button variant="outline" disabled={!!p} onClick={() => setEntering(true)}>
            Enter new amounts
          </Button>
        </div>
      ) : null}
      {prices ? (
        <>
          <SectionTitle>Prices and haircuts used</SectionTitle>
          <PriceLines prices={b.valuation} />
        </>
      ) : null}
      <EnterDialog
        open={entering}
        balances={b}
        onClose={() => setEntering(false)}
        onSaved={(saved) => {
          qc.setQueryData(backingKey(memberId), saved);
          void refresh();
        }}
      />
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
}

/** Both amounts are entered together, and both replace what's there. */
function EnterDialog({ open, balances: b, onClose, onSaved }: { open: boolean; balances: AssetBalances; onClose: () => void; onSaved: (b: AssetBalances) => void }) {
  // opens with the amounts in force, so changing one leaves the other as it is
  const [f, setF] = React.useState({ kes: '', vault: '', note: '' });
  React.useEffect(() => {
    if (open) setF({ kes: plainAmount(b.kesDeposits?.amount), vault: plainAmount(b.usdtVaultSavings?.amount), note: '' });
  }, [open]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const kesRead = readValue(f.kes);
  const vaultRead = readValue(f.vault);

  const check = () => {
    if ('error' in kesRead) return `KES deposits: ${kesRead.error}`;
    if ('error' in vaultRead) return `Vault savings: ${vaultRead.error}`;
    if (sameValue(kesRead.value, b.kesDeposits?.amount ?? '0') && sameValue(vaultRead.value, b.usdtVaultSavings?.amount ?? '0'))
      return 'Both amounts are the ones in force now. Change at least one.';
    return '';
  };

  return (
    <FormDialog
      open={open}
      title="Enter new KES deposits and vault savings"
      description="Both amounts replace the ones in force. They count once a different admin approves them."
      rows={[
        { k: 'KES deposits now', v: kes(b.kesDeposits?.amount) },
        { k: 'Vault savings now', v: usdt(b.usdtVaultSavings?.amount) }
      ]}
      confirm="Enter the amounts"
      onClose={onClose}
      check={check}
      send={() => setAssetBalances(b.memberId!, (kesRead as { value: number }).value, (vaultRead as { value: number }).value, f.note.trim() || undefined)}
      saved={onSaved}
      done="Amounts entered. A second admin approves them."
    >
      <Field id="backing-kes" label="KES non-withdrawable deposits" hint="In KES, 0 or more, with no commas.">
        <Input id="backing-kes" inputMode="decimal" autoComplete="off" value={f.kes} onChange={set('kes')} aria-describedby="backing-kes-hint" className="font-mono" />
      </Field>
      <Field id="backing-vault" label="USDT vault savings" hint="In USDT, 0 or more, with no commas.">
        <Input id="backing-vault" inputMode="decimal" autoComplete="off" value={f.vault} onChange={set('vault')} aria-describedby="backing-vault-hint" className="font-mono" />
      </Field>
      <Field id="backing-note" label="Note (optional)" hint={`${NOTE_HINT} Shown to the admin who approves it, and kept in the audit log.`}>
        <textarea id="backing-note" value={f.note} maxLength={NOTE_MAX} rows={2} onChange={set('note')} aria-describedby="backing-note-hint" className={textareaClass} />
      </Field>
    </FormDialog>
  );
}
