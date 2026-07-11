import { useGetPrediction, getGetPredictionQueryKey, useRecordPredictionOutcome } from "@workspace/api-client-react"
import { useParams } from "wouter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataWarning, EmptyDataState } from "@/components/DataWarning"
import { formatProbability } from "@/lib/utils"
import { Activity, ShieldAlert, CheckCircle2, XCircle, TrendingUp, AlertTriangle, ChevronRight, Dna, ActivitySquare, Database, Vote, Info } from "lucide-react"

const AGREEMENT_STYLES: Record<string, string> = {
  Strong: "text-success",
  Moderate: "text-foreground",
  Mixed: "text-warning",
  HighDisagreement: "text-destructive",
}

function EdgeBar({ p1Value, p2Value, p1Name, p2Name, label }: { p1Value: number, p2Value: number, p1Name: string, p2Name: string, label: string }) {
  const total = p1Value + p2Value;
  const p1Pct = total > 0 ? (p1Value / total) * 100 : 50;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-mono font-bold">
        <span className="text-primary truncate max-w-[40%]">{p1Name} ({p1Value.toFixed(0)})</span>
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground truncate max-w-[40%] text-right">{p2Name} ({p2Value.toFixed(0)})</span>
      </div>
      <div className="h-3 w-full bg-secondary rounded-full overflow-hidden flex">
        <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${p1Pct}%` }} />
        <div className="h-full bg-muted-foreground/30 transition-all duration-1000" style={{ width: `${100 - p1Pct}%` }} />
      </div>
    </div>
  )
}

function ModuleCard({ title, reliability, children, icon: Icon }: { title: string, reliability: number, children: React.ReactNode, icon: any }) {
  return (
    <Card className="overflow-hidden flex flex-col h-full">
      <div className="bg-secondary/50 p-3 border-b flex justify-between items-center">
        <div className="flex items-center gap-2 font-bold text-sm">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {title}
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="text-muted-foreground">REL:</span>
          <span className={reliability < 50 ? "text-warning" : reliability >= 80 ? "text-success" : "text-foreground"}>
            {reliability}%
          </span>
        </div>
      </div>
      <CardContent className="p-4 flex-1 flex flex-col gap-4">
        {children}
      </CardContent>
    </Card>
  )
}

export default function PredictionResultPage() {
  const params = useParams()
  const id = parseInt(params.id || "0", 10)
  
  const { data: prediction, isLoading, isError } = useGetPrediction(id, {
    query: { queryKey: getGetPredictionQueryKey(id), enabled: !!id }
  })

  const recordOutcome = useRecordPredictionOutcome()

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-32 bg-muted rounded-lg" />
        <div className="h-[600px] bg-muted rounded-lg" />
      </div>
    )
  }

  if (isError || !prediction) {
    return <EmptyDataState message="Prediction not found or provider unavailable." />
  }

  const engine = prediction.engine;
  const isResolved = !!prediction.actualWinnerId;
  const isCorrect = prediction.actualWinnerId === prediction.predictedWinnerId;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto">
      {/* HEADER MATCHUP */}
      <div className="flex flex-col md:flex-row gap-6 items-center justify-between">
        <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground">
          <Badge variant="secondary" className="uppercase">{prediction.surface}</Badge>
          <span className="uppercase">{prediction.matchFormat}</span>
          {prediction.tournamentLevel && <Badge variant="outline" className="uppercase">{prediction.tournamentLevel}</Badge>}
        </div>
        {isResolved && (
          <Badge variant={isCorrect ? "success" : "destructive"} className="text-sm px-3 py-1">
            {isCorrect ? <><CheckCircle2 className="w-4 h-4 mr-1" /> PREDICTION CORRECT</> : <><XCircle className="w-4 h-4 mr-1" /> PREDICTION INCORRECT</>}
          </Badge>
        )}
      </div>

      {/* COMPACT SUMMARY HERO */}
      <Card className="border-2 border-primary/20 overflow-hidden relative">
        <div className="absolute right-0 top-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        
        <CardContent className="p-8 md:p-12">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            
            <div className="space-y-8">
              <div>
                <p className="text-sm font-mono text-muted-foreground mb-2">PREDICTED WINNER</p>
                <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-primary break-words leading-tight">
                  {prediction.predictedWinnerName}
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant={
                    prediction.recommendation === 'STRONG_RECOMMENDATION' ? 'success' :
                    prediction.recommendation === 'MODERATE_LEAN' ? 'secondary' :
                    prediction.recommendation === 'HIGH_RISK' ? 'warning' :
                    prediction.recommendation === 'NO_STRONG_SIGNAL' ? 'outline' : 'destructive'
                  } className="text-sm">
                    {prediction.recommendation.replace(/_/g, ' ')}
                  </Badge>
                  <Badge variant="outline" className="text-sm">
                    SET SCORE: {prediction.predictedSetScore}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between font-mono text-sm">
                  <span>WIN PROBABILITY</span>
                  <span className="font-bold">{formatProbability(prediction.calibratedProbability)}</span>
                </div>
                <Progress value={prediction.calibratedProbability} className="h-3" />
              </div>
            </div>

            <div className="space-y-6 md:pl-8 md:border-l border-border/50">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-secondary/50 rounded-lg">
                  <p className="text-xs font-mono text-muted-foreground mb-1">DATA QUALITY</p>
                  <p className="text-xl font-bold">{prediction.dataQuality}%</p>
                  <p className="text-xs mt-1 text-muted-foreground">{prediction.dataQualityLabel}</p>
                </div>
                <div className="p-4 bg-secondary/50 rounded-lg">
                  <p className="text-xs font-mono text-muted-foreground mb-1">UPSET RISK</p>
                  <p className="text-xl font-bold">{prediction.upsetRisk}</p>
                  <p className="text-xs mt-1 text-muted-foreground">Volatility warning</p>
                </div>
              </div>

              {(engine.risks?.length || engine.reasons?.length) ? (
                <div className="space-y-3">
                  {engine.reasons?.slice(0, 2).map((r, i) => (
                    <div key={i} className="flex gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> <span>{r}</span>
                    </div>
                  ))}
                  {engine.risks?.slice(0, 1).map((r, i) => (
                    <div key={i} className="flex gap-2 text-sm text-muted-foreground">
                      <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" /> <span>{r}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {!isResolved && (
                <div className="pt-4 border-t border-border/50">
                  <p className="text-xs font-mono text-muted-foreground mb-3">RECORD OUTCOME</p>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1 font-mono text-xs"
                      disabled={recordOutcome.isPending}
                      onClick={() => recordOutcome.mutate({ predictionId: id, data: { actualWinnerId: prediction.player1Id } })}
                    >
                      {prediction.player1Name} WON
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1 font-mono text-xs"
                      disabled={recordOutcome.isPending}
                      onClick={() => recordOutcome.mutate({ predictionId: id, data: { actualWinnerId: prediction.player2Id } })}
                    >
                      {prediction.player2Name} WON
                    </Button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </CardContent>
      </Card>

      {/* MODEL VOTES & SEGMENT SPECIALIST (Phase 6) */}
      <div>
        <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
          <Vote className="w-5 h-5" /> MODEL VOTES
        </h3>

        <div className="mb-4 p-4 border border-border bg-secondary/30 rounded-lg flex gap-3 text-sm">
          <Info className="w-5 h-5 shrink-0 mt-0.5 text-muted-foreground" />
          <div className="space-y-1">
            <div>{engine.segmentNote ?? "This prediction predates Phase 6 segment specialists -- no segment data was recorded for it."}</div>
            {engine.segmentLabel && (
              <Badge variant={engine.specialistApplied ? "success" : "outline"} className="font-mono text-[10px]">
                {engine.segmentLabel} {engine.specialistApplied ? "SPECIALIST APPLIED" : "SPECIALIST NOT AVAILABLE"}
              </Badge>
            )}
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">MODEL AGREEMENT</span>
              <span className={`text-sm font-bold font-mono ${(engine.modelAgreement && AGREEMENT_STYLES[engine.modelAgreement]) ?? "text-foreground"}`}>
                {engine.modelAgreement ? engine.modelAgreement.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase() : "—"}
              </span>
            </div>
            <div className="space-y-2">
              {engine.models.map((vote, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 truncate">{vote.modelName}</span>
                  <span className="w-16 text-right font-mono text-muted-foreground">{vote.player1Probability.toFixed(1)}%</span>
                  <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${vote.weightUsed * 100}%` }} />
                  </div>
                  <span className="w-14 text-right font-mono text-xs text-muted-foreground">w={vote.weightUsed.toFixed(2)}</span>
                  <span className="w-14 text-right font-mono text-xs text-muted-foreground">rel={vote.reliability.toFixed(0)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FULL ENGINE BREAKDOWN */}
      <div>
        <h3 className="text-xl font-bold flex items-center gap-2 mb-6">
          <Database className="w-5 h-5" /> FULL ENGINE BREAKDOWN
        </h3>

        {engine.availabilityNote && (
          <div className="mb-3 p-4 border border-warning/30 bg-warning/5 text-warning-foreground rounded-lg flex gap-3 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-warning" />
            <div>{engine.availabilityNote}</div>
          </div>
        )}

        {engine.conditionsNote && (
          <div className="mb-3 p-4 border border-border bg-secondary/30 rounded-lg flex gap-3 text-sm text-muted-foreground">
            <Activity className="w-5 h-5 shrink-0 mt-0.5" />
            <div>{engine.conditionsNote}</div>
          </div>
        )}

        {!!engine.warnings?.length && (
          <div className="mb-6 p-4 border border-warning/30 bg-warning/5 rounded-lg space-y-2">
            {engine.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" /> <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          <ModuleCard title="SURFACE ELO" reliability={engine.surfaceElo.reliability} icon={ActivitySquare}>
            <EdgeBar 
              p1Name={prediction.player1Name} 
              p2Name={prediction.player2Name} 
              p1Value={engine.surfaceElo.player1SurfaceElo} 
              p2Value={engine.surfaceElo.player2SurfaceElo}
              label="RATING"
            />
            <div className="mt-2 text-sm text-muted-foreground flex justify-between font-mono bg-background p-2 rounded">
              <span>WIN PROB (ELO):</span>
              <span className="font-bold text-foreground">{(engine.surfaceElo.eloWinProbabilityPlayer1 * 100).toFixed(1)}%</span>
            </div>
          </ModuleCard>

          <ModuleCard title="SERVE & RETURN" reliability={engine.serveReturn.reliability} icon={TrendingUp}>
            <EdgeBar 
              p1Name={prediction.player1Name} 
              p2Name={prediction.player2Name} 
              p1Value={engine.serveReturn.player1ServeRating} 
              p2Value={engine.serveReturn.player2ServeRating}
              label="SERVE S.P."
            />
            <div className="my-2" />
            <EdgeBar 
              p1Name={prediction.player1Name} 
              p2Name={prediction.player2Name} 
              p1Value={engine.serveReturn.player1ReturnRating} 
              p2Value={engine.serveReturn.player2ReturnRating}
              label="RTN S.P."
            />
            {engine.serveReturn.note && (
               <p className="text-xs text-muted-foreground mt-2 italic">{engine.serveReturn.note}</p>
            )}
          </ModuleCard>

          <ModuleCard title="RECENT FORM" reliability={engine.recentForm.reliability} icon={Activity}>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-background rounded-lg border">
                <p className="text-xs font-mono text-muted-foreground truncate">{prediction.player1Name}</p>
                <p className="text-2xl font-bold my-1">{engine.recentForm.player1Form.toFixed(1)}</p>
                <Badge variant="outline" className="text-[10px]">{engine.recentForm.player1Trend}</Badge>
              </div>
              <div className="text-center p-3 bg-background rounded-lg border">
                <p className="text-xs font-mono text-muted-foreground truncate">{prediction.player2Name}</p>
                <p className="text-2xl font-bold my-1">{engine.recentForm.player2Form.toFixed(1)}</p>
                <Badge variant="outline" className="text-[10px]">{engine.recentForm.player2Trend}</Badge>
              </div>
            </div>
          </ModuleCard>

          <ModuleCard title="FATIGUE INDEX" reliability={engine.fatigue.reliability} icon={Activity}>
            <EdgeBar 
              p1Name={prediction.player1Name} 
              p2Name={prediction.player2Name} 
              p1Value={engine.fatigue.player1FatigueScore} 
              p2Value={engine.fatigue.player2FatigueScore}
              label="FATIGUE"
            />
            <div className="mt-2 text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>{prediction.player1Name} matches (7d):</span>
                <span className="font-mono font-bold text-foreground">{engine.fatigue.player1MatchesLast7Days}</span>
              </div>
              <div className="flex justify-between">
                <span>{prediction.player2Name} matches (7d):</span>
                <span className="font-mono font-bold text-foreground">{engine.fatigue.player2MatchesLast7Days}</span>
              </div>
            </div>
          </ModuleCard>

          <ModuleCard title="HEAD TO HEAD" reliability={engine.headToHead.reliability} icon={Swords}>
             <div className="flex justify-center items-center gap-6 py-4">
                <div className="text-center">
                  <p className="text-4xl font-bold">{engine.headToHead.player1Wins}</p>
                  <p className="text-xs font-mono text-muted-foreground mt-1 truncate w-20">{prediction.player1Name}</p>
                </div>
                <div className="text-muted-foreground font-mono text-sm">VS</div>
                <div className="text-center">
                  <p className="text-4xl font-bold">{engine.headToHead.player2Wins}</p>
                  <p className="text-xs font-mono text-muted-foreground mt-1 truncate w-20">{prediction.player2Name}</p>
                </div>
             </div>
             <div className="text-xs text-center text-muted-foreground border-t pt-2">
                {engine.headToHead.surfaceMeetings} meetings on {prediction.surface}
             </div>
          </ModuleCard>
          
          <ModuleCard title="STYLE MATCHUP" reliability={engine.styleMatchup.reliability} icon={Dna}>
             <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs font-mono font-bold mb-1 truncate text-primary">{prediction.player1Name}</p>
                  <div className="flex flex-wrap gap-1">
                    {engine.styleMatchup.player1Styles.length ? engine.styleMatchup.player1Styles.map(s => <Badge variant="secondary" key={s} className="text-[10px] font-normal">{s}</Badge>) : <span className="text-muted-foreground text-xs italic">Unknown</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-mono font-bold mb-1 truncate text-foreground">{prediction.player2Name}</p>
                  <div className="flex flex-wrap gap-1">
                    {engine.styleMatchup.player2Styles.length ? engine.styleMatchup.player2Styles.map(s => <Badge variant="secondary" key={s} className="text-[10px] font-normal">{s}</Badge>) : <span className="text-muted-foreground text-xs italic">Unknown</span>}
                  </div>
                </div>
             </div>
          </ModuleCard>

        </div>
      </div>
    </div>
  )
}

function Swords(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/></svg>
}
