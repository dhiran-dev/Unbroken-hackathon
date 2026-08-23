"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import type { PublicProductDto } from "@/server/products/dto";

import styles from "@/app/home.module.css";

export function HomeProductStage({ product }: { product: PublicProductDto }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = product.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return (
    <Link
      className={styles.stageLink}
      href={`/products/${product.slug}`}
      aria-label={`Open ${product.name} product passport`}
    >
      <span className={styles.stageHalo} aria-hidden="true" />
      <span className={styles.stagePlatform} aria-hidden="true">
        <i />
      </span>
      {!imageFailed ? (
        <Image
          className={styles.productImage}
          src={`/api/public/product-images/${encodeURIComponent(product.slug)}`}
          alt={`${product.name} product image`}
          fill
          priority
          sizes="(max-width: 760px) 68vw, 400px"
          unoptimized
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={styles.proceduralCan} aria-label={`${product.name} procedural product artwork`}>
          <span className={styles.canTop} aria-hidden="true" />
          <ZapMark />
          <strong>{initials || "PR"}</strong>
          <small>{product.category.replaceAll("-", " ")}</small>
        </span>
      )}
    </Link>
  );
}

function ZapMark() {
  return (
    <svg className={styles.canBolt} viewBox="0 0 48 84" aria-hidden="true">
      <path d="M29 1 4 48h18l-4 35 26-49H27z" fill="currentColor" />
    </svg>
  );
}
