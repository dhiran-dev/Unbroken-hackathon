"use client";

import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

type CanvasProps = {
  className?: string;
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function GlassObject({ className }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
        powerPreference: "high-performance",
      });
    } catch {
      if (wrapperRef.current) wrapperRef.current.dataset.webglReady = "false";
      return;
    }
    if (wrapperRef.current) wrapperRef.current.dataset.webglReady = "true";

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0.06, 5.2);

    const profile = [
      new THREE.Vector2(0.42, -1.2),
      new THREE.Vector2(0.5, -1.1),
      new THREE.Vector2(0.52, 0.58),
      new THREE.Vector2(0.48, 0.76),
      new THREE.Vector2(0.29, 0.96),
      new THREE.Vector2(0.25, 1.25),
      new THREE.Vector2(0.31, 1.3),
    ];
    const geometry = new THREE.LatheGeometry(profile, 64);
    const material = new THREE.MeshPhysicalMaterial({
      attenuationColor: new THREE.Color("#a76bff"),
      attenuationDistance: 1.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.08,
      color: new THREE.Color("#d8c2ff"),
      dispersion: 1.1,
      ior: 1.72,
      metalness: 0,
      roughness: 0.12,
      thickness: 1.8,
      transmission: 1,
      transparent: true,
    });
    const bottle = new THREE.Mesh(geometry, material);
    bottle.rotation.x = -0.06;
    scene.add(bottle);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.29, 0.025, 20, 64),
      new THREE.MeshPhysicalMaterial({
        color: "#f1e9ff",
        roughness: 0.08,
        transmission: 0.7,
      }),
    );
    rim.position.y = 1.3;
    rim.rotation.x = Math.PI / 2;
    scene.add(rim);

    scene.add(new THREE.AmbientLight("#c8b6ec", 1.25));
    const violet = new THREE.PointLight("#a76bff", 15, 12);
    violet.position.set(-2.4, 1.7, 3);
    scene.add(violet);
    const white = new THREE.PointLight("#ffffff", 11, 10);
    white.position.set(2.2, 2.5, 2.4);
    scene.add(white);

    let visible = true;
    let frame = 0;
    let elapsed = 0;

    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const render = (time: number) => {
      if (!visible || reducedMotion) return;
      const delta = elapsed === 0 ? 0 : Math.min((time - elapsed) / 1000, 0.05);
      elapsed = time;
      bottle.rotation.y += delta * 0.12;
      bottle.position.y = Math.sin(time / 1800) * 0.025;
      rim.rotation.z = bottle.rotation.y;
      rim.position.y = 1.3 + bottle.position.y;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    const viewObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      cancelAnimationFrame(frame);
      renderer.render(scene, camera);
      if (visible && !reducedMotion) frame = requestAnimationFrame(render);
    }, { rootMargin: "100px" });
    viewObserver.observe(canvas);

    resize();
    if (!reducedMotion) frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewObserver.disconnect();
      geometry.dispose();
      material.dispose();
      rim.geometry.dispose();
      (rim.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, [reducedMotion]);

  return (
    <div aria-hidden="true" className={className} data-webgl-ready="false" ref={wrapperRef}>
      <span data-glass-fallback />
      <canvas ref={canvasRef} />
    </div>
  );
}

export function LivingGreenAccent({ className }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
    } catch {
      if (wrapperRef.current) wrapperRef.current.dataset.webglReady = "false";
      return;
    }
    if (wrapperRef.current) wrapperRef.current.dataset.webglReady = "true";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 30);
    camera.position.z = 8;

    const count = 90;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 13;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 6;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    const particles = new THREE.BufferGeometry();
    particles.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      color: "#74d18b",
      depthWrite: false,
      opacity: 0.34,
      size: 0.045,
      transparent: true,
    });
    const spores = new THREE.Points(particles, material);
    scene.add(spores);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-6, -1.4, 0),
      new THREE.Vector3(-3, 0.2, -0.8),
      new THREE.Vector3(0, -0.5, 0.2),
      new THREE.Vector3(3, 0.8, -0.6),
      new THREE.Vector3(6, -0.2, 0),
    ]);
    const vineGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(120));
    const vineMaterial = new THREE.LineBasicMaterial({ color: "#6ab47d", opacity: 0.2, transparent: true });
    const vine = new THREE.Line(vineGeometry, vineMaterial);
    scene.add(vine);

    let visible = true;
    let frame = 0;

    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const render = (time: number) => {
      if (!visible || reducedMotion) return;
      spores.rotation.z = Math.sin(time / 7000) * 0.035;
      spores.position.y = Math.sin(time / 2600) * 0.05;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    const viewObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      cancelAnimationFrame(frame);
      renderer.render(scene, camera);
      if (visible && !reducedMotion) frame = requestAnimationFrame(render);
    }, { rootMargin: "120px" });
    viewObserver.observe(canvas);

    resize();
    if (!reducedMotion) frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewObserver.disconnect();
      particles.dispose();
      material.dispose();
      vineGeometry.dispose();
      vineMaterial.dispose();
      renderer.dispose();
    };
  }, [reducedMotion]);

  return (
    <div aria-hidden="true" className={className} data-webgl-ready="false" ref={wrapperRef}>
      <span data-living-fallback />
      <canvas ref={canvasRef} />
    </div>
  );
}

export function SmoothCursor({ className }: CanvasProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const cursor = cursorRef.current;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!cursor || reducedMotion || !fine.matches) return;

    let frame = 0;
    let running = false;
    let x = -50;
    let y = -50;
    let targetX = x;
    let targetY = y;
    const move = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      cursor.dataset.visible = "true";
      if (!running && document.visibilityState === "visible") {
        running = true;
        frame = requestAnimationFrame(render);
      }
    };
    const render = () => {
      x += (targetX - x) * 0.16;
      y += (targetY - y) * 0.16;
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (Math.abs(targetX - x) + Math.abs(targetY - y) < .2) {
        x = targetX;
        y = targetY;
        running = false;
        return;
      }
      frame = requestAnimationFrame(render);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(frame);
        running = false;
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [reducedMotion]);

  if (reducedMotion) return null;
  return <div aria-hidden="true" className={className} ref={cursorRef} />;
}

export function HoverBorderGradient({
  children,
  className,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button className={className} style={style as CSSProperties} type="button" {...props}>
      <span>{children}</span>
    </button>
  );
}

export function LiquidMetalButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button className={className} type="button" {...props}>
      <span aria-hidden="true" data-liquid-metal />
      <span>{children}</span>
    </button>
  );
}
