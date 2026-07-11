import { useGetPredictionStats, useListPredictions, useRecordPredictionOutcome, type PredictionSummary } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate, formatProbability, formatQualityLabel } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Link } from "wouter"
import { Target, CheckCircle2, XCircle, Clock, AlertTriangle, TrendingUp, ChevronRight } from "lucide-react"

function StatCard({ title, value, subtext, icon: Icon }: { title: string, value: string | number, subtext?: string, icon: any }) {
  return (
    <Card className="bg-card">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-xs font-mono text-muted-foreground font-semibold">{title}</p>
            <p className="text-3xl font-bold tracking-tighter">{value}</p>
            {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
          </div>
          <div className="p-2 bg-secondary rounded-md">
            <Icon className="w-5 h-5 text-secondary-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PredictionRow({ prediction }: { prediction: PredictionSummary }) {
  const isResolved = !!prediction.actualWinnerName;
  const isCorrect = prediction.actualWinnerName === prediction.predictedWinnerName;

  const renderRecommendationBadge = () => {
    switch (prediction.recommendation) {
      case 'STRONG_RECOMMENDATION': return <Badge variant="success">STRONG</Badge>
      case 'MODERATE_LEAN': return <Badge variant="secondary">LEAN</Badge>
      case 'HIGH_RISK': return <Badge variant="warning">RISK</Badge>
      case 'DO_NOT_RECOMMEND': return <Badge variant="destructive">NO REC</Badge>
      default: return null
    }
  }

  return (
    <Link href={`/predictions/${prediction.id}`}>
      <div className="group flex flex-col md:flex-row md:items-center justify-between p-4 border rounded-md bg-card hover:border-primary transition-colors cursor-pointer gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span>{formatDate(prediction.createdAt)}</span>
            <span>•</span>
            <span className="uppercase">{prediction.surface}</span>
            {prediction.tournamentName && (
              <>
                <span>•</span>
                <span className="truncate max-w-[150px]">{prediction.tournamentName}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 text-lg font-bold">
            <span className={prediction.predictedWinnerName === prediction.player1Name ? "text-primary" : "text-muted-foreground"}>
              {prediction.player1Name}
            </span>
            <span className="text-sm font-mono font-normal text-muted-foreground">vs</span>
            <span className={prediction.predictedWinnerName === prediction.player2Name ? "text-primary" : "text-muted-foreground"}>
              {prediction.player2Name}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 md:gap-6 md:justify-end border-t md:border-t-0 pt-3 md:pt-0">
          <div className="flex flex-col md:items-end gap-1">
            <div className="text-xs font-mono text-muted-foreground">PREDICTED</div>
            <div className="font-bold flex items-center gap-2">
              {prediction.predictedWinnerName}
              <Badge variant="outline" className="font-mono">{formatProbability(prediction.calibratedProbability)}</Badge>
            </div>
          </div>

          <div className="flex flex-col md:items-end gap-1">
            <div className="text-xs font-mono text-muted-foreground">RECOMMENDATION</div>
            {renderRecommendationBadge()}
          </div>

          <div className="flex flex-col md:items-end gap-1 w-24">
            <div className="text-xs font-mono text-muted-foreground">STATUS</div>
            {isResolved ? (
              isCorrect ? (
                <span className="flex items-center gap-1 text-sm font-bold text-green-600 dark:text-green-500">
                  <CheckCircle2 className="w-4 h-4" /> WON
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm font-bold text-destructive">
                  <XCircle className="w-4 h-4" /> LOST
                </span>
              )
            ) : (
              <span className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
                <Clock className="w-4 h-4" /> PENDING
              </span>
            )}
          </div>

          <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hidden md:block" />
        </div>
      </div>
    </Link>
  )
}

export default function HistoryPage() {
  const { data: stats, isLoading: statsLoading } = useGetPredictionStats()
  const { data: predictions, isLoading: predictionsLoading } = useListPredictions({ limit: 50 })

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter">LEDGER</h1>
        <p className="text-muted-foreground mt-1">Historical prediction performance and raw results.</p>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            title="TOTAL RUNS" 
            value={stats.totalPredictions} 
            icon={Target} 
          />
          <StatCard 
            title="RESOLVED" 
            value={stats.resolvedPredictions} 
            icon={Clock} 
          />
          <StatCard 
            title="ACCURACY" 
            value={stats.accuracy !== null ? `${stats.accuracy.toFixed(1)}%` : '--'} 
            subtext={`${stats.correctPredictions} correct`}
            icon={TrendingUp} 
          />
          <StatCard 
            title="STRONG RECS" 
            value={stats.byRecommendation?.find(r => r.recommendation === 'STRONG_RECOMMENDATION')?.count || 0} 
            icon={AlertTriangle} 
          />
        </div>
      ) : null}

      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          RECENT PREDICTIONS
        </h2>
        
        {predictionsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : predictions && predictions.length > 0 ? (
          <div className="space-y-3">
            {predictions.map(pred => (
              <PredictionRow key={pred.id} prediction={pred} />
            ))}
          </div>
        ) : (
          <div className="p-12 border border-dashed rounded-lg text-center text-muted-foreground">
            <Target className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="font-mono text-sm">NO PREDICTIONS SAVED YET</p>
            <Link href="/predict">
              <Button variant="outline" className="mt-4 font-mono">RUN FIRST PREDICTION</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
