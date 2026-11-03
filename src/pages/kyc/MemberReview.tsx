import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '@/api/errors';
import { getKyc, getProofOfAddress, reviewAddressDocument, reviewKyc, type AddressDocument, type Kyc } from '@/api/kyc';
import { getMember, getUploads } from '@/api/members';
import type { Account } from '@/api/types';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Fields, Item, Items, Muted, SectionTitle, StatusPill } from '@/components/ui/parts';
import { TabPanel, Tabs, type TabOption } from '@/components/ui/tabs';
import { formatDate, formatDateTime } from '@/lib/format';
import { documentStatus, documentType, idType, kycStatus, proofOfAddress } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { useOpenFile } from '@/lib/useOpenFile';
import { fileSize } from '@/pages/members/MemberTabs';

export const REVIEW_TABS = [
  { value: 'kyc', label: 'KYC submission' },
  { value: 'address', label: 'Proof of address' }
] as const satisfies readonly TabOption[];

export type ReviewTab = (typeof REVIEW_TABS)[number]['value'];

// Each read of these decrypts the member's details and is written to the audit log, so they're read once
// while the panel is open (never refetched in the background) and dropped when it closes.
const auditedRead = { staleTime: Infinity, gcTime: 0 } as const;

/** One member's KYC submission and Proof of Address, with the decisions on whatever is waiting for review. */
export function MemberReview({ memberId, tab, onTab }: { memberId: string; tab: ReviewTab; onTab: (t: string) => void }) {
  const query = useQuery({ queryKey: ['members', memberId], queryFn: () => getMember(memberId) });

  if (query.isPending) return <Muted>Loading the member…</Muted>;
  if (query.isError) {
    const gone = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
    return <Banner tone="bad">{gone ? "There's no member with this ID." : errorMessage(query.error)}</Banner>;
  }

  const member = query.data;
  return (
    <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="m-0 font-heading text-xl font-bold [overflow-wrap:anywhere]">{fullName(member) || 'Unnamed member'}</h2>
        <span className="text-muted">{member.member?.memberNumber ?? ''}</span>
        <Link to={`/members/${memberId}`} className="ml-auto font-medium text-ink-strong underline underline-offset-4">
          Open the member's page
        </Link>
      </div>
      <Tabs label="Review" idPrefix="review" tabs={REVIEW_TABS} value={tab} onChange={onTab} />
      <TabPanel key={`${memberId}-${tab}`} idPrefix="review" value={tab}>
        <p className="m-0 mb-3.5 text-[13px] text-muted">Each time you open these details, it's written to the audit log.</p>
        {tab === 'address' ? <AddressPanel member={member} /> : <KycPanel member={member} />}
      </TabPanel>
    </section>
  );
}

/** One admin decides, and it takes effect at once. A rejection's reason is shown to the member. */
function review(accept: boolean, verb: string, what: string): Pick<Decision, 'title' | 'description' | 'confirm' | 'danger' | 'note'> {
  return {
    title: `${verb} ${what}?`,
    description: `One admin decides, and it takes effect at once. ${accept ? 'It counts towards the member’s Trust Score straight away.' : 'The member sees the reason, and can put forward a new one.'}`,
    confirm: verb,
    danger: !accept,
    note: accept ? undefined : { label: 'Reason', hint: `${NOTE_HINT} The member sees it.`, required: 'Give a reason. The member sees it.' }
  };
}

/** Member details and status change with a decision: the list, the member's page and their Trust Score. */
function useAfterDecision() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['members'] });
}

function KycPanel({ member }: { member: Account }) {
  const id = member.id!;
  const name = fullName(member) || 'the member';
  const qc = useQueryClient();
  const afterDecision = useAfterDecision();
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const query = useQuery({ queryKey: ['kyc-details', id], queryFn: () => getKyc(id), ...auditedRead });
  const files = useQuery({ queryKey: ['members', id, 'files', 'kyc-document'], queryFn: () => getUploads(id, 1, 10, 'kyc-document') });
  const { open, opening } = useOpenFile();

  if (query.isPending) return <Muted>Loading the KYC details…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  const kyc = query.data;
  if (kyc.status === 'not_submitted' || !kyc.submittedAt) return <Muted>This member hasn't submitted KYC details.</Muted>;

  const decide = (verified: boolean) =>
    setDecision({
      ...review(verified, verified ? 'Verify' : 'Reject', 'this KYC submission'),
      rows: [
        { k: 'Member', v: `${name}, ${member.member?.memberNumber ?? ''}` },
        { k: 'Submitted', v: formatDateTime(kyc.submittedAt, { zone: true }) }
      ],
      run: async (reason) => {
        const r = await reviewKyc(id, verified ? 'verified' : 'rejected', verified ? undefined : reason);
        // the answer has the ID number masked, so only the decision is taken from it
        qc.setQueryData<Kyc>(['kyc-details', id], (old) => (old ? { ...old, status: r.status, reviewedAt: r.reviewedAt, rejectionReason: r.rejectionReason } : old));
      },
      done: () => {
        afterDecision();
        toast.success(verified ? `KYC verified for ${name}.` : `KYC rejected for ${name}.`);
      }
    });

  return (
    <div className="flex flex-col gap-3.5">
      {kyc.status === 'verified' ? <Banner tone="ok">Verified {formatDateTime(kyc.reviewedAt, { zone: true })}.</Banner> : null}
      {kyc.status === 'rejected' ? (
        <Banner tone="bad">
          Rejected {formatDateTime(kyc.reviewedAt, { zone: true })}. {kyc.rejectionReason ? `Reason: ${kyc.rejectionReason}` : ''}
        </Banner>
      ) : null}
      <Fields
        rows={[
          { k: 'Status', v: <StatusPill label={kycStatus(kyc.status)} /> },
          { k: 'ID type', v: idType(kyc.idType) },
          { k: 'ID number', v: kyc.idNumber ?? '—' },
          { k: 'Date of birth', v: formatDate(kyc.dateOfBirth) },
          { k: 'Address', v: kyc.address ?? '—' },
          { k: 'Submitted', v: formatDateTime(kyc.submittedAt, { zone: true }) }
        ]}
      />
      <SectionTitle>ID document</SectionTitle>
      {files.isPending ? (
        <Muted>Loading the files…</Muted>
      ) : files.isError ? (
        <Banner tone="bad">{errorMessage(files.error)}</Banner>
      ) : files.data.results?.length ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <Items inset label="ID documents">
            {files.data.results.map((f) => (
              <Item
                key={f.id}
                title={f.label || 'ID document'}
                sub={[fileSize(f.sizeBytes), `uploaded ${formatDateTime(f.createdAt, { zone: true })}`].filter(Boolean).join(' · ')}
                actions={
                  <Button variant="outline" onClick={() => void open(f.id!)} disabled={opening === f.id}>
                    {opening === f.id ? 'Opening…' : 'Open the file'}
                  </Button>
                }
              />
            ))}
          </Items>
        </div>
      ) : (
        <Muted>The member has no ID document on file.</Muted>
      )}
      {kyc.status === 'pending' ? (
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="danger" onClick={() => decide(false)}>
            Reject
          </Button>
          <Button onClick={() => decide(true)}>Verify</Button>
        </div>
      ) : null}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
}

