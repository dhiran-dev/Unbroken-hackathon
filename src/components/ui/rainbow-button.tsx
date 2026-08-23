"use client";

import React, {
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";

import { cn } from "@/lib/utils";
import { useMotionVisibility } from "@/components/ui/use-motion-visibility";

export interface RainbowButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  animationDuration?: string;
}

export const RainbowButton = React.forwardRef<
  HTMLButtonElement,
  RainbowButtonProps
>(
  (
    {
      animationDuration = "2.4s",
      className,
      children,
      style,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const motionRef = useMotionVisibility(ref);
    return (
      <button
        className={cn("magic-rainbow-button", className)}
        ref={motionRef}
        style={{
          "--rainbow-speed": animationDuration,
          ...style,
        } as CSSProperties}
        type={type}
        {...props}
      >
        <span className="magic-rainbow-button__content">{children}</span>
      </button>
    );
  },
);

RainbowButton.displayName = "RainbowButton";
