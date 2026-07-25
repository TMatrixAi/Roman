import { Monitor, Activity } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Subscriber-facing Model Monitoring page — full implementation delivered by the
 * "Build subscriber-facing Model Monitoring Dashboard" task.
 * This stub renders a clean holding page with the correct title and nav entry.
 */
export default function ModelMonitoringPage() {
  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="border-b border-border/50 pb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Monitor className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Model Monitoring</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Live visibility into the health, reliability, calibration, and recent performance of Tennis Matrix AI.
        </p>
      </div>

      <Card className="border-primary/20">
        <CardContent className="p-8 flex flex-col items-center text-center gap-4">
          <div className="p-4 bg-primary/10 rounded-2xl">
            <Activity className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-display mb-2">Dashboard Coming Soon</h2>
            <p className="text-muted-foreground text-sm max-w-md leading-relaxed">
              The full Model Monitoring Dashboard — including accuracy trends, confidence calibration,
              surface performance, model agreement, and data quality — is being prepared and will be
              available here shortly.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
