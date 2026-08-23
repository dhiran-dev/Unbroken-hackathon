"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Prototype-local Canvas UI GlassObject adapter.
 *
 * The owner supplied the standalone Canvas UI component. This focused copy keeps
 * its physical-glass material, studio environment, SVG extrusion, motion and
 * lifecycle behavior. The Product Passport only needs the documented SVG path.
 */
export interface GlassObjectOptions {
  src?: string;
  ior?: number;
  thickness?: number;
  roughness?: number;
  dispersion?: number;
  clearcoat?: number;
  tint?: string;
  tintDensity?: number;
  depth?: number;
  bevel?: number;
  highlight?: string;
  environmentIntensity?: number;
  background?: string;
  scale?: number;
  xOffset?: number;
  yOffset?: number;
  floatIntensity?: number;
  rotationIntensity?: number;
  floatSpeed?: number;
  orbit?: boolean;
  zoom?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  fov?: number;
  cameraDistance?: number;
  onLoad?: (() => void) | null;
  onError?: ((error: unknown) => void) | null;
}

export interface GlassObjectProps extends GlassObjectOptions {
  className?: string;
  style?: CSSProperties;
}

const DEFAULTS: Required<GlassObjectOptions> = {
  src: "",
  ior: 1.75,
  thickness: 4,
  roughness: 0.25,
  dispersion: 1.5,
  clearcoat: 0.5,
  tint: "",
  tintDensity: 2,
  depth: 0.1,
  bevel: 1,
  highlight: "#066aff",
  environmentIntensity: 1,
  background: "",
  scale: 3,
  xOffset: 0,
  yOffset: 0,
  floatIntensity: 1,
  rotationIntensity: 1,
  floatSpeed: 2,
  orbit: true,
  zoom: false,
  autoRotate: false,
  autoRotateSpeed: 2,
  fov: 55,
  cameraDistance: 4,
  onLoad: null,
  onError: null,
};

const CAMERA_DIRECTION = new THREE.Vector3(0, -1, 4).normalize();

function disposeObject(root: THREE.Object3D, keep?: THREE.Material) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || material === keep) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function flattenCapNormals(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  for (const group of geometry.groups) {
    if (group.materialIndex !== 0) continue;
    for (let index = group.start; index < group.start + group.count; index += 3) {
      a.fromBufferAttribute(position, index);
      b.fromBufferAttribute(position, index + 1);
      c.fromBufferAttribute(position, index + 2);
      cb.subVectors(c, b);
      ab.subVectors(a, b);
      cb.cross(ab).normalize();
      for (let offset = 0; offset < 3; offset += 1) {
        normal.setXYZ(index + offset, cb.x, cb.y, cb.z);
      }
    }
  }
  normal.needsUpdate = true;
}

function shapesFromSvg(source: string) {
  const parsed = new SVGLoader().parse(source);
  const shapes: THREE.Shape[] = [];
  for (const path of parsed.paths) {
    const style = path.userData?.style as { fill?: string } | undefined;
    if (style?.fill === "none") continue;
    shapes.push(...path.toShapes());
  }
  if (shapes.length === 0) throw new Error("No fillable shape found in vessel SVG");
  return shapes;
}

function createStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  highlight: string,
) {
  const room = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(32, 30, 32),
    new THREE.MeshStandardMaterial({ color: "#55545a", side: THREE.BackSide }),
  );
  shell.position.y = 10;
  room.add(shell);

  const addFormer = (
    color: string,
    intensity: number,
    position: [number, number, number],
    scale: [number, number, number],
  ) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const former = new THREE.Mesh(new THREE.BoxGeometry(), material);
    former.position.set(...position);
    former.scale.set(...scale);
    room.add(former);
  };

  addFormer("#ffffff", 55, [-12, 8, 4], [0.08, 6, 2]);
  addFormer(highlight, 24, [11, 7, 3], [0.08, 5, 4]);
  addFormer("#95f1ac", 12, [0, -4, 6], [6, 0.08, 3]);
  addFormer("#ffffff", 18, [0, 12, -9], [5, 3, 0.08]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.04, 0.1, 100);
  disposeObject(room);
  pmrem.dispose();
  return target;
}

