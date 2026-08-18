import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-[var(--control-radius)] border border-input bg-card px-3 text-base shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-55 sm:h-10 sm:text-sm",
        className,
      )}
      type={type}
      {...props}
    />
  );
}
