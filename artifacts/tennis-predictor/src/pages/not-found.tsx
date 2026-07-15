import { Card, CardContent } from '@/components/ui/card';
import { ActivitySquare } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
      <Card className="w-full max-w-md mx-auto shadow-xl glass-panel relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-destructive/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
        <CardContent className="p-8 sm:p-12 text-center relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 rounded-2xl bg-secondary/50 flex items-center justify-center mb-6 border border-border/50 shadow-sm relative">
            <div className="absolute inset-0 border-2 border-dashed border-muted-foreground/30 rounded-2xl animate-[spin_10s_linear_infinite]" />
            <ActivitySquare className="h-10 w-10 text-muted-foreground" />
          </div>
          
          <h1 className="text-4xl font-display font-bold text-foreground mb-2">
            404
          </h1>
          <h2 className="text-xl font-bold font-display text-muted-foreground mb-4">
            Route Not Found
          </h2>

          <p className="text-sm text-muted-foreground/80 font-medium mb-8 leading-relaxed">
            The prediction engine couldn't resolve this trajectory. The page you're looking for doesn't exist or has been moved.
          </p>

          <Link href="/" className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 hover:-translate-y-0.5 font-mono">
            RETURN TO DASHBOARD
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
