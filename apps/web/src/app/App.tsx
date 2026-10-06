import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { envProblems } from '@/lib/env';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from './AuthProvider';
import { ConfigErrorPage } from './ErrorPages';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

export function App() {
  if (envProblems.length) return <ConfigErrorPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
