import { Link, useLocation } from "wouter"
import { ProviderStatusIndicator } from "./ProviderStatusIndicator"
import { ActivitySquare, History, PlaySquare } from "lucide-react"

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tighter text-lg">
              <div className="w-6 h-6 bg-accent rounded-sm flex items-center justify-center text-accent-foreground">
                <ActivitySquare className="w-4 h-4" />
              </div>
              TENNIS<span className="text-muted-foreground">QUANT</span>
            </Link>
            
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              <Link 
                href="/" 
                className={`transition-colors hover:text-foreground/80 ${location === "/" ? "text-foreground" : "text-foreground/60"}`}
              >
                Dashboard
              </Link>
              <Link 
                href="/predict" 
                className={`transition-colors hover:text-foreground/80 ${location.startsWith("/predict") && !location.startsWith("/predictions") ? "text-foreground" : "text-foreground/60"}`}
              >
                Run Model
              </Link>
              <Link 
                href="/history" 
                className={`transition-colors hover:text-foreground/80 ${location.startsWith("/history") || location.startsWith("/predictions") ? "text-foreground" : "text-foreground/60"}`}
              >
                Ledger
              </Link>
            </nav>
          </div>

          <div className="flex items-center">
            <ProviderStatusIndicator />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
      
      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-xs font-mono text-muted-foreground">
          <p>TENNIS QUANT PREDICTION ENGINE v1.0.0</p>
          <p className="mt-1 opacity-50">PROBABILITIES CALIBRATED DAILY. USE AT OWN RISK.</p>
        </div>
      </footer>
    </div>
  )
}
