import { PageHeader } from '@/components/ui/Layout';
// Temporary landing pages for roles whose screens are built in later phases.
export function Placeholder({ title }: { title: string }) {
  return <PageHeader title={title} />;
}
