import type { VisitSummaryContent } from '@medwatch/core';
import { formatDate, formatDateTime, formatPercent } from '@/lib/format';
import { summaryCopy } from '@/copy/summary';
import { flagCopy } from '@/copy/flags';
import { SeverityBadge } from '@/components/ui/Badge';

const cell = 'border-b border-line px-2 py-1 align-top';
const head =
  'border-b border-line px-2 py-1 text-left text-xs font-semibold uppercase text-ink-muted';

function Section({
  title,
  more,
  children,
}: {
  title: string;
  more: number;
  children: React.ReactNode;
}) {
  return (
    <section className="break-inside-avoid">
      <h3 className="mb-1 border-b-2 border-primary text-base font-bold text-primary">{title}</h3>
      {children}
      {more ? <p className="mt-1 text-xs text-ink-muted">{summaryCopy.more(more)}</p> : null}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-ink-muted">{summaryCopy.noRows}</p>;
}

/** One-page visit summary preview (also what gets printed). */
export function SummaryView({
  content,
  timezone,
}: {
  content: VisitSummaryContent;
  timezone: string;
}) {
  const h = content.header;
  return (
    <div
      className="space-y-4 rounded-xl border border-line bg-surface p-5 text-sm print:border-0 print:p-0"
      data-testid="summary-view"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <div>
          <h2 className="text-xl font-bold">{h.patient_name}</h2>
          <p>{summaryCopy.header.age(h.age)}</p>
        </div>
        <div className="text-right text-ink-muted">
          <p>
            {summaryCopy.header.period}: {h.period_label}
          </p>
          <p>
            {summaryCopy.header.generated}: {formatDateTime(h.generated_at, timezone)} ·{' '}
            {summaryCopy.header.by}: {h.generated_by}
          </p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title={summaryCopy.sections.changes} more={content.medication_changes.more}>
          {content.medication_changes.rows.length ? (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={head}>{summaryCopy.cols.date}</th>
                  <th className={head}>{summaryCopy.cols.medicine}</th>
                  <th className={head}>{summaryCopy.cols.change}</th>
                  <th className={head}>{summaryCopy.cols.detail}</th>
                </tr>
              </thead>
              <tbody>
                {content.medication_changes.rows.map((r, i) => (
                  <tr key={i}>
                    <td className={cell}>{formatDate(r.date)}</td>
                    <td className={cell}>{r.medication}</td>
                    <td className={cell}>{r.change}</td>
                    <td className={cell}>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty />
          )}
        </Section>

        <Section title={summaryCopy.sections.current} more={content.current_medications.more}>
          {content.current_medications.rows.length ? (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={head}>{summaryCopy.cols.medicine}</th>
                  <th className={head}>{summaryCopy.cols.dose}</th>
                  <th className={head}>{summaryCopy.cols.schedule}</th>
                </tr>
              </thead>
              <tbody>
                {content.current_medications.rows.map((r, i) => (
                  <tr key={i}>
                    <td className={cell}>
                      {r.name}
                      {r.drug_class ? (
                        <span className="block text-xs text-ink-muted">{r.drug_class}</span>
                      ) : null}
                    </td>
                    <td className={cell}>{r.dose}</td>
                    <td className={cell}>{r.schedule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty />
          )}
        </Section>

        <Section title={summaryCopy.sections.adherence} more={content.adherence.by_medication.more}>
          <p className="font-semibold">
            {summaryCopy.overall(
              formatPercent(content.adherence.overall.rate),
              content.adherence.overall.given,
              content.adherence.overall.total,
            )}
          </p>
          {content.adherence.by_medication.rows.length ? (
            <ul className="mt-1 space-y-0.5">
              {content.adherence.by_medication.rows.map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{r.medication}</span>
                  <span>
                    {formatPercent(r.rate)} ({r.given}/{r.total})
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title={summaryCopy.sections.symptoms} more={content.symptoms.more}>
          {content.symptoms.rows.length ? (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={head}>{summaryCopy.cols.symptom}</th>
                  <th className={head}>{summaryCopy.cols.firstSeen}</th>
                  <th className={head}>{summaryCopy.cols.days}</th>
                  <th className={head}>{summaryCopy.cols.worst}</th>
                  <th className={head}>{summaryCopy.cols.trend}</th>
                </tr>
              </thead>
              <tbody>
                {content.symptoms.rows.map((r) => (
                  <tr key={r.code}>
                    <td className={cell}>{r.symptom}</td>
                    <td className={cell}>{formatDate(r.first_seen)}</td>
                    <td className={cell}>{r.days_reported}</td>
                    <td className={cell}>{summaryCopy.severityWords[r.max_severity]}</td>
                    <td className={cell}>{summaryCopy.trend[r.trajectory]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty />
          )}
        </Section>
      </div>

      <Section title={summaryCopy.sections.flags} more={content.flags.more}>
        {content.flags.rows.length ? (
          <ul className="space-y-1">
            {content.flags.rows.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={f.severity} />
                <span className="font-semibold">{f.title}</span>
                <span className="text-ink-muted">
                  {flagCopy.status[f.status]} · {formatDate(f.created)}
                </span>
                {f.reviewer_note ? (
                  <span className="w-full pl-2 text-ink-muted">{`“${f.reviewer_note}”`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title={summaryCopy.sections.questions} more={content.questions.more}>
        {content.questions.rows.length ? (
          <ol className="list-decimal space-y-0.5 pl-5">
            {content.questions.rows.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        ) : (
          <Empty />
        )}
      </Section>

      <footer
        className="border-t border-line pt-2 text-xs text-ink-muted"
        data-testid="summary-footer"
      >
        {content.footer}
      </footer>
    </div>
  );
}
