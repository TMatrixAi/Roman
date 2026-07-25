import { useUser, useClerk } from "@clerk/react"
import { UserCircle, LogOut, Mail, CreditCard, Shield } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')

export default function AccountPage() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()

  if (!isLoaded) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const email = user?.emailAddresses?.[0]?.emailAddress
  const displayName = user?.fullName ?? user?.firstName ?? email?.split("@")[0] ?? "Account"
  const createdAt = user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-2xl mx-auto">
      <div className="border-b border-border/50 pb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg">
            <UserCircle className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Account</h1>
        </div>
        <p className="text-muted-foreground text-lg">Manage your profile and subscription.</p>
      </div>

      {/* Profile */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-mono font-bold text-muted-foreground tracking-widest uppercase">Profile</h2>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              {user?.imageUrl ? (
                <img src={user.imageUrl} alt={displayName} className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <UserCircle className="w-7 h-7 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-lg truncate">{displayName}</p>
              {email && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5 truncate">
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  {email}
                </p>
              )}
              {createdAt && (
                <p className="text-xs font-mono text-muted-foreground/60 mt-1">Member since {createdAt}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Subscription */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-mono font-bold text-muted-foreground tracking-widest uppercase">Subscription</h2>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Current plan</p>
                <p className="text-sm text-muted-foreground">Manage billing and upgrades</p>
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs shrink-0">Active</Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="font-mono w-full sm:w-auto"
            onClick={() => window.location.href = `${basePath}/payments/billing`}
          >
            <CreditCard className="w-4 h-4 mr-2" />
            Manage Billing
          </Button>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-mono font-bold text-muted-foreground tracking-widest uppercase">Security</h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 shrink-0" />
            <span>Authentication managed securely via Clerk.</span>
          </div>
        </CardContent>
      </Card>

      {/* Sign out */}
      <div className="pt-2">
        <Button
          variant="outline"
          className="font-mono text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50 w-full sm:w-auto"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  )
}
