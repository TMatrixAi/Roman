import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Layout } from '@/components/Layout';
import Home from '@/pages/Home';
import PredictBuilderPage from '@/pages/PredictBuilder';
import PredictionResultPage from '@/pages/PredictionResult';
import HistoryPage from '@/pages/History';
import PredictionLogPage from '@/pages/PredictionLog';
import AccuracyDashboardPage from '@/pages/AccuracyDashboard';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/predict" component={PredictBuilderPage} />
        <Route path="/predictions/:id" component={PredictionResultPage} />
        <Route path="/history" component={HistoryPage} />
        <Route path="/evaluation/log" component={PredictionLogPage} />
        <Route path="/evaluation/dashboard" component={AccuracyDashboardPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
