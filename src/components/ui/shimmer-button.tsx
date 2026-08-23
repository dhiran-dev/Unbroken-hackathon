"use client";

import React, {
  type ComponentPropsWithoutRef,
  type CSSProperties,
} from "react";

import { cn } from "@/lib/utils";
import { useMotionVisibility } from "@/components/ui/use-motion-visibility";

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<"button"> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
}

export const ShimmerButton = React.forwardRef<
  HTMLButtonElement,
  ShimmerButtonProps
>(
  (
    {
      shimmerColor = "#ffffff",
      shimmerSize = "1px",
      shimmerDuration = "3s",
      borderRadius = "100px",
      background = "#0b0916",
      className,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const motionRef = useMotionVisibility(ref);
    const customProperties = {
      "--shimmer-color": shimmerColor,
      "--shimmer-radius": borderRadius,
      "--shimmer-speed": shimmerDuration,
      "--shimmer-cut": shimmerSize,
      "--shimmer-background": background,
    } as CSSProperties;

    return (
      <button
        className={cn("magic-shimmer-button", className)}
        ref={motionRef}
        style={customProperties}
        type={type}
        {...props}
      >
        <span aria-hidden="true" className="magic-shimmer-button__spark" />
        <span aria-hidden="true" className="magic-shimmer-button__backdrop" />
        <span aria-hidden="true" className="magic-shimmer-button__highlight" />
        <span className="magic-shimmer-button__content">{children}</span>
      </button>
    );
  },
);

ShimmerButton.displayName = "ShimmerButton";
