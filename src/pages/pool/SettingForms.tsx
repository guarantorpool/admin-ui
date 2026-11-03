import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { changeParameter, proposeChangeSet, type Parameter } from '@/api/parameters';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NOTE_HINT } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog, selectClass, textareaClass } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { groupSettings, PILLAR_WEIGHTS, readValue, sameValue, settingValue, sumValues } from '@/lib/settings';

// Changing one pool setting, and proposing several as one change set. The backend checks each value against its
// range; these forms only catch what isn't a number, an unchanged value, and pillar weights that don't total 1.

// the backend's limit on a reason, and on the settings in one change set
const NOTE_MAX = 500;
const SET_MAX = 50;

/** After a change: the settings, their changes, and the pool figures that read them. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['parameters'] });
    void qc.invalidateQueries({ queryKey: ['pool'] });
  };
}

function ReasonField({ id, value, onChange, hint }: { id: string; value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <Field id={id} label="Reason (optional)" hint={`${NOTE_HINT} ${hint}`}>
      <textarea id={id} value={value} maxLength={NOTE_MAX} rows={2} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`} className={textareaClass} />
    </Field>
  );
}

/** Changes one setting: at once if it applies at once, otherwise proposed for a second admin. */
export function ChangeDialog({ setting: p, onClose }: { setting: Parameter | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [value, setValue] = React.useState('');
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    setValue('');
    setReason('');
  }, [p]);
  const atOnce = p?.type === 'dynamic';
  const read = readValue(value);

  return (
    <FormDialog
      open={!!p}
      title={`Change ${p?.key ?? 'a setting'}`}
      description={atOnce ? 'This setting applies at once, with no approval, when changed on its own.' : 'A second admin must approve this before it takes effect.'}
      rows={[
        { k: 'Setting', v: <span className="font-mono">{p?.key}</span> },
        { k: 'Now', v: settingValue(p?.key, p?.value) }
      ]}
      confirm={atOnce ? 'Apply now' : 'Propose the change'}
      onClose={onClose}
      check={() => ('error' in read ? read.error : sameValue(read.value, p?.value) ? 'Enter a value that differs from the current one.' : '')}
      send={() => changeParameter(p!.key!, (read as { value: number }).value, reason.trim() || undefined)}
      saved={refresh}
      done={atOnce ? `${p?.key} is changed.` : 'Change proposed. A second admin approves it.'}
    >
      {p?.description ? <p className="m-0 text-[13px] text-muted">{p.description}</p> : null}
      <Field id="setting-value" label="New value" hint="A plain number, as the setting is held: 0.25, not 25%.">
        <Input id="setting-value" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby="setting-value-hint" className="font-mono" />
      </Field>
      <ReasonField id="setting-reason" value={reason} onChange={setReason} hint={atOnce ? 'Kept in the history and the audit log.' : 'Shown to the admin who approves it.'} />
    </FormDialog>
  );
}

interface Line {
  /** each line's own id, so React keeps its inputs when one above is removed */
  id: number;
  key: string;
  value: string;
}

/**
 * Proposes several settings as one change set. Every value waits, those that apply at once too, until a second
 * admin approves the set; then they apply together. `start` is the settings it opens with.
 */
