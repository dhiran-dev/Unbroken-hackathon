import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(className)}>{children}</div>;
}

export function BentoGridItem({
  className,
  description,
  header,
  icon,
  title,
}: {
  className?: string;
  description: ReactNode;
  header?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <article className={cn(className)} data-bento-item>
      {header}
      <div data-bento-copy>
        {icon}
        <h3>{title}</h3>
        <div>{description}</div>
      </div>
    </article>
  );
}
