import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ApiError } from './api';
import { toast, Toaster, PageLoader } from './components/ui';
import { useMe } from './hooks';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Pipelines from './pages/Pipelines';
import PipelineBoard from './pages/PipelineBoard';
import CallQueue from './pages/CallQueue';
import Import from './pages/Import';
import Tasks from './pages/Tasks';
import Calls from './pages/Calls';
import Settings from './pages/Settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache({
    onError: (err) => toast(err.message, true),
    // Any write may affect several views (counts, boards, timelines) so refresh everything.
    onSuccess: () => queryClient.invalidateQueries(),
  }),
});

function App() {
  const me = useMe();
  if (me.isLoading) return <PageLoader />;
  if (!me.data) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactDetail />} />
        <Route path="pipelines" element={<Pipelines />} />
        <Route path="pipelines/:id" element={<PipelineBoard />} />
        <Route path="dialer" element={<CallQueue />} />
        <Route path="import" element={<Import />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="calls" element={<Calls />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