export function ChangeSetDialog({ open, start, settings, onClose }: { open: boolean; start: readonly string[]; settings: readonly Parameter[]; onClose: () => void }) {
  const refresh = useRefresh();
  const next = React.useRef(0);
  const line = (key = ''): Line => ({ id: next.current++, key, value: '' });
  const [lines, setLines] = React.useState<Line[]>([]);
  const [reason, setReason] = React.useState('');
  const loaded = settings.length > 0;
  React.useEffect(() => {
    if (!open || !loaded) return;
    // a setting with a change already waiting can't go in another proposal
    const free = start.filter((k) => !settings.find((s) => s.key === k)?.changePending);
    setLines(free.length ? free.map((k) => line(k)) : [line()]);
    setReason('');
    // a new set each time it opens, once the settings have loaded; `start` is read then
  }, [open, loaded]);

  const byKey = new Map(settings.map((s) => [s.key, s]));
  const groups = groupSettings(settings);
  const edit = (id: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...change } : l)));

  // with the weights not in the set at their current values
  const weightsIn = lines.some((l) => PILLAR_WEIGHTS.includes(l.key));
  const weightTotal = () =>
    sumValues(
      PILLAR_WEIGHTS.map((k) => {
        const typed = lines.find((l) => l.key === k);
        const read = typed ? readValue(typed.value) : null;
        return read && 'value' in read ? read.value : byKey.get(k)?.value ?? 0;
      })
    );

  const check = () => {
    const chosen = lines.filter((l) => l.key);
    if (!chosen.length) return 'Choose at least one setting.';
    if (chosen.length < lines.length) return 'Choose a setting on every line, or remove the empty line.';
    for (const [i, l] of chosen.entries()) {
      if (chosen.findIndex((o) => o.key === l.key) !== i) return `${l.key} is in the set twice.`;
      const read = readValue(l.value);
      if ('error' in read) return `${l.key}: ${read.error}`;
      if (sameValue(read.value, byKey.get(l.key)?.value)) return `${l.key}: enter a value that differs from the current one.`;
    }
    if (weightsIn && weightTotal() !== '1') return `The four pillar weights must total 1, but would total ${weightTotal()}.`;
    return '';
  };

  return (
    <FormDialog
      open={open}
      title="Propose a change set"
      description="These values take effect together once a second admin approves them, those that apply at once too. The four pillar weights must add up to 1."
      confirm="Propose the set"
      onClose={onClose}
      check={check}
      send={() => proposeChangeSet(lines.map((l) => ({ key: l.key, value: (readValue(l.value) as { value: number }).value })), reason.trim() || undefined)}
      saved={refresh}
      done="Change set proposed. A second admin approves it."
    >
      {!loaded ? <p className="m-0 text-muted">Loading the settings…</p> : null}
      <ul aria-label="Settings in the set" hidden={!loaded} className="m-0 flex list-none flex-col gap-3 p-0">
        {lines.map((l, i) => {
          const now = byKey.get(l.key);
          return (
            <li key={l.id} className="flex flex-wrap items-end gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex min-w-[200px] flex-[2_1_200px] flex-col gap-1.5">
                <label htmlFor={`set-key-${l.id}`} className="text-sm font-medium text-ink">
                  Setting {i + 1}
                </label>
                <select id={`set-key-${l.id}`} value={l.key} onChange={(e) => edit(l.id, { key: e.target.value })} className={`${selectClass} font-mono text-[13px]`}>
                  <option value="">Choose a setting</option>
                  {groups.map((g) => (
                    <optgroup key={g.title} label={g.title}>
                      {g.settings.map((s) => (
                        <option key={s.key} value={s.key} disabled={s.changePending && s.key !== l.key}>
                          {s.key}
                          {s.changePending ? ' (a change is waiting)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="flex min-w-[120px] flex-[1_1_120px] flex-col gap-1.5">
                <label htmlFor={`set-value-${l.id}`} className="text-sm font-medium text-ink">
                  {l.key ? `New value for ${l.key}` : 'New value'}
                </label>
                <Input id={`set-value-${l.id}`} inputMode="decimal" autoComplete="off" value={l.value} onChange={(e) => edit(l.id, { value: e.target.value })} aria-describedby={`set-now-${l.id}`} className="font-mono" />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.key || `setting ${i + 1}`}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((o) => o.id !== l.id))}>
                <X />
              </Button>
              <p id={`set-now-${l.id}`} className="m-0 basis-full text-[13px] text-muted">
                {now ? `Now ${settingValue(now.key, now.value)}` : 'Choose a setting to see its value.'}
              </p>
            </li>
          );
        })}
      </ul>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={lines.length >= SET_MAX} onClick={() => setLines((ls) => [...ls, line()])}>
          Add a setting
        </Button>
      </div>
      {weightsIn ? <Banner tone={weightTotal() === '1' ? 'ok' : 'warn'}>The four pillar weights would total {weightTotal()}.</Banner> : null}
      <ReasonField id="set-reason" value={reason} onChange={setReason} hint="Shown to the admin who approves it." />
    </FormDialog>
  );
}
