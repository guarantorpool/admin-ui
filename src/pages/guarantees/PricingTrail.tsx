import type { Underwriting } from '@/api/guarantees';
import { Fields, SectionTitle } from '@/components/ui/parts';
import { formatNumber, formatUsdt } from '@/lib/format';
import { percent } from '@/lib/labels';

// The working behind a price, in the backend's order and with its symbols (BlockCoop FR-4.1 to FR-4.7, #92):
// SM = 2 − TS / 100; PD = BDR × SM; LGD = 1 − RR; EL = GA × PD × LGD; CON = GA ÷ NAB;
// BM = max(floor, 2 + CON − LR); BL = EL × (BM − 1); TR = T ÷ 12; P = (EL + BL) × TR.

const usdt = (v: string | undefined) => formatUsdt(v, { full: true });
const num = (v: string | undefined) => formatNumber(v);
/** BDR, RR and LR are pool settings until each one's toggle is on, then limited calculated values. */
const source = (calculated: boolean | undefined) => (calculated ? 'calculated' : 'pool setting');

export interface Priced {
  underwriting?: Underwriting;
  premium?: string;
  premiumRate?: string;
  coverageRatio?: string;
  memberBacking?: string;
  guaranteeToSavingsRatio?: string;
}

export function PricingTrail({ priced }: { priced: Priced }) {
  const u = priced.underwriting ?? {};
  return (
    <div className="flex flex-col gap-3.5">
      <SectionTitle>Risk</SectionTitle>
      <Fields
        rows={[
          { k: 'Trust Score (TS)', v: num(u.trustScore) },
          { k: 'Strength multiplier (SM)', v: num(u.strengthMultiplier) },
          { k: 'Base default rate (BDR)', v: `${percent(u.baseDefaultRate)}, ${source(u.baseDefaultRateCalculated)}` },
          { k: 'Probability of default (PD)', v: percent(u.probabilityOfDefault) },
          { k: 'Recovery rate (RR)', v: `${percent(u.recoveryRate)}, ${source(u.recoveryRateCalculated)}` },
          { k: 'Loss given default (LGD)', v: percent(u.lossGivenDefault) },
          { k: 'Expected loss (EL)', v: usdt(u.expectedLoss) }
        ]}
      />
      <SectionTitle>Pool</SectionTitle>
      <Fields
        rows={[
          { k: 'Pool size', v: usdt(u.poolSize) },
          { k: 'Net available backing (NAB)', v: usdt(u.availableCapacity) },
          { k: 'Concentration (CON)', v: percent(u.concentrationRatio) },
          { k: 'Liquidity ratio (LR)', v: `${percent(u.liquidityRatio)}, ${source(u.liquidityRatioCalculated)}` },
          { k: 'Buffer floor', v: num(u.bufferFloor) },
          { k: 'Buffer multiplier (BM)', v: num(u.bufferMultiplier) },
          { k: 'Buffer loading (BL)', v: usdt(u.bufferLoading) },
          { k: 'Tenure ratio (TR)', v: num(u.tenureRatio) }
        ]}
      />
      <SectionTitle>Price</SectionTitle>
      <Fields
        rows={[
          { k: 'Premium (P)', v: usdt(priced.premium) },
          { k: 'Premium rate (PR), yearly', v: percent(priced.premiumRate) },
          { k: 'Coverage (COV)', v: `${num(priced.coverageRatio)}${Number(priced.coverageRatio) < 1 ? ', below 1: flagged for review' : ''}` },
          { k: "Member's own backing", v: usdt(priced.memberBacking) },
          // shown for information only, not used in pricing; "—" when the member had no backing
          { k: 'Guarantee to savings (GSR)', v: priced.guaranteeToSavingsRatio === '—' ? '— (no backing)' : num(priced.guaranteeToSavingsRatio) }
        ]}
      />
    </div>
  );
}
