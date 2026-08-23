"use client";

import { useState } from "react";

import { GlassObject } from "./glass-object";
import styles from "../prototype.module.css";

export function CaffeineSugarGlass({
  caffeine,
  sugar,
}: {
  caffeine: string;
  sugar: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      aria-label={`Observed values: ${caffeine} caffeine and ${sugar} sugar in one published serving`}
      className={styles.glassInstrument}
      role="img"
    >
      <div aria-hidden="true" className={styles.glassAura} />
      <div aria-hidden="true" className={styles.glassShapeBase} />
      {!failed ? (
        <GlassObject
          autoRotate={false}
          cameraDistance={5.2}
          className={styles.glassObject}
          clearcoat={0.78}
          depth={0.12}
          dispersion={1.35}
          environmentIntensity={1.15}
          floatIntensity={0.18}
          floatSpeed={0.58}
          fov={42}
          highlight="#c278ff"
          ior={1.78}
          onError={() => setFailed(true)}
          orbit={false}
          rotationIntensity={0.18}
          roughness={0.13}
          scale={3.15}
          src="/prototypes/product-passport-glass/bottle-vessel.svg"
          thickness={3.6}
          tint="#a95cff"
          tintDensity={1.1}
          yOffset={-0.05}
          zoom={false}
        />
      ) : (
        <div aria-hidden="true" className={styles.glassFallback} />
      )}
      <div className={styles.glassLegend}>
        <p>Observed inside this serving</p>
        <div>
          <span>Caffeine</span>
          <strong>{caffeine}</strong>
        </div>
        <div>
          <span>Sugar</span>
          <strong>{sugar}</strong>
        </div>
        <small>Independent published values · no target scale</small>
      </div>
    </div>
  );
}
