import { useState } from "react"
import { Link, useLocation } from "wouter"
import { useTheme } from "next-themes"
import { ProviderStatusIndicator } from "./ProviderStatusIndicator"
import { ActivitySquare, History, PlaySquare, ClipboardList, LineChart, Menu, X, LayoutDashboard, Moon, Sun } from "lucide-react"

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/predict", label: "Run Model", icon: PlaySquare, exact: false },
  { href: "/history", label: "Ledger", icon: History, exact: false },
  { href: "/evaluation/log", label: "Prediction Log", icon: ClipboardList, exact: false },
  { href: "/evaluation/dashboard", label: "Accuracy", icon: LineChart, exact: false },
]

function isActive(href: string, location: string, exact: boolean) {
  if (exact) return location === href
  if (href === "/history") return location.startsWith("/history") || location.startsWith("/predictions")
  if (href === "/predict") return location.startsWith("/predict") && !location.startsWith("/predictions")
  return location.startsWith(href)
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  return (
    <button
      className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans overflow-x-hidden selection:bg-primary/20 selection:text-primary">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none z-[-1] bg-[radial-gradient(ellipse_80%_50%_at_top_right,_hsl(var(--primary)/0.06),_transparent)]" />

      {/* ─── Top header ─────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 shadow-sm">
        <div className="app-container min-h-[3.75rem] py-2.5 flex items-center justify-between gap-3">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 font-display font-bold tracking-tight text-[1.05rem] hover:opacity-80 transition-opacity shrink-0">
            <div className="w-7 h-7 bg-gradient-to-br from-accent to-accent/80 rounded-lg shadow-inner flex items-center justify-center text-accent-foreground">
              <ActivitySquare className="w-4 h-4" />
            </div>
            <span>TENNIS<span className="text-muted-foreground font-medium">QUANT</span></span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-[0.8125rem] font-medium">
            {NAV_LINKS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, location, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative py-1 flex items-center gap-1.5 transition-all hover:text-primary ${active ? "text-primary" : "text-muted-foreground"}`}
                >
                  {label}
                  {active && <span className="absolute -bottom-[0.65rem] left-0 w-full h-[2px] bg-primary rounded-t-full" />}
                </Link>
              )
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-1">
            <ProviderStatusIndicator />
            <ThemeToggle />
            {/* Mobile menu toggle */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile slide-down nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl">
            <nav className="app-container py-3 flex flex-col gap-1">
              {NAV_LINKS.map(({ href, label, icon: Icon, exact }) => {
                const active = isActive(href, location, exact)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${active ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </Link>
                )
              })}
            </nav>
          </div>
        )}
      </header>

      {/* ─── Page content ───────────────────────────────────── */}
      <main className="flex-1 app-container py-8 md:py-10 flex flex-col pb-24 md:pb-10">
        {children}
      </main>

      {/* ─── Mobile bottom tab bar ───────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/90 backdrop-blur-xl mobile-nav-safe">
        <nav className="flex items-stretch">
          {NAV_LINKS.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, location, exact)
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[0.6rem] font-mono font-bold tracking-wider uppercase transition-colors min-h-[3.25rem] ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                <Icon className={`w-4.5 h-4.5 ${active ? "text-primary" : "text-muted-foreground/70"}`} style={{ width: "1.125rem", height: "1.125rem" }} />
                <span className="leading-tight">{label === "Prediction Log" ? "Log" : label === "Dashboard" ? "Home" : label}</span>
                {active && <span className="absolute top-0 w-full max-w-[2.5rem] h-[2px] bg-primary rounded-b-full" />}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* ─── Footer ─────────────────────────────────────────── */}
      <footer className="hidden md:block border-t border-border/40 py-6 bg-secondary/20">
        <div className="app-container text-center text-[0.6875rem] font-mono text-muted-foreground/60 flex flex-col items-center gap-1.5">
          <p className="font-bold tracking-[0.18em] text-muted-foreground/80">TENNIS QUANT PREDICTION ENGINE v1.0.0</p>
          <p className="max-w-md leading-relaxed">PROBABILITIES CALIBRATED DAILY. USE AT OWN RISK. DATA IS FOR ANALYTICAL PURPOSES ONLY.</p>
        </div>
      </footer>
    </div>
  )
}
