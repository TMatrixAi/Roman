import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Layout } from '@/components/Layout';
import { AdminAuthGate } from '@/components/AdminAuthGate';
import Home from '@/pages/Home';
import PredictBuilderPage from '@/pages/PredictBuilder';
import HistoryPage from '@/pages/History';
import PredictionLogPage from '@/pages/PredictionLog';

// Lazy-loaded because they pull in recharts (a large charting library) -- keeping them out of
// the main bundle means the home/predict-builder flow (the common path) doesn't pay for a chart
// library it never renders.
const PredictionResultView = lazy(() => import('@/pages/PredictionResultView'));
const AccuracyDashboardPage = lazy(() => import('@/pages/AccuracyDashboard'));

const queryClient = new QueryClient();

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/predict" component={PredictBuilderPage} />
          <Route path="/predictions/:id" component={PredictionResultView} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/evaluation/log" component={PredictionLogPage} />
          <Route path="/evaluation/dashboard" component={AccuracyDashboardPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AdminAuthGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </AdminAuthGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
