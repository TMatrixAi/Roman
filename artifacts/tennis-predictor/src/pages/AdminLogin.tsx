import { useState } from "react"
import { useLocation } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { getGetAdminAuthStatusQueryKey } from "@workspace/api-client-react"
import { ShieldCheck, LogIn } from "lucide-react"

export default function AdminLoginPage() {
  const [accessKey, setAccessKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [, navigate] = useLocation()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accessKey.trim()) return
    setLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey: accessKey.trim() }),
        credentials: "include",
      })
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: getGetAdminAuthStatusQueryKey() })
        toast({ title: "✅ Logged in as owner" })
        navigate("/")
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Access denied", description: data?.error ?? "Incorrect access key.", variant: "destructive" })
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-sm shadow-xl glass-panel">
        <CardHeader className="border-b border-border/50 bg-secondary/20 p-6">
          <CardTitle className="text-lg font-display flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Owner Login
          </CardTitle>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Enter your ADMIN_ACCESS_KEY to unlock owner features.
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">
                Access Key
              </Label>
              <Input
                type="password"
                placeholder="Enter access key"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                autoFocus
                required
              />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={loading || !accessKey.trim()}>
              {loading ? (
                <span className="font-mono text-xs">Verifying…</span>
              ) : (
                <><LogIn className="w-4 h-4" /> Log In</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
