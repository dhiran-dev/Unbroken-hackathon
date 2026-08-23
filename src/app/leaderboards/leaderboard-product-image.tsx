"use client";

import Image from "next/image";
import { useState } from "react";

import styles from "./leaderboards.module.css";

export function LeaderboardProductImage({
  slug,
  name,
  hasPublishedImage,
}: {
  slug: string;
  name: string;
  hasPublishedImage: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span className={styles.productImage} aria-hidden="true">
      {hasPublishedImage && !failed ? (
        <Image
          alt=""
          src={`/api/public/product-images/${encodeURIComponent(slug)}`}
          width={44}
          height={44}
          sizes="44px"
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.productFallback}>{initials || "PR"}</span>
      )}
    </span>
  );
}
