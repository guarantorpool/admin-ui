import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { getKycKeyStatus, previewKeyLossReset, reencryptKyc, runKeyLossReset, type KeyLossPreview } from '@/api/kycKey';
import type { MessageResponse } from '@/api/types';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DecisionDialog, type Decision } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Item, Items, Muted, StatTiles } from '@/components/ui/parts';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';

// Screen 20. The keys that encrypt members' private KYC details (ID number, date of birth, address and the
// address pin), for the system admin only (BlockCoop D-018, D-025). The keys themselves are server settings:
// KYC_ENCRYPTION_KEY is the current one and KYC_OLD_ENCRYPTION_KEYS the ones still being read.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the admin types to run the key-loss reset, so the number of members is read, not clicked past. */
export const resetPhrase = (members: number) => `reset ${plural(members, 'member')}`;

export function KycKeyPage() {
  const grants = useGrants();
  if (!can(grants, 'SYSTEM_ADMIN')) return <NoAccess />;
  return <KycKey />;
}

function KycKey() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['kyc-key', 'status'], queryFn: getKycKeyStatus });
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [preview, setPreview] = React.useState<KeyLossPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['kyc-key'] });
  const reported = (m: MessageResponse) => toast.success(m.title ?? 'Done.', { description: m.message });

  const loadPreview = async () => {
    setPreviewing(true);
    setPreviewError('');
    try {
      setPreview(await previewKeyLossReset());
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  };

  const s = status.data;
  const records = s?.records ?? 0;
  const unreadable = s?.unreadable ?? 0;
  const byKey = Object.entries(s?.recordsByKey ?? {});
  const affected = preview?.unreadable ?? [];

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>Members' ID numbers, dates of birth, addresses and address pins are stored encrypted. The keys are set on the server; this screen shows which ones the stored details use, and moves them to the current key.</Muted>

        <Card aria-labelledby="keys-title">
          <CardHeader title={<span id="keys-title">Keys in use</span>} />
          {status.isPending ? (
            <p className="m-0 text-muted">Loading…</p>
          ) : status.isError ? (
            <Banner tone="bad">{errorMessage(status.error)}</Banner>
          ) : (
            <>
              <StatTiles
                tiles={[
                  { label: 'Current key', value: s!.currentKeyId ?? '—' },
                  { label: 'Members with KYC details', value: String(records) },
                  { label: "Can't be read", value: String(unreadable) }
                ]}
              />
              {records > 0 && unreadable === records ? (
                <Banner tone="bad">None of the stored details can be read. Check KYC_ENCRYPTION_KEY on the server before anything else: a wrong key there looks the same as a lost one.</Banner>
              ) : unreadable > 0 ? (
                <Banner tone="warn">
                  {plural(unreadable, "member's", "members'")} details can't be read with any key the server has. If their key is only missing from KYC_OLD_ENCRYPTION_KEYS, add it back. If it is lost for good, run the key-loss reset below.
                </Banner>
              ) : null}
              {byKey.length ? (
                <Items label="Members by key">
                  {byKey.map(([key, n]) => (
                    <Item key={key} title={<span className="font-mono">{key || '(none)'}</span>} sub={key === s!.currentKeyId ? 'The current key' : 'An older key'} status={<span className="tabular-nums">{plural(n, 'member')}</span>} />
                  ))}
                </Items>
              ) : (
                <p className="m-0 text-muted">No member has KYC details stored yet.</p>
              )}
            </>
          )}
        </Card>

        <Card aria-labelledby="reencrypt-title">
          <CardHeader
            title={<span id="reencrypt-title">Re-encrypt with the current key</span>}
            actions={
              <Button
                variant="outline"
                disabled={!s}
                onClick={() =>
                  setDecision({
                    title: 'Re-encrypt the KYC details?',
                    description: `Every readable record on an older key is encrypted again with ${s?.currentKeyId}. Records that can't be read are left as they are.`,
                    confirm: 'Re-encrypt',
                    rows: [
                      { k: 'Current key', v: s?.currentKeyId ?? '—' },
                      { k: 'Members with KYC details', v: String(records) }
                    ],
                    run: async () => reported(await reencryptKyc()),
                    done: refresh
                  })
                }
              >
                Re-encrypt
              </Button>
            }
          />
          <Muted>
            To change the key: set the new one as KYC_ENCRYPTION_KEY and put the old one in KYC_OLD_ENCRYPTION_KEYS, restart the server, then re-encrypt here. When no member is on the old key, it can be taken out of KYC_OLD_ENCRYPTION_KEYS.
          </Muted>
        </Card>

        <Card aria-labelledby="reset-title">
          <CardHeader
            title={<span id="reset-title">Key-loss reset</span>}
            actions={
              <Button variant="outline" disabled={previewing} onClick={() => void loadPreview()}>
                {previewing ? 'Checking…' : preview ? 'Preview again' : 'Preview the reset'}
              </Button>
            }
          />
          <Muted>Only for a key that is lost for good. For each member whose details can't be read, the reset deletes the details and their KYC files, sets their KYC back to not submitted, and emails them to submit again. The preview shows who that is and changes nothing.</Muted>
          {previewError ? <Banner tone="bad">{previewError}</Banner> : null}
          {preview ? (
            affected.length ? (
              <>
                <Banner tone="bad">
                  The reset would delete the KYC details of {plural(affected.length, 'member')} and {plural(preview.files ?? 0, 'file')}. This can't be undone.
                </Banner>
                <Items label="Members the reset would affect">
                  {affected.map((a) => (
                    <Item
                      key={a.memberId}
                      title={
                        <Link to={`/members/${a.memberId}`} className="font-semibold text-ink-strong underline-offset-4 hover:underline">
                          {a.memberNumber}
                        </Link>
                      }
                      sub={<>On key <span className="font-mono">{a.keyId || '(none)'}</span></>}
                      status={<span className="tabular-nums">{plural(a.files ?? 0, 'file')}</span>}
                    />
                  ))}
                </Items>
                <div>
                  <Button variant="danger" onClick={() => setConfirming(true)}>
                    Run the reset
                  </Button>
                </div>
              </>
            ) : (
              <Banner tone="ok">Every member's details can be read. The reset has nothing to do.</Banner>
            )
          ) : null}
        </Card>
      </div>

      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
      {preview ? (
        <ConfirmReset
          open={confirming}
          members={affected.length}
          files={preview.files ?? 0}
          onClose={() => setConfirming(false)}
          done={() => {
            setPreview(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function ConfirmReset({ open, members, files, onClose, done }: { open: boolean; members: number; files: number; onClose: () => void; done: () => void }) {
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => setTyped(''), [open]);
  const phrase = resetPhrase(members);
  return (
    <FormDialog
      open={open}
      title="Run the key-loss reset?"
      description={`The KYC details of ${plural(members, 'member')} and ${plural(files, 'file')} are deleted for good, and each member is emailed to submit their KYC again. Their KYC Verified and Proof of Address points drop at once.`}
      confirm="Delete and reset"
      danger
      onClose={onClose}
      check={() => (typed.trim().toLowerCase() !== phrase ? `Type “${phrase}” to confirm.` : '')}
      send={() => runKeyLossReset(members)}
      saved={done}
      done={`The reset is done: ${plural(members, 'member')} emailed to submit their KYC again.`}
    >
      <Field id="reset-confirm" label={`Type “${phrase}” to confirm`}>
        <Input id="reset-confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