const mapLink = (lat: string, lon: string) => `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;

function AddressPanel({ member }: { member: Account }) {
  const id = member.id!;
  const name = fullName(member) || 'the member';
  const qc = useQueryClient();
  const afterDecision = useAfterDecision();
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const query = useQuery({ queryKey: ['address-proof', id], queryFn: () => getProofOfAddress(id), ...auditedRead });
  const { open, opening } = useOpenFile();

  if (query.isPending) return <Muted>Loading the proof of address…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  const proof = query.data;
  const pin = proof.pin;
  const documents = proof.documents ?? [];

  const decide = (d: AddressDocument, approved: boolean) =>
    setDecision({
      ...review(approved, approved ? 'Approve' : 'Reject', 'this document'),
      rows: [
        { k: 'Member', v: `${name}, ${member.member?.memberNumber ?? ''}` },
        { k: 'Document', v: `${documentType(d.documentType)}, issued ${formatDate(d.issueDate)}` }
      ],
      run: async (reason) => {
        // the answer is the member's whole Proof of Address after the decision
        const updated = await reviewAddressDocument(id, d.id!, approved ? 'approved' : 'rejected', approved ? undefined : reason);
        qc.setQueryData(['address-proof', id], updated);
      },
      done: () => {
        afterDecision();
        toast.success(approved ? `Document approved for ${name}.` : `Document rejected for ${name}.`);
      }
    });

  return (
    <div className="flex flex-col gap-3.5">
      <Fields rows={[{ k: 'Proof of address', v: <StatusPill label={proofOfAddress(proof.proofOfAddress)} /> }]} />
      <SectionTitle>Map pin</SectionTitle>
      {pin ? (
        <Fields
          rows={[
            {
              k: 'Location',
              v: (
                <span className="flex flex-wrap items-center gap-x-2.5">
                  <span className="tabular-nums">
                    {pin.latitude}, {pin.longitude}
                  </span>
                  <a href={mapLink(String(pin.latitude), String(pin.longitude))} target="_blank" rel="noreferrer noopener" className="font-medium text-ink-strong underline underline-offset-4">
                    Open on a map
                  </a>
                </span>
              )
            },
            { k: "Member's comment", v: pin.comment ?? '—' },
            { k: 'Saved', v: formatDateTime(pin.savedAt, { zone: true }) }
          ]}
        />
      ) : (
        <Muted>The member hasn't saved a map pin.</Muted>
      )}
      <SectionTitle>Documents</SectionTitle>
      {documents.length ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <Items inset label="Documents">
            {documents.map((d) => (
              <Item
                key={d.id}
                title={documentType(d.documentType)}
                sub={[
                  `Issued ${formatDate(d.issueDate)}`,
                  `submitted ${formatDateTime(d.submittedAt, { zone: true })}`,
                  d.status === 'approved' && d.countsUntil ? `counts until ${formatDate(d.countsUntil)}` : '',
                  d.status === 'rejected' && d.rejectionReason ? `Reason: ${d.rejectionReason}` : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
                status={<StatusPill label={documentStatus(d.status)} />}
                actions={
                  <>
                    <Button variant="outline" onClick={() => void open(d.uploadId!)} disabled={opening === d.uploadId}>
                      {opening === d.uploadId ? 'Opening…' : 'Open the file'}
                    </Button>
                    {d.status === 'pending' ? (
                      <>
                        <Button variant="danger" onClick={() => decide(d, false)}>
                          Reject
                        </Button>
                        <Button onClick={() => decide(d, true)}>Approve</Button>
                      </>
                    ) : null}
                  </>
                }
              />
            ))}
          </Items>
        </div>
      ) : (
        <Muted>The member hasn't put forward a utility bill or bank statement.</Muted>
      )}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
}
