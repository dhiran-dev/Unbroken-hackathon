"use client";

import { PublishedProductImage } from "@/components/pulserank/product-image";

import styles from "./leaderboards.module.css";

export function LeaderboardProductImage({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span className={styles.productImage} aria-hidden="true">
      <PublishedProductImage
        alt=""
        fallback={(
          <span className={styles.productFallback}>{initials || "PR"}</span>
        )}
        height={44}
        name={name}
        sizes="44px"
        slug={slug}
        width={44}
      />
    </span>
  );
}