function createGlassObject(canvas: HTMLCanvasElement, initial: GlassObjectOptions) {
  const config: Required<GlassObjectOptions> = { ...DEFAULTS, ...initial };
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.fov, 1, 0.1, 200);
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(config.cameraDistance);
  scene.add(camera);

  const floatGroup = new THREE.Group();
  const fitGroup = new THREE.Group();
  floatGroup.add(fitGroup);
  scene.add(floatGroup);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;

  const glass = new THREE.MeshPhysicalMaterial({
    clearcoatRoughness: 0.06,
    color: "#f5edff",
    iridescence: 0.12,
    iridescenceIOR: 1.4,
    metalness: 0,
    specularIntensity: 1,
    transmission: 1,
  });

  let environment = createStudioEnvironment(renderer, config.highlight);
  scene.environment = environment.texture;
  let model: THREE.Group | null = null;
  let sourceToken = 0;
  let disposed = false;
  let elapsed = 0;
  let lastTime = 0;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  const onMotionChange = () => {
    reducedMotion = motionQuery.matches;
    if (reducedMotion) floatGroup.rotation.set(0, 0, 0);
  };
  motionQuery.addEventListener("change", onMotionChange);

  const applyMaterial = () => {
    glass.ior = THREE.MathUtils.clamp(config.ior, 1, 2.333);
    glass.roughness = THREE.MathUtils.clamp(config.roughness, 0, 1);
    glass.dispersion = THREE.MathUtils.clamp(config.dispersion, 0, 2);
    glass.clearcoat = THREE.MathUtils.clamp(config.clearcoat, 0, 1);
    glass.thickness = Math.max(config.thickness, 0);
    glass.attenuationColor.set(config.tint || "#ffffff");
    glass.attenuationDistance = config.tint
      ? 1.5 / Math.max(config.tintDensity, 0.01)
      : Infinity;
    scene.environmentIntensity = config.environmentIntensity;
    controls.enableRotate = config.orbit;
    controls.enableZoom = config.zoom;
    controls.autoRotate = config.autoRotate && !reducedMotion;
    controls.autoRotateSpeed = config.autoRotateSpeed;
    camera.fov = config.fov;
    camera.position.copy(CAMERA_DIRECTION).multiplyScalar(config.cameraDistance);
    camera.updateProjectionMatrix();
    floatGroup.position.set(config.xOffset, 0.3 + config.yOffset, 0);
    if (config.background) {
      scene.background = new THREE.Color(config.background);
    } else {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
    }
  };

  const mountSvg = async (src: string) => {
    const token = ++sourceToken;
    if (model) {
      fitGroup.remove(model);
      disposeObject(model, glass);
      model = null;
    }
    if (!src) return;

    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Vessel SVG returned HTTP ${response.status}`);
      const text = await response.text();
      if (disposed || token !== sourceToken) return;
      const shapes = shapesFromSvg(text);

      const bounds = new THREE.Box2();
      for (const shape of shapes) {
        for (const point of shape.getPoints(8)) bounds.expandByPoint(point);
      }
      const longestSide = Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        0.001,
      );
      const depth = THREE.MathUtils.clamp(config.depth, 0.02, 1) * longestSide;
      const bevel = THREE.MathUtils.clamp(config.bevel, 0, 1) * depth * 0.5;
      let geometry: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shapes, {
        bevelEnabled: bevel > 0.0001,
        bevelOffset: 0,
        bevelSegments: 12,
        bevelSize: bevel * 0.9,
        bevelThickness: bevel,
        curveSegments: 24,
        depth: Math.max(depth - bevel * 2, depth * 0.1),
      });
      geometry = toCreasedNormals(geometry, Math.PI / 7);
      flattenCapNormals(geometry);
      geometry.rotateX(Math.PI);

      const glassMesh = new THREE.Mesh(geometry, glass);
      const rimMesh = new THREE.Mesh(
        geometry.clone(),
        new THREE.ShaderMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            void main() {
              vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
              float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDirection)), 2.45);
              float vertical = smoothstep(-1.9, 1.9, vWorldPosition.y);
              vec3 lower = vec3(0.36, 0.95, 0.52);
              vec3 upper = vec3(0.76, 0.34, 1.0);
              float body = 0.085 + smoothstep(-2.2, 2.2, vWorldPosition.y) * 0.025;
              gl_FragColor = vec4(mix(lower, upper, vertical), body + fresnel * 0.68);
            }
          `,
          side: THREE.DoubleSide,
          transparent: true,
          vertexShader: `
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              vec4 worldPosition = modelMatrix * vec4(position, 1.0);
              vWorldPosition = worldPosition.xyz;
              gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
          `,
        }),
      );
      rimMesh.scale.setScalar(1.008);
      const contour = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 24),
        new THREE.LineBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: "#d9a5ff",
          opacity: 0.3,
          transparent: true,
        }),
      );
      contour.scale.setScalar(1.014);
      model = new THREE.Group();
      model.add(glassMesh, rimMesh, contour);
      const modelBounds = new THREE.Box3().setFromObject(model);
      const center = modelBounds.getCenter(new THREE.Vector3());
      const size = modelBounds.getSize(new THREE.Vector3());
      model.position.sub(center);
      model.scale.setScalar(config.scale / Math.max(size.x, size.y, size.z, 0.001));
      fitGroup.add(model);
      config.onLoad?.();
    } catch (error) {
      if (!disposed && token === sourceToken) config.onError?.(error);
    }
  };

  const resize = () => {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  const tick = (time: number) => {
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
    lastTime = time;
    controls.update();
    if (!reducedMotion) {
      elapsed += delta * config.floatSpeed;
      floatGroup.rotation.x = (Math.cos(elapsed / 4) / 8) * config.rotationIntensity;
      floatGroup.rotation.y = (Math.sin(elapsed / 4) / 8) * config.rotationIntensity;
      floatGroup.rotation.z = (Math.sin(elapsed / 4) / 20) * config.rotationIntensity;
      floatGroup.position.y = 0.3 + config.yOffset + (Math.sin(elapsed / 1.5) / 10) * config.floatIntensity;
    }
    renderer.render(scene, camera);
  };

  applyMaterial();
  resize();
  void mountSvg(config.src);
  renderer.setAnimationLoop(tick);

  return {
    destroy() {
      disposed = true;
      sourceToken += 1;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      controls.dispose();
      if (model) disposeObject(model, glass);
      environment.dispose();
      glass.dispose();
      renderer.dispose();
    },
    setOptions(next: GlassObjectOptions) {
      const previousSrc = config.src;
      const previousHighlight = config.highlight;
      Object.assign(config, next);
      if (previousHighlight !== config.highlight) {
        environment.dispose();
        environment = createStudioEnvironment(renderer, config.highlight);
        scene.environment = environment.texture;
      }
      applyMaterial();
      if (previousSrc !== config.src) void mountSvg(config.src);
    },
  };
}

export function GlassObject({ className, style, ...options }: GlassObjectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<ReturnType<typeof createGlassObject> | null>(null);
  const [initialOptions] = useState(options);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    instanceRef.current = createGlassObject(canvas, initialOptions);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions]);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <canvas
        aria-hidden="true"
        ref={canvasRef}
        style={{
          display: "block",
          height: "100%",
          inset: 0,
          position: "absolute",
          touchAction: "none",
          width: "100%",
        }}
      />
    </div>
  );
}
