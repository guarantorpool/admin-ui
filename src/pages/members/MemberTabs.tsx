import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ApiError, errorMessage } from "@/api/errors";
import {
  getMemberGuarantees,
  getNetworkValue,
  getNetworkValueHistory,
  getRelationships,
  getRelationshipValue,
  getTrustScore,
  getTrustScoreHistory,
  getUploads,
  refreshLockedBlocks,
} from "@/api/members";
import type { Account } from "@/api/types";
import { Badge, Banner } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lines } from "@/components/ui/card";
import { Pager } from "@/components/ui/pager";
import {
  Bars,
  Fields,
  Item,
  Items,
  Muted,
  SectionTitle,
  StatTiles,
  StatusPill,
} from "@/components/ui/parts";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatNumber,
  formatUsdt,
} from "@/lib/format";
import {
  connectionStatus,
  connectionType,
  guaranteeStatus,
  kycStatus,
  metricName,
  percent,
  PILLARS,
  pillarName,
  proofOfAddress,
  scoreTrigger,
} from "@/lib/labels";
import { fullName } from "@/lib/names";
import { BackingPanel } from "@/pages/backing/BackingPanel";
import { can } from "@/lib/permissions";
import { useOpenFile } from "@/lib/useOpenFile";
import { cn } from "@/lib/utils";
import { useGrants } from "@/session/SessionProvider";

// D-002: this is a detail view, so amounts are at full precision.
const usdt = (v: string | null | undefined) => formatUsdt(v, { full: true });
/** The same figure without its unit, for a stat tile that shows the unit beside it. */
const usdtFigure = (v: string | null | undefined) =>
  usdt(v).replace(/ USDT$/, "");
const HISTORY_SIZE = 10;
const LIST_SIZE = 10;

