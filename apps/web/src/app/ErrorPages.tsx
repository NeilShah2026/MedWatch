import { Link } from 'react-router-dom';
import { common } from '@/copy/common';
import { envProblems } from '@/lib/env';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-bold">{common.notFoundTitle}</h1>
      <p className="mt-2 text-ink-muted">{common.notFoundBody}</p>
      <Link className="mt-4 inline-block font-semibold text-primary underline" to="/">
        {common.goHome}
      </Link>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-xl p-8 text-center" data-testid="forbidden">
      <h1 className="text-2xl font-bold">{common.forbiddenTitle}</h1>
      <p className="mt-2 text-ink-muted">{common.forbiddenBody}</p>
      <Link className="mt-4 inline-block font-semibold text-primary underline" to="/">
        {common.goHome}
      </Link>
    </div>
  );
}

export function ConfigErrorPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">{common.configErrorTitle}</h1>
      <p className="mt-2">{common.configErrorBody}</p>
      <ul className="mt-3 list-disc pl-6 font-mono">
        {envProblems.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>
    </main>
  );
}
