import { DemoBanner } from '@/components/ui/DemoBanner';
import { common } from '@/copy/common';

export function App() {
  return (
    <div className="min-h-screen">
      <DemoBanner />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold text-primary">{common.appName}</h1>
      </main>
    </div>
  );
}
