import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-[background-color,color,opacity,transform] duration-[var(--motion-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        solid: "bg-fg text-bg hover:bg-fg/90",
        ghost: "border border-border bg-surface/80 text-fg hover:bg-surface",
        accent: "bg-accent text-accent-fg hover:bg-accent/90",
      },
      pressed: {
        true: "",
        false: "",
      },
    },
    defaultVariants: {
      variant: "ghost",
      pressed: false,
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  pressed,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, pressed }), className)}
      {...props}
    />
  );
}
