import { AlertCircle, AlertTriangle } from "lucide-react"

export function DataWarning({ 
  reliability, 
  warnings = [], 
  note 
}: { 
  reliability: number
  warnings?: string[]
  note?: string | null
}) {
  if (reliability >= 80 && !warnings.length && !note) return null

  return (
    <div className="mt-3 p-3 bg-secondary rounded-sm border border-secondary-border flex gap-3 text-sm">
      {reliability < 50 ? (
        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      )}
      <div className="space-y-1">
        {reliability < 80 && (
          <p className="font-mono text-xs text-muted-foreground">
            DATA RELIABILITY: {reliability}%
          </p>
        )}
        {note && <p className="text-secondary-foreground/80">{note}</p>}
        {warnings.map((w, i) => (
          <p key={i} className="text-secondary-foreground/80">{w}</p>
        ))}
      </div>
    </div>
  )
}

export function EmptyDataState({ message, icon: Icon = AlertCircle }: { message: string, icon?: any }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center border border-dashed border-border rounded-lg bg-secondary/50">
      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{message}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">
        The data provider is not currently supplying this information. Check provider status or try again later.
      </p>
    </div>
  )
}
