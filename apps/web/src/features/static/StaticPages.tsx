import { staticCopy } from '@/copy/static';

function Doc({
  title,
  intro,
  sections,
  draft,
}: {
  title: string;
  intro?: string;
  sections: { heading: string; body: string }[];
  draft?: boolean;
}) {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      {draft ? (
        <p
          className="rounded-xl border-2 border-severity-medium bg-sev-mediumbg px-4 py-2 font-bold"
          data-testid="draft-banner"
        >
          {staticCopy.draftBanner}
        </p>
      ) : null}
      <h1 className="text-3xl font-bold">{title}</h1>
      {intro ? <p className="text-lg">{intro}</p> : null}
      {sections.map((s) => (
        <section key={s.heading}>
          <h2 className="text-xl font-semibold">{s.heading}</h2>
          <p className="mt-1">{s.body}</p>
        </section>
      ))}
    </article>
  );
}

export const PrivacyPage = () => (
  <Doc draft title={staticCopy.privacy.title} sections={staticCopy.privacy.sections} />
);
export const TermsPage = () => (
  <Doc draft title={staticCopy.terms.title} sections={staticCopy.terms.sections} />
);
export function AboutFlagsPage() {
  return (
    <>
      <Doc
        title={staticCopy.about.title}
        intro={staticCopy.about.intro}
        sections={staticCopy.about.sections}
      />
      <p className="mx-auto mt-6 max-w-3xl text-ink-muted">{staticCopy.about.rulesNote}</p>
    </>
  );
}
