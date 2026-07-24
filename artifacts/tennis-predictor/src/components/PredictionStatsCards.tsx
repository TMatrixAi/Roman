import { AlertTriangle, Clock, Target, TrendingUp } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getShortRecommendationLabel } from "@/lib/recommendationLabels"

export interface PredictionStatsSummary {
  totalPredictions: number
  resolvedPredictions: number
  correctPredictions: number
  accuracy: number | null
  byRecommendation?: Array<{ recommendation: string; count: number }>
}

export function PredictionStatCard({ title, value, subtext, icon: Icon }: { title: string; value: string | number; subtext?: string; icon: LucideIcon }) {
  return (
    <Card className="bg-card shadow-sm glass-panel hover-lift">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-3">
            <p className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
            <p className="text-4xl font-display font-bold tracking-tight text-primary tabular-nums">{value}</p>
            {subtext && <p className="text-xs text-muted-foreground/80 font-medium">{subtext}</p>}
          </div>
          <div className="p-3 bg-secondary/50 rounded-xl border border-border/50">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function PredictionStatsCards({ stats, isLoading }: { stats?: PredictionStatsSummary | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}
      </div>
    )
  }

  if (!stats) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <PredictionStatCard title="TOTAL RUNS" value={stats.totalPredictions} icon={Target} />
      <PredictionStatCard title="RESOLVED" value={stats.resolvedPredictions} icon={Clock} />
      <PredictionStatCard title="ACCURACY" value={stats.accuracy !== null ? `${stats.accuracy.toFixed(1)}%` : "--"} subtext={`${stats.correctPredictions} correct`} icon={TrendingUp} />
      <PredictionStatCard
        title={getShortRecommendationLabel("STRONG_RECOMMENDATION")}
        value={stats.byRecommendation?.find((r) => r.recommendation === "STRONG_RECOMMENDATION")?.count || 0}
        subtext="Highest-confidence tier -- not yet proven better than other tiers"
        icon={AlertTriangle}
      />
    </div>
  )
}