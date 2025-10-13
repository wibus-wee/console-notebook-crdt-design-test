import { cn } from "@/lib/utils";
import { forwardRef } from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "accent" | "outline" | "success" | "warning" | "error";
}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const variantStyles = {
      default:
        "bg-foreground text-background border-transparent",
      secondary:
        "bg-secondary text-secondary-foreground border-transparent",
      accent:
        "bg-accent text-accent-foreground border-transparent",
      outline:
        "border-border bg-transparent",
      success:
        "bg-success/10 text-success border-success/20",
      warning:
        "bg-warning/10 text-warning border-warning/20",
      error:
        "bg-error/10 text-error border-error/20",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
          variantStyles[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

export { Badge };
