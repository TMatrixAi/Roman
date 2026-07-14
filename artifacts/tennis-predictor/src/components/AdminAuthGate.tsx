import { useState, type FormEvent, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetAdminAuthStatus,
  useAdminLogin,
  getGetAdminAuthStatusQueryKey,
} from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Lock } from "lucide-react"

/**
 * Task #143: single-owner login gate. Read-only browsing doesn't need this -- the server leaves
 * GET routes open -- but every data-changing/job-triggering route requires the signed session
 * cookie this sets. Gating the whole SPA behind one login means the owner authenticates once per
 * browser (cookie lasts 30 days) and never sees friction again, while a stranger who finds the
 * URL can't reach the write actions at all.
 */
export function AdminAuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useGetAdminAuthStatus()
  const [accessKey, setAccessKey] = useState("")
  const [error, setError] = useState<string | null>(null)

  const login = useAdminLogin({
    mutation: {
      onSuccess: () => {
        setError(null)
        queryClient.invalidateQueries({ queryKey: getGetAdminAuthStatusQueryKey() })
      },
      onError: () => {
        setError("Incorrect access key.")
      },
    },
  })

  if (isLoading) {
    return null
  }

  if (status?.authenticated) {
    return <>{children}</>
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!accessKey.trim()) return
    login.mutate({ data: { accessKey } })
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2">
          <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center text-accent-foreground">
            <Lock className="w-5 h-5" />
          </div>
          <CardTitle>Owner access required</CardTitle>
          <CardDescription>Enter the access key to use Tennis Quant.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-access-key">Access key</Label>
              <Input
                id="admin-access-key"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={login.isPending || !accessKey.trim()}>
              {login.isPending ? "Checking…" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
