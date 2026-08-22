"use client";

import { useEffect, useRef, useState } from "react";
import type * as Three from "three";

import { StageFallback } from "./stage-fallback";
import {
  STAGE_ASSET,
  STAGE_VARIANTS,
  type VisualStageProps,
} from "./stage-config";

type StageState = "loading" | "ready" | "fallback";

/**
 * Decorative, client-only image stage. It intentionally owns no application
 * data: route content and metrics stay in the server-rendered HTML.
 */
export function VisualStageClient({
  variant,
  className,
  compact = false,
}: VisualStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<StageState>("loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (canvas === null || host == null) return;

    let cancelled = false;
    let frameId = 0;
    let renderer: Three.WebGLRenderer | null = null;
    let texture: Three.Texture | null = null;
    let geometries: Three.BufferGeometry[] = [];
    let materials: Three.Material[] = [];
    let visible = !document.hidden;
    let removeListeners = () => {};

    const dispose = () => {
      if (frameId !== 0) cancelAnimationFrame(frameId);
      removeListeners();
      removeListeners = () => {};
      renderer?.dispose();
      renderer?.forceContextLoss();
      texture?.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer = null;
      texture = null;
      geometries = [];
      materials = [];
    };

    const fallback = () => {
      if (!cancelled) setState("fallback");
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      return dispose;
    }

    const start = async () => {
      try {
        const THREE = await import("three");
        if (cancelled) return;

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          canvas,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
        camera.position.z = 6.2;

        const config = STAGE_VARIANTS[variant];
        const root = new THREE.Group();
        root.rotation.z = config.rotation;
        scene.add(root);

        const loadedTexture = await new Promise<Three.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(STAGE_ASSET, resolve, undefined, reject);
        });
        if (cancelled) {
          loadedTexture.dispose();
          return;
        }
        texture = loadedTexture;
        texture.colorSpace = THREE.SRGBColorSpace;

        const planeGeometry = new THREE.PlaneGeometry(
          3.65 * config.planeScale,
          3.65 * config.planeScale,
        );
        geometries.push(planeGeometry);

        const backMaterial = new THREE.MeshBasicMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: texture,
          opacity: config.opacity * 0.62,
          transparent: true,
        });
        const backPlane = new THREE.Mesh(planeGeometry, backMaterial);
        backPlane.position.z = -0.45;
        backPlane.rotation.y = -0.18;
        root.add(backPlane);
        materials.push(backMaterial);

        const frontMaterial = new THREE.MeshBasicMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: texture,
          opacity: config.opacity,
          transparent: true,
        });
        const frontPlane = new THREE.Mesh(planeGeometry, frontMaterial);
        frontPlane.position.z = 0.22;
        frontPlane.position.x = 0.18;
        frontPlane.rotation.y = 0.14;
        root.add(frontPlane);
        materials.push(frontMaterial);

        const ringGeometry = new THREE.RingGeometry(1.48, 1.51, 128);
        const ringMaterial = new THREE.MeshBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: config.tint,
          depthWrite: false,
          opacity: 0.42,
          side: THREE.DoubleSide,
          transparent: true,
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.z = 0.42;
        ring.rotation.x = 0.17;
        root.add(ring);
        geometries.push(ringGeometry);
        materials.push(ringMaterial);

        const innerRingGeometry = new THREE.RingGeometry(0.76, 0.77, 96);
        const innerRingMaterial = new THREE.MeshBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: 0x22d3ee,
          depthWrite: false,
          opacity: 0.26,
          side: THREE.DoubleSide,
          transparent: true,
        });
        const innerRing = new THREE.Mesh(innerRingGeometry, innerRingMaterial);
        innerRing.position.z = 0.48;
        innerRing.rotation.x = -0.12;
        root.add(innerRing);
        geometries.push(innerRingGeometry);
        materials.push(innerRingMaterial);

        const resize = () => {
          if (renderer === null) return;
          const width = Math.max(host.clientWidth, 1);
          const height = Math.max(host.clientHeight, 1);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };

        const render = (now: number) => {
          frameId = 0;
          if (cancelled || !visible || renderer === null) return;
          const elapsed = now * 0.001;
          root.rotation.y = Math.sin(elapsed * config.speed) * 0.16;
          root.rotation.x = Math.cos(elapsed * config.speed * 0.72) * 0.045;
          frontPlane.position.y = Math.sin(elapsed * config.speed * 1.45) * 0.05;
          ring.rotation.z = elapsed * config.speed * 0.5;
          innerRing.rotation.z = -elapsed * config.speed * 0.8;
          renderer.render(scene, camera);
          frameId = requestAnimationFrame(render);
        };

        const startFrame = () => {
          if (!visible || frameId !== 0 || cancelled) return;
          frameId = requestAnimationFrame(render);
        };

        const onVisibilityChange = () => {
          visible = !document.hidden;
          if (!visible && frameId !== 0) {
            cancelAnimationFrame(frameId);
            frameId = 0;
          }
          if (visible) startFrame();
        };

        resize();
        window.addEventListener("resize", resize, { passive: true });
        document.addEventListener("visibilitychange", onVisibilityChange);
        removeListeners = () => {
          window.removeEventListener("resize", resize);
          document.removeEventListener("visibilitychange", onVisibilityChange);
        };
        if (!cancelled) setState("ready");
        startFrame();
      } catch {
        fallback();
        dispose();
      }
    };

    void start();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [variant]);

  return (
    <div
      className={`pr-visual-stage pr-visual-stage-${variant}${compact ? " is-compact" : ""}${className ? ` ${className}` : ""} state-${state}`}
      data-pulserank-3d-stage={variant}
      aria-hidden="true"
    >
      <StageFallback variant={variant} />
      <canvas ref={canvasRef} className="pr-visual-stage-canvas" />
    </div>
  );
}
