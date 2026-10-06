import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from 'recharts';
import {
  SYMPTOM_CATALOG,
  addDays,
  dateRange,
  daysBetween,
  formatShortDate,
  localDate,
} from '@medwatch/core';
import { fetchAdherenceDaily } from '@/lib/api/doses';
import { fetchChanges, fetchMedications } from '@/lib/api/meds';
import { fetchLogs } from '@/lib/api/symptoms';
import { fetchFlags } from '@/lib/api/flags';
import { qk } from '@/lib/queryKeys';
import { todayIn } from '@/lib/format';
import type { FlagRow, PatientRow } from '@/lib/types';
import { nurseCopy } from '@/copy/nurse';
import { flagCopy } from '@/copy/flags';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { SeverityBadge } from '@/components/ui/Badge';
import { Loading, ErrorState } from '@/components/ui/States';

const RANGES = [7, 30, 90] as const;
const COLORS = { given: '#2F6F73', missed: '#B4483C', refused: '#C98A2E' };
// Distinct hues plus distinct dash patterns so lines never rely on color alone.
const LINE_STYLES = [
  { stroke: '#2F6F73', dash: '' },
  { stroke: '#B4483C', dash: '6 3' },
  { stroke: '#5A7FA6', dash: '2 3' },
  { stroke: '#C98A2E', dash: '10 4 2 4' },
  { stroke: '#6B4E8C', dash: '4 4' },
];
const SEVERITY_COLOR = { high: '#B4483C', medium: '#C98A2E', low: '#5A7FA6' } as const;
const CHANGE_SHAPE: Record<string, string> = {
  started: '▲',
  stopped: '■',
  dose_increased: '◆',
  dose_decreased: '◇',
  schedule_changed: '●',
};
const MARGIN = { top: 8, right: 16, bottom: 4, left: 8 };
const Y_WIDTH = 44;

