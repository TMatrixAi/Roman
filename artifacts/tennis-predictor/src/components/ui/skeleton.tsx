import * as React from "react"
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-xl bg-secondary/80 animate-pulse before:absolute before:inset-y-0 before:-left-1/3 before:w-1/3 before:bg-gradient-to-r before:from-transparent before:via-primary/20 before:to-transparent before:animate-[matrix-scanline_6s_ease-in-out_infinite]", className)}
      {...props}
    />
  )
}

export { Skeleton }
