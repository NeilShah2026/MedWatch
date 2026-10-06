// Loaded on demand (dynamic import) so @react-pdf/renderer stays out of the main bundle.
import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { VisitSummaryContent } from '@medwatch/core';
import { summaryCopy } from '@/copy/summary';
import { flagCopy } from '@/copy/flags';
import { formatDate, formatPercent } from '@/lib/format';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, fontFamily: 'Helvetica', color: '#2B2B2B', lineHeight: 1.35 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E6E1D8',
    paddingBottom: 6,
    marginBottom: 6,
  },
  name: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6B6B6B' },
  h: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: '#2F6F73',
    borderBottomWidth: 1,
    borderBottomColor: '#2F6F73',
    marginTop: 6,
    marginBottom: 3,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E6E1D8',
    paddingVertical: 1.5,
  },
  th: { fontFamily: 'Helvetica-Bold', color: '#6B6B6B' },
  cols: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 28,
    right: 28,
    fontSize: 7.5,
    color: '#6B6B6B',
    borderTopWidth: 0.5,
    borderTopColor: '#E6E1D8',
    paddingTop: 4,
  },
  more: { color: '#6B6B6B', fontSize: 7.5 },
});

function Table({ cols, rows, widths }: { cols: string[]; rows: string[][]; widths: number[] }) {
  return (
    <View>
      <View style={s.row}>
        {cols.map((c, i) => (
          <Text key={c} style={[s.th, { flex: widths[i] }]}>
            {c}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={s.row}>
          {r.map((c, i) => (
            <Text key={i} style={{ flex: widths[i] }}>
              {c}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function More({ n }: { n: number }) {
  return n ? <Text style={s.more}>{summaryCopy.more(n)}</Text> : null;
}

function SummaryDocument({ c }: { c: VisitSummaryContent }) {
  const h = c.header;
  return (
    <Document title={summaryCopy.title} author="MedWatch">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.name}>{h.patient_name}</Text>
            <Text>{summaryCopy.header.age(h.age)}</Text>
          </View>
          <View>
            <Text style={s.muted}>{`${summaryCopy.header.period}: ${h.period_label}`}</Text>
            <Text
              style={s.muted}
            >{`${summaryCopy.header.generated}: ${formatDate(h.generated_at)} · ${summaryCopy.header.by}: ${h.generated_by}`}</Text>
          </View>
        </View>
        <View style={s.cols}>
          <View style={s.col}>
            <Text style={s.h}>{summaryCopy.sections.changes}</Text>
            {c.medication_changes.rows.length ? (
              <Table
                cols={[
                  summaryCopy.cols.date,
                  summaryCopy.cols.medicine,
                  summaryCopy.cols.change,
                  summaryCopy.cols.detail,
                ]}
                widths={[2, 3, 2.5, 2]}
                rows={c.medication_changes.rows.map((r) => [
                  formatDate(r.date),
                  r.medication,
                  r.change,
                  r.detail,
                ])}
              />
            ) : (
              <Text style={s.muted}>{summaryCopy.noRows}</Text>
            )}
            <More n={c.medication_changes.more} />
            <Text style={s.h}>{summaryCopy.sections.current}</Text>
            <Table
              cols={[summaryCopy.cols.medicine, summaryCopy.cols.dose, summaryCopy.cols.schedule]}
              widths={[3.5, 2, 2.5]}
              rows={c.current_medications.rows.map((r) => [r.name, r.dose, r.schedule])}
            />
            <More n={c.current_medications.more} />
          </View>
          <View style={s.col}>
            <Text style={s.h}>{summaryCopy.sections.adherence}</Text>
            <Text>
              {summaryCopy.overall(
                formatPercent(c.adherence.overall.rate),
                c.adherence.overall.given,
                c.adherence.overall.total,
              )}
            </Text>
            <Table
              cols={[summaryCopy.cols.medicine, summaryCopy.cols.rate]}
              widths={[4, 2]}
              rows={c.adherence.by_medication.rows.map((r) => [
                r.medication,
                `${formatPercent(r.rate)} (${r.given}/${r.total})`,
              ])}
            />
            <More n={c.adherence.by_medication.more} />
            <Text style={s.h}>{summaryCopy.sections.symptoms}</Text>
            {c.symptoms.rows.length ? (
              <Table
                cols={[
                  summaryCopy.cols.symptom,
                  summaryCopy.cols.firstSeen,
                  summaryCopy.cols.days,
                  summaryCopy.cols.worst,
                  summaryCopy.cols.trend,
                ]}
                widths={[3, 2.2, 1, 1.6, 1.4]}
                rows={c.symptoms.rows.map((r) => [
                  r.symptom,
                  formatDate(r.first_seen),
                  String(r.days_reported),
                  summaryCopy.severityWords[r.max_severity] ?? '',
                  summaryCopy.trend[r.trajectory],
                ])}
              />
            ) : (
              <Text style={s.muted}>{summaryCopy.noRows}</Text>
            )}
            <More n={c.symptoms.more} />
          </View>
        </View>
        <Text style={s.h}>{summaryCopy.sections.flags}</Text>
        {c.flags.rows.length ? (
          <Table
            cols={[
              summaryCopy.cols.severity,
              summaryCopy.cols.flag,
              summaryCopy.cols.status,
              summaryCopy.cols.note,
            ]}
            widths={[1.2, 5, 1.6, 4]}
            rows={c.flags.rows.map((f) => [
              flagCopy.severity[f.severity],
              f.title,
              flagCopy.status[f.status],
              f.reviewer_note ?? '',
            ])}
          />
        ) : (
          <Text style={s.muted}>{summaryCopy.noRows}</Text>
        )}
        <More n={c.flags.more} />
        <Text style={s.h}>{summaryCopy.sections.questions}</Text>
        {c.questions.rows.length ? (
          c.questions.rows.map((q, i) => <Text key={i}>{`${i + 1}. ${q}`}</Text>)
        ) : (
          <Text style={s.muted}>{summaryCopy.noRows}</Text>
        )}
        <More n={c.questions.more} />
        <Text style={s.footer} fixed>
          {c.footer}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderSummaryPdf(content: VisitSummaryContent): Promise<Blob> {
  return pdf(<SummaryDocument c={content} />).toBlob();
}
