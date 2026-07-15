import { Link, useLocation } from "wouter"
import { ProviderStatusIndicator } from "./ProviderStatusIndicator"
import { ActivitySquare, History, PlaySquare, ClipboardList, LineChart } from "lucide-react"

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans overflow-x-hidden selection:bg-primary/20 selection:text-primary">
      <div className="fixed inset-0 pointer-events-none z-[-1] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background" />
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 shadow-sm">
        <div className="app-container min-h-16 py-3 flex flex-wrap items-center justify-between gap-y-1.5 gap-x-3">
          <div className="flex items-center gap-4 sm:gap-8 min-w-0">
            <Link href="/" className="flex items-center gap-2 font-display font-bold tracking-tight text-xl hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-gradient-to-br from-accent to-accent/80 rounded-lg shadow-inner flex items-center justify-center text-accent-foreground">
                <ActivitySquare className="w-5 h-5" />
              </div>
              TENNIS<span className="text-muted-foreground font-medium">QUANT</span>
            </Link>
            
            <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
              <Link 
                href="/" 
                className={`transition-all hover:text-primary relative py-1 ${location === "/" ? "text-primary" : "text-muted-foreground"}`}
              >
                Dashboard
                {location === "/" && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full" />}
              </Link>
              <Link 
                href="/predict" 
                className={`transition-all hover:text-primary relative py-1 ${location.startsWith("/predict") && !location.startsWith("/predictions") ? "text-primary" : "text-muted-foreground"}`}
              >
                Run Model
                {(location.startsWith("/predict") && !location.startsWith("/predictions")) && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full" />}
              </Link>
              <Link 
                href="/history" 
                className={`transition-all hover:text-primary relative py-1 ${location.startsWith("/history") || location.startsWith("/predictions") ? "text-primary" : "text-muted-foreground"}`}
              >
                Ledger
                {(location.startsWith("/history") || location.startsWith("/predictions")) && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full" />}
              </Link>
              <Link 
                href="/evaluation/log" 
                className={`transition-all hover:text-primary flex items-center gap-1.5 relative py-1 ${location.startsWith("/evaluation/log") ? "text-primary" : "text-muted-foreground"}`}
              >
                <ClipboardList className="w-4 h-4" /> Prediction Log
                {location.startsWith("/evaluation/log") && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full" />}
              </Link>
              <Link 
                href="/evaluation/dashboard" 
                className={`transition-all hover:text-primary flex items-center gap-1.5 relative py-1 ${location.startsWith("/evaluation/dashboard") ? "text-primary" : "text-muted-foreground"}`}
              >
                <LineChart className="w-4 h-4" /> Accuracy
                {location.startsWith("/evaluation/dashboard") && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full" />}
              </Link>
            </nav>
          </div>

          <div className="flex items-center">
            <ProviderStatusIndicator />
          </div>
        </div>
      </header>

      <main className="flex-1 app-container py-10 flex flex-col">
        {children}
      </main>
      
      <footer className="border-t border-border/40 py-8 mt-12 bg-secondary/30">
        <div className="app-container text-center text-xs font-mono text-muted-foreground flex flex-col items-center justify-center gap-2">
          <p className="font-bold tracking-widest">TENNIS QUANT PREDICTION ENGINE v1.0.0</p>
          <p className="opacity-60 max-w-md leading-relaxed">PROBABILITIES CALIBRATED DAILY. USE AT OWN RISK. DATA IS FOR ANALYTICAL PURPOSES ONLY.</p>
        </div>
      </footer>
    </div>
  )
}