export function TimelineChart({
  patient,
  highlightFlagId,
  onHighlight,
}: {
  patient: PatientRow;
  highlightFlagId?: string | null;
  onHighlight?: (id: string | null) => void;
}) {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const start = addDays(today, -(range - 1));
  const days = useMemo(() => dateRange(start, today), [start, today]);

  const meds = useQuery({
    queryKey: qk.medications(patient.id),
    queryFn: () => fetchMedications(patient.id),
  });
  const changes = useQuery({
    queryKey: qk.changes(patient.id),
    queryFn: () => fetchChanges(patient.id),
  });
  const adherence = useQuery({
    queryKey: qk.adherenceDaily(patient.id, start, today),
    queryFn: () => fetchAdherenceDaily(patient.id, start, today),
  });
  const logs = useQuery({
    queryKey: qk.symptomLogs(patient.id, start),
    queryFn: () => fetchLogs(patient.id, start),
  });
  const flags = useQuery({ queryKey: qk.flags(patient.id), queryFn: () => fetchFlags(patient.id) });
  const [localHighlight, setLocalHighlight] = useState<string | null>(null);
  const highlightId = highlightFlagId ?? localHighlight;
  const setHighlight = (id: string | null) =>
    onHighlight ? onHighlight(id) : setLocalHighlight(id);

  const loading = [meds, changes, adherence, logs, flags].some((q) => q.isLoading);
  const failed = [meds, changes, adherence, logs, flags].find((q) => q.isError);

  const model = useMemo(() => {
    const idx = (d: string) => daysBetween(start, d);
    const medName = new Map((meds.data ?? []).map((m) => [m.id, m.name]));
    const changePoints = (changes.data ?? [])
      .filter((c) => c.effective_date >= start && c.effective_date <= today)
      .map((c, i) => ({
        id: c.id,
        x: idx(c.effective_date),
        y: (i % 3) + 1,
        label: `${CHANGE_SHAPE[c.change_type] ?? '●'} ${medName.get(c.medication_id) ?? ''}`,
        type: c.change_type,
        date: c.effective_date,
      }));
    const adh = new Map((adherence.data ?? []).map((a) => [a.day, a]));
    const adherenceRows = days.map((d, i) => {
      const a = adh.get(d);
      return {
        x: i,
        date: d,
        given: a?.given ?? 0,
        missed: a?.missed ?? 0,
        refused: a?.refused ?? 0,
      };
    });
    // Top 5 symptoms by total severity in the range.
    const totals = new Map<string, number>();
    for (const l of logs.data ?? [])
      for (const e of l.entries)
        if (e.severity > 0)
          totals.set(e.symptom_code, (totals.get(e.symptom_code) ?? 0) + e.severity);
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c);
    const byDate = new Map((logs.data ?? []).map((l) => [l.logged_for_date, l]));
    const symptomRows = days.map((d, i) => {
      const l = byDate.get(d);
      const row: Record<string, number | string | null> = { x: i, date: d };
      for (const c of top)
        row[c] = l ? (l.entries.find((e) => e.symptom_code === c)?.severity ?? 0) : null;
      return row;
    });
    const flagsInRange = (flags.data ?? []).filter((f) => {
      const d = localDate(f.created_at, timezone);
      return d >= start && d <= today;
    });
    return {
      changePoints,
      adherenceRows,
      symptomRows,
      top,
      flagsInRange,
      idx,
      logIdsByDate: byDate,
    };
  }, [
    meds.data,
    changes.data,
    adherence.data,
    logs.data,
    flags.data,
    days,
    start,
    today,
    timezone,
  ]);

  if (loading) return <Loading />;
  if (failed) return <ErrorState onRetry={() => void failed.refetch()} />;

  const highlighted: FlagRow | undefined = (flags.data ?? []).find((f) => f.id === highlightId);
  const hlChanges = new Set(highlighted?.evidence.medication_change_ids ?? []);
  const hlDates = new Set(
    [...model.logIdsByDate.values()]
      .filter((l) => highlighted?.evidence.symptom_log_ids.includes(l.id))
      .map((l) => l.logged_for_date),
  );
  const hlChange = model.changePoints.find((c) => hlChanges.has(c.id));
  const hlOnset = highlighted?.evidence.onset_date
    ? model.idx(highlighted.evidence.onset_date)
    : null;
  const tick = (i: number) => (days[i] ? formatShortDate(days[i]!) : '');
  const xAxis = (hide: boolean) => (
    <XAxis
      type="number"
      dataKey="x"
      domain={[-0.5, range - 0.5]}
      ticks={days.map((_, i) => i).filter((i) => i % Math.ceil(range / 8) === 0 || i === range - 1)}
      tickFormatter={tick}
      hide={hide}
      allowDecimals={false}
    />
  );
  const evidenceBand =
    highlighted && hlChange && hlOnset !== null ? (
      <ReferenceArea x1={hlChange.x - 0.5} x2={hlOnset + 0.5} fill="#D9A86C" fillOpacity={0.15} />
    ) : null;
  const symptomLabel = (c: string) => SYMPTOM_CATALOG.find((s) => s.code === c)?.label ?? c;

  return (
    <section aria-label={nurseCopy.timelineTitle} className="card space-y-3" data-testid="timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{nurseCopy.timelineTitle}</h2>
        <div role="group" aria-label={nurseCopy.range} className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant={r === range ? 'primary' : 'secondary'}
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {nurseCopy.rangeDays(r)}
            </Button>
          ))}
        </div>
      </div>
      <p className="sr-only">
        {nurseCopy.chartSummary(model.changePoints.length, model.top.map(symptomLabel).join(', '))}
      </p>

      <div>
        <h3 className="text-sm font-semibold text-ink-muted">{nurseCopy.laneChanges}</h3>
        {model.changePoints.length ? (
          <div className="h-28" aria-hidden="true">
            <ResponsiveContainer>
              <ScatterChart margin={MARGIN}>
                {xAxis(true)}
                <YAxis type="number" dataKey="y" domain={[0, 4]} hide width={Y_WIDTH} />
                {evidenceBand}
                <Scatter
                  data={model.changePoints}
                  shape={(p: { cx?: number; cy?: number; payload?: { id: string } }) => (
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={hlChanges.has(p.payload?.id ?? '') ? 9 : 6}
                      fill={hlChanges.has(p.payload?.id ?? '') ? '#D9A86C' : '#2F6F73'}
                      stroke="#2B2B2B"
                      strokeWidth={hlChanges.has(p.payload?.id ?? '') ? 2 : 0}
                    />
                  )}
                >
                  <LabelList
                    dataKey="label"
                    position="right"
                    style={{ fontSize: 12, fill: '#2B2B2B' }}
                  />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{nurseCopy.noChanges}</p>
        )}
        {model.changePoints.length ? (
          <ul className="sr-only">
            {model.changePoints.map((c) => (
              <li key={c.id}>
                {formatShortDate(c.date)} {c.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink-muted">{nurseCopy.laneAdherence}</h3>
        <div className="h-36" aria-hidden="true">
          <ResponsiveContainer>
            <BarChart data={model.adherenceRows} margin={MARGIN}>
              <CartesianGrid vertical={false} stroke="#E6E1D8" />
              {xAxis(true)}
              <YAxis allowDecimals={false} width={Y_WIDTH} />
              {evidenceBand}
              <Tooltip labelFormatter={(i) => tick(Number(i))} />
              <Legend />
              <Bar dataKey="given" name={nurseCopy.given} stackId="d" fill={COLORS.given} />
              <Bar dataKey="missed" name={nurseCopy.missed} stackId="d" fill={COLORS.missed} />
              <Bar dataKey="refused" name={nurseCopy.notTaken} stackId="d" fill={COLORS.refused} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink-muted">{nurseCopy.laneSymptoms}</h3>
        {model.top.length ? (
          <div className="h-48" aria-hidden="true">
            <ResponsiveContainer>
              <LineChart data={model.symptomRows} margin={MARGIN}>
                <CartesianGrid vertical={false} stroke="#E6E1D8" />
                {xAxis(false)}
                <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} width={Y_WIDTH} />
                {evidenceBand}
                <Tooltip labelFormatter={(i) => tick(Number(i))} />
                <Legend />
                {model.flagsInRange.map((f) => (
                  <ReferenceLine
                    key={f.id}
                    x={model.idx(localDate(f.created_at, timezone))}
                    stroke={SEVERITY_COLOR[f.severity]}
                    strokeWidth={f.id === highlightId ? 3 : 1}
                    strokeDasharray={f.id === highlightId ? '' : '3 3'}
                  />
                ))}
                {[...hlDates].map((d) => (
                  <ReferenceArea
                    key={d}
                    x1={model.idx(d) - 0.45}
                    x2={model.idx(d) + 0.45}
                    fill="#D9A86C"
                    fillOpacity={0.25}
                  />
                ))}
                {model.top.map((c, i) => (
                  <Line
                    key={c}
                    type="monotone"
                    dataKey={c}
                    name={symptomLabel(c)}
                    stroke={LINE_STYLES[i]!.stroke}
                    strokeDasharray={LINE_STYLES[i]!.dash}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{nurseCopy.noSymptoms}</p>
        )}
      </div>

      {model.flagsInRange.length ? (
        <div>
          <h3 className="text-sm font-semibold text-ink-muted">{nurseCopy.flagsInRange}</h3>
          <ul className="mt-1 flex flex-wrap gap-2">
            {model.flagsInRange.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  aria-pressed={f.id === highlightId}
                  onClick={() => setHighlight(f.id === highlightId ? null : f.id)}
                  className={`flex min-h-touch items-center gap-2 rounded-xl border-2 px-3 text-left ${f.id === highlightId ? 'border-accent bg-accent-light' : 'border-line hover:border-primary'}`}
                  data-testid="timeline-flag"
                >
                  <SeverityBadge severity={f.severity} />
                  <span className="text-sm font-semibold">{f.title}</span>
                  <span className="text-xs text-ink-muted">
                    {formatShortDate(localDate(f.created_at, timezone))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {highlighted ? (
            <div
              className="mt-2 rounded-xl bg-accent-light p-3 text-sm"
              data-testid="timeline-highlight"
            >
              <p className="font-semibold">{highlighted.title}</p>
              <p>{highlighted.explanation}</p>
              <Button variant="ghost" onClick={() => setHighlight(null)}>
                {nurseCopy.clearHighlight}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only">{flagCopy.readOnlyNote}</p>
    </section>
  );
}