/** Loading, error and empty states the same way on every tab. */
function Loaded<T>({
  query,
  what,
  children,
}: {
  query: UseQueryResult<T>;
  what: string;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <Muted>Loading {what}…</Muted>;
  if (query.isError)
    return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  return <>{children(query.data)}</>;
}

const score = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : formatNumber(n, 2);

/** A link to another member that keeps the list's search and filters, so closing the panel goes back to them. */
function useMemberLink() {
  const [params] = useSearchParams();
  return (id: string) => {
    const next = new URLSearchParams(params);
    next.delete("tab");
    const s = next.toString();
    return `/members/${id}${s ? `?${s}` : ""}`;
  };
}

/**
 * The member's locked BLOCKS, and with MEMBERS.UPDATE a way to read them on-chain again now (C5). A new amount also
 * changes their Trust Score and Relationship Values, so everything about the member is fetched again.
 */
function LockedBlocks({
  memberId,
  amount,
}: {
  memberId: string;
  amount: string | null | undefined;
}) {
  const grants = useGrants();
  const qc = useQueryClient();
  const reread = useMutation({
    mutationFn: () => refreshLockedBlocks(memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", memberId] }),
  });
  const failed =
    reread.error instanceof ApiError && reread.error.status === 503
      ? "The chain couldn't be read just now, so the last amount is kept. Try again in a moment."
      : reread.error
        ? errorMessage(reread.error)
        : "";
  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        {formatAmount(amount, "BLOCKS", { full: true })}
        {can(grants, "MEMBERS.UPDATE") ? (
          <Button
            size="sm"
            variant="outline"
            disabled={reread.isPending}
            onClick={() => reread.mutate()}
          >
            {reread.isPending ? "Reading…" : "Read again now"}
          </Button>
        ) : null}
      </span>
      <span role="status" className="text-[13px] text-muted">
        {reread.data
          ? `Read on-chain${reread.data.readAt ? ` ${formatDateTime(reread.data.readAt, { zone: true })}` : ""}: ${formatAmount(reread.data.lockedBlocks, "BLOCKS", { full: true })}. A reading within the last 30 seconds is reused.`
          : ""}
      </span>
      {failed ? (
        <span role="alert" className="text-[13px] text-bad-fg">
          {failed}
        </span>
      ) : null}
    </span>
  );
}

export function OverviewTab({ member }: { member: Account }) {
  const id = member.id!;
  const trust = useQuery({
    queryKey: ["members", id, "trust"],
    queryFn: () => getTrustScore(id),
  });
  const limit = useQuery({
    queryKey: ["members", id, "limit"],
    queryFn: () => getNetworkValue(id),
  });
  const details = member.member;
  const memberLink = useMemberLink();
  const kyc = kycStatus(details?.kycStatus);
  const poa = proofOfAddress(details?.proofOfAddress);
  return (
    <div className="flex flex-col gap-3.5">
      {member.status === "disabled" ? (
        <Banner tone="bad">
          Disabled {formatDateTime(member.disabledAt, { zone: true })}
          {member.disabledBy ? ` by ${member.disabledBy}` : ""}.{" "}
          {member.disabledReason
            ? `Reason: ${member.disabledReason}`
            : "No reason was given."}
        </Banner>
      ) : null}
      <Fields
        rows={[
          { k: "Member number", v: details?.memberNumber ?? "—" },
          { k: "Phone", v: member.phoneNumber ?? "—" },
          {
            k: "Email",
            v: (
              <>
                {member.email ?? "—"}
                {member.email && !member.emailVerified ? (
                  <span className="text-muted"> (not confirmed)</span>
                ) : null}
              </>
            ),
          },
          { k: "Joined", v: formatDate(member.createdAt) },
          {
            k: "Last sign-in",
            v: formatDateTime(member.lastLogin, { zone: true }),
          },
          { k: "KYC", v: <StatusPill label={kyc} /> },
          { k: "Proof of address", v: <StatusPill label={poa} /> },
          {
            k: "Locked BLOCKS",
            v: <LockedBlocks memberId={id} amount={details?.lockedBlocks} />,
          },
          {
            k: "Trust Score",
            v: trust.isError
              ? "—"
              : trust.data
                ? trust.data.trustScore === undefined
                  ? "Not calculated yet"
                  : `${score(trust.data.trustScore)} of 100`
                : "…",
          },
          {
            k: "Maximum guarantee",
            v: limit.isError
              ? "—"
              : limit.data
                ? usdt(limit.data.maximumGuarantee)
                : "…",
          },
          ...(details?.referredBy
            ? [
                {
                  k: "Referred by",
                  v: (
                    <Link
                      to={memberLink(details.referredBy)}
                      className="font-medium text-ink-strong underline underline-offset-4"
                    >
                      Open the member who referred them
                    </Link>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

export function BackingTab({ member }: { member: Account }) {
  return <BackingPanel memberId={member.id!} />;
}

export function TrustTab({ member }: { member: Account }) {
  const id = member.id!;
  const [page, setPage] = React.useState(1);
  // the pillars whose inputs are showing; each folds away under its own row
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const query = useQuery({
    queryKey: ["members", id, "trust"],
    queryFn: () => getTrustScore(id),
  });
  const history = useQuery({
    queryKey: ["members", id, "trust-history", page],
    queryFn: () => getTrustScoreHistory(id, page, HISTORY_SIZE),
    placeholderData: keepPreviousData,
  });
  const toggle = (pillar: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(pillar)) next.add(pillar);
      return next;
    });
  return (
    <Loaded query={query} what="the Trust Score">
      {(t) => {
        const pillars = PILLARS.map((p) =>
          t.pillars?.find((x) => x.pillar === p),
        ).filter((p) => p !== undefined);
        const metrics = t.metrics ?? [];
        // the four pillars in order, then any other one a metric names
        const groups = [
          ...new Set<string>([
            ...PILLARS,
            ...metrics.map((m) => m.pillar ?? ""),
          ]),
        ]
          .map((p) => ({
            pillar: p,
            of: t.pillars?.find((x) => x.pillar === p),
            metrics: metrics.filter((m) => (m.pillar ?? "") === p),
          }))
          .filter((g) => g.metrics.length);
        const allOpen = groups.every((g) => open.has(g.pillar));
        return (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <StatTiles
                className="min-w-0 flex-1"
                tiles={[
                  {
                    label: "Trust Score",
                    value: t.trustScore === undefined ? "—" : score(t.trustScore),
                    unit: "of 100",
                    note: t.calculatedAt
                      ? `Weighted across the four pillars. Last changed ${formatDateTime(t.calculatedAt, { zone: true })}`
                      : "Not calculated yet",
                  },
                ]}
              />
              {groups.length ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    setOpen(new Set(allOpen ? [] : groups.map((g) => g.pillar)))
                  }
                >
                  {allOpen ? "Close all pillars" : "Open all pillars"}
                </Button>
              ) : null}
            </div>
            {groups.length ? (
              <>
                <SectionTitle>What each input scores</SectionTitle>
                <div className="overflow-x-auto rounded-card border border-line bg-surface">
                  <table className="w-full min-w-[560px] border-collapse text-left">
                    <thead>
                      <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                        <th className="px-3 py-2 font-semibold">Input</th>
                        <th className="px-3 py-2 font-semibold">Value</th>
                        <th className="px-3 py-2 font-semibold">
                          Measured against
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Score
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Adds to the score
                        </th>
                      </tr>
                    </thead>
                    {groups.map((g) => {
                      const shown = open.has(g.pillar);
                      return (
                        <tbody key={g.pillar}>
                          <tr className="border-t border-line bg-chip">
                            <td colSpan={5} className="p-0">
                              <button
                                type="button"
                                aria-expanded={shown}
                                onClick={() => toggle(g.pillar)}
                                className="flex min-h-9 w-full items-center justify-between gap-3 px-3 py-1.5 text-left font-semibold text-ink-strong"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 12 12"
                                    className={cn(
                                      "size-3 shrink-0 transition-transform motion-reduce:transition-none",
                                      shown && "rotate-90",
                                    )}
                                  >
                                    <path
                                      d="M4 2l4 4-4 4"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.6"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  {pillarName(g.pillar)}
                                  {g.of ? (
                                    <span className="font-normal text-muted">
                                      · {percent(g.of.weight)} of the score
                                    </span>
                                  ) : null}
                                </span>
                                {g.of ? (
                                  <span className="flex items-center gap-2 tabular-nums">
                                    <span
                                      aria-hidden="true"
                                      className="h-1.5 w-[70px] overflow-hidden rounded bg-line"
                                    >
                                      <span
                                        className="block h-1.5 bg-primary"
                                        style={{
                                          width: `${Math.max(0, Math.min(100, g.of.score ?? 0))}%`,
                                        }}
                                      />
                                    </span>
                                    {score(g.of.score)} of 100
                                  </span>
                                ) : null}
                              </button>
                            </td>
                          </tr>
                          {shown
                            ? g.metrics.map((m) => (
                                <tr key={m.metric} className="border-t border-line">
                                  <td className="px-3 py-1.5 font-medium">
                                    {metricName(m.metric)}
                                  </td>
                                  <td className="px-3 py-1.5 tabular-nums">
                                    {m.outOf
                                      ? `${formatNumber(m.value)} of ${formatNumber(m.outOf)}`
                                      : formatNumber(m.value)}
                                  </td>
                                  <td className="px-3 py-1.5 tabular-nums">
                                    {m.benchmark ? formatNumber(m.benchmark) : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">
                                    {score(m.score)}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">
                                    {score(m.scoreContribution)}
                                  </td>
                                </tr>
                              ))
                            : null}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              </>
            ) : (
              // with no inputs to group them over, the pillars show as bars
              <Bars
                bars={pillars.map((p) => ({
                  label: `${pillarName(p.pillar)} (${percent(p.weight)} of the score)`,
                  value: `${score(p.score)} of 100`,
                  pct: p.score ?? 0,
                }))}
              />
            )}
            <SectionTitle>History</SectionTitle>
            <Loaded query={history} what="the history">
              {(h) =>
                h.results?.length ? (
                  <div className="overflow-hidden rounded-card border border-line bg-surface">
                    {/* one line an entry: the score, then when and why */}
                    <ul
                      aria-label="Trust Score history"
                      className="m-0 flex list-none flex-col p-0"
                    >
                      {h.results.map((s, i) => (
                        <li
                          key={`${s.calculatedAt}-${i}`}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line px-3.5 py-1.5 first:border-t-0"
                        >
                          <span className="font-semibold tabular-nums">
                            {score(s.trustScore)} of 100
                          </span>
                          <span className="text-muted">
                            {formatDateTime(s.calculatedAt, { zone: true })} ·{" "}
                            {scoreTrigger(s.trigger)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Pager
                      page={page}
                      size={HISTORY_SIZE}
                      total={h.totalResults ?? 0}
                      onPage={setPage}
                    />
                  </div>
                ) : (
                  <Muted>No history yet.</Muted>
                )
              }
            </Loaded>
          </div>
        );
      }}
    </Loaded>
  );
}

export function ConnectionsTab({ member }: { member: Account }) {
  const id = member.id!;
  const [page, setPage] = React.useState(1);
  const memberLink = useMemberLink();
  const value = useQuery({
    queryKey: ["members", id, "relationship-value"],
    queryFn: () => getRelationshipValue(id),
  });
  const list = useQuery({
    queryKey: ["members", id, "connections", page],
    queryFn: () => getRelationships(id, page, LIST_SIZE),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-3.5">
      <Loaded query={value} what="the Relationship Value">
        {(rv) => (
          <>
            <StatTiles
              tiles={[
                {
                  label: "Relationship Value",
                  value: usdtFigure(rv.relationshipValue),
                  unit: "USDT",
                  note: "From the backing of this member's connections",
                },
                {
                  label: "Activity multiplier",
                  value: formatNumber(rv.activityMultiplier),
                  unit: "×",
                  note: `${formatNumber(rv.qualifiedTransactions)} qualifying payments`,
                },
                {
                  label: "Raw network value",
                  value: usdtFigure(rv.rawNetworkValue),
                  unit: "USDT",
                  note: "Relationship Value × activity multiplier",
                },
              ]}
            />
            {rv.breakdown?.some((b) => (b.connections ?? 0) > 0) ? (
              <Lines
                rows={rv.breakdown
                  .filter((b) => (b.connections ?? 0) > 0)
                  .map((b) => ({
                    k: `${connectionType(b.relationshipType)}, ${connectionStatus(b.status).text.toLowerCase()} (weight ${formatNumber(b.weight)})`,
                    v: `${formatNumber(b.connections)} → ${usdt(b.value)}`,
                  }))}
              />
            ) : null}
          </>
        )}
      </Loaded>
      <SectionTitle>Connections, sent and received</SectionTitle>
      <Loaded query={list} what="connections">
        {(l) =>
          l.results?.length ? (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <Items inset label="Connections">
                {l.results.map((r) => {
                  const other = r.connectedMember;
                  const when =
                    r.status === "accepted"
                      ? `Accepted ${formatDate(r.acceptedAt)}`
                      : `Asked ${formatDate(r.createdAt)}`;
                  const counts =
                    r.countsAs && r.countsAs !== r.relationshipType
                      ? `, counts as ${connectionType(r.countsAs).toLowerCase()}`
                      : "";
                  const change = r.pendingChange
                    ? ` · Change to ${connectionType(r.pendingChange.relationshipType).toLowerCase()} asked`
                    : "";
                  return (
                    <Item
                      key={r.relationshipId}
                      title={
                        other?.memberId ? (
                          <Link
                            to={memberLink(other.memberId)}
                            className="text-ink-strong underline-offset-4 hover:underline"
                          >
                            {fullName(other) || "A member"}
                          </Link>
                        ) : (
                          fullName(other) || "A member"
                        )
                      }
                      sub={`${r.direction === "sent" ? "Sent" : "Received"} · ${connectionType(r.relationshipType)}${counts} · ${when}${change}`}
                      status={<StatusPill label={connectionStatus(r.status)} />}
                    />
                  );
                })}
              </Items>
              <Pager
                page={page}
                size={LIST_SIZE}
                total={l.totalResults ?? 0}
                onPage={setPage}
              />
            </div>
          ) : (
            <Muted>This member has no connections.</Muted>
          )
        }
      </Loaded>
    </div>
  );
}

export function LimitTab({ member }: { member: Account }) {
  const id = member.id!;
  const [page, setPage] = React.useState(1);
  const query = useQuery({
    queryKey: ["members", id, "limit"],
    queryFn: () => getNetworkValue(id),
  });
  const history = useQuery({
    queryKey: ["members", id, "limit-history", page],
    queryFn: () => getNetworkValueHistory(id, page, HISTORY_SIZE),
    placeholderData: keepPreviousData,
  });
  return (
    <Loaded query={query} what="the limit">
      {(n) => (
        <div className="flex flex-col gap-3.5">
          <StatTiles
            tiles={[
              {
                label: "Maximum guarantee",
                value: usdtFigure(n.maximumGuarantee),
                unit: "USDT",
                note: "Raw network value × correction factor",
              },
              {
                label: "Available headroom",
                value: usdtFigure(n.availableHeadroom),
                unit: "USDT",
                note: `${usdt(n.guaranteesInUse)} in active guarantees and claims`,
              },
            ]}
          />
          <Lines
            rows={[
              { k: "Relationship Value", v: usdt(n.relationshipValue) },
              {
                k: "Activity multiplier",
                v: `${formatNumber(n.activityMultiplier)} × (${formatNumber(n.qualifiedTransactions)} qualifying payments)`,
              },
              { k: "Raw network value", v: usdt(n.rawNetworkValue) },
              { k: "Correction factor", v: formatNumber(n.correctionFactor) },
              {
                k: "Worked out",
                v: formatDateTime(n.calculatedAt, { zone: true }),
              },
            ]}
          />
          <SectionTitle>History</SectionTitle>
          <Loaded query={history} what="the history">
            {(h) =>
              h.results?.length ? (
                <div className="overflow-hidden rounded-card border border-line bg-surface">
                  <Items inset label="Maximum guarantee history">
                    {h.results.map((s) => (
                      <Item
                        key={s.id}
                        title={usdt(s.maximumGuarantee)}
                        sub={`${formatDateTime(s.calculatedAt, { zone: true })} · raw network value ${usdt(s.rawNetworkValue)} × ${formatNumber(s.correctionFactor)}${s.reason === "usdt-migration" ? " · the USDT baseline" : ""}`}
                      />
                    ))}
                  </Items>
                  <Pager
                    page={page}
                    size={HISTORY_SIZE}
                    total={h.totalResults ?? 0}
                    onPage={setPage}
                  />
                </div>
              ) : (
                <Muted>No history yet.</Muted>
              )
            }
          </Loaded>
        </div>
      )}
    </Loaded>
  );
}

export function GuaranteesTab({ member }: { member: Account }) {
  const id = member.id!;
  const [page, setPage] = React.useState(1);
  const query = useQuery({
    queryKey: ["members", id, "guarantees", page],
    queryFn: () => getMemberGuarantees(id, page, LIST_SIZE),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-3.5">
      <Loaded query={query} what="guarantees">
        {(l) =>
          l.results?.length ? (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <Items inset label="Guarantees">
                {l.results.map((g) => (
                  <Item
                    key={g.guaranteeId}
                    title={
                      <Link
                        to={`/guarantees/${g.guaranteeId}`}
                        className="text-ink-strong underline underline-offset-4"
                      >
                        {g.guaranteeId}
                      </Link>
                    }
                    sub={`${usdt(g.amount)} · ${formatNumber(g.tenureMonths)} months · ${g.activatedAt ? `active from ${formatDate(g.activatedAt)}` : `quoted ${formatDate(g.quotedAt)}`}`}
                    status={
                      <>
                        {g.flagged ? <Badge tone="bad">Flagged</Badge> : null}
                        <StatusPill label={guaranteeStatus(g.status)} />
                      </>
                    }
                  />
                ))}
              </Items>
              <Pager
                page={page}
                size={LIST_SIZE}
                total={l.totalResults ?? 0}
                onPage={setPage}
              />
            </div>
          ) : (
            <Muted>This member has no guarantees.</Muted>
          )
        }
      </Loaded>
      <Link
        to={`/guarantees/quotes?member=${id}`}
        className="self-start font-medium text-ink-strong underline underline-offset-4"
      >
        See their quotes
      </Link>
    </div>
  );
}

export const categoryName: Record<string, string> = {
  "kyc-document": "KYC document",
  "proof-of-address": "Proof of address",
  "profile-image": "Profile image",
};

export function fileSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 0)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

export function FilesTab({ member }: { member: Account }) {
  const id = member.id!;
  const grants = useGrants();
  const canOpenPrivate = can(grants, "MEMBERS.KYC");
  const [page, setPage] = React.useState(1);
  const { open, opening } = useOpenFile();
  const query = useQuery({
    queryKey: ["members", id, "files", page],
    queryFn: () => getUploads(id, page, LIST_SIZE),
    placeholderData: keepPreviousData,
  });

  return (
    <Loaded query={query} what="files">
      {(l) =>
        l.results?.length ? (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <Items inset label="Files">
              {l.results.map((f) => {
                const isPrivate = f.visibility === "private";
                const category = f.category
                  ? (categoryName[f.category] ?? f.category)
                  : "File";
                return (
                  <Item
                    key={f.id}
                    title={f.label || category}
                    sub={[
                      category,
                      isPrivate ? "Private" : "Public",
                      fileSize(f.sizeBytes),
                      `uploaded ${formatDate(f.createdAt)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    actions={
                      !isPrivate || canOpenPrivate ? (
                        <Button
                          variant="outline"
                          onClick={() => void open(f.id!)}
                          disabled={opening === f.id}
                        >
                          {opening === f.id ? "Opening…" : "Open the file"}
                        </Button>
                      ) : (
                        <span className="text-muted">
                          Opening it needs KYC review
                        </span>
                      )
                    }
                  />
                );
              })}
            </Items>
            <Pager
              page={page}
              size={LIST_SIZE}
              total={l.totalResults ?? 0}
              onPage={setPage}
            />
          </div>
        ) : (
          <Muted>This member has no files.</Muted>
        )
      }
    </Loaded>
  );
}
