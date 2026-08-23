"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type CardMotionContextValue = {
  active: boolean;
  reducedMotion: boolean;
};

const CardMotionContext = createContext<CardMotionContextValue>({
  active: false,
  reducedMotion: true,
});

export function CardContainer({
  children,
  className,
  containerClassName,
}: {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");
    const update = () => setReducedMotion(reduce.matches || !fine.matches);
    update();
    reduce.addEventListener("change", update);
    fine.addEventListener("change", update);
    return () => {
      reduce.removeEventListener("change", update);
      fine.removeEventListener("change", update);
    };
  }, []);

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card || reducedMotion) return;
    const bounds = card.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    card.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 7}deg)`;
  }

  function reset() {
    setActive(false);
    if (cardRef.current) cardRef.current.style.transform = "rotateY(0deg) rotateX(0deg)";
  }

  return (
    <CardMotionContext.Provider value={{ active, reducedMotion }}>
      <div
        className={containerClassName}
        onPointerEnter={() => !reducedMotion && setActive(true)}
        onPointerLeave={reset}
        onPointerMove={handlePointerMove}
        style={{ perspective: "1200px" }}
      >
        <div
          className={className}
          ref={cardRef}
          style={{
            transformStyle: "preserve-3d",
            transition: "transform 180ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          {children}
        </div>
      </div>
    </CardMotionContext.Provider>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={{ transformStyle: "preserve-3d" }}>
      {children}
    </div>
  );
}

export function CardItem({
  children,
  className,
  translateX = 0,
  translateY = 0,
  translateZ = 0,
}: {
  children?: ReactNode;
  className?: string;
  translateX?: number;
  translateY?: number;
  translateZ?: number;
}) {
  const { active, reducedMotion } = useContext(CardMotionContext);
  const transform = active && !reducedMotion
    ? `translate3d(${translateX}px, ${translateY}px, ${translateZ}px)`
    : "translate3d(0, 0, 0)";

  return (
    <div
      className={className}
      style={{
        transform,
        transformStyle: "preserve-3d",
        transition: "transform 180ms cubic-bezier(.2,.8,.2,1)",
      }}
    >
      {children}
    </div>
  );
}

type Direction = "TOP" | "RIGHT" | "BOTTOM" | "LEFT";
const DIRECTIONS: Direction[] = ["TOP", "RIGHT", "BOTTOM", "LEFT"];

const BORDER_POSITION: Record<Direction, string> = {
  TOP: "50% 0%",
  RIGHT: "100% 50%",
  BOTTOM: "50% 100%",
  LEFT: "0% 50%",
};

export function HoverBorderGradient({
  children,
  className,
  containerClassName,
  duration = 1.2,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  containerClassName?: string;
  duration?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [directionIndex, setDirectionIndex] = useState(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (hovered || media.matches) return;
    const timer = window.setInterval(
      () => setDirectionIndex((index) => (index + 1) % DIRECTIONS.length),
      duration * 1000,
    );
    return () => window.clearInterval(timer);
  }, [duration, hovered]);

  const position = BORDER_POSITION[DIRECTIONS[directionIndex] ?? "TOP"];
  const style = useMemo(
    () => ({
      "--hover-border-position": position,
      "--hover-border-duration": `${duration * 0.75}s`,
    }) as CSSProperties,
    [duration, position],
  );

  return (
    <button
      className={containerClassName}
      data-hovered={hovered ? "true" : "false"}
      {...props}
      onMouseEnter={(event) => {
        setHovered(true);
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        props.onMouseLeave?.(event);
      }}
      style={{ ...style, ...props.style }}
      type="button"
    >
      <span className={cn(className)}>{children}</span>
    </button>
  );
}

export type LayoutGridCard = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  content: ReactNode;
};

export function LayoutGrid({
  cards,
  className,
  itemClassName,
}: {
  cards: LayoutGridCard[];
  className?: string;
  itemClassName?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className={className} data-selected={selectedId ?? "none"}>
      {cards.map((card) => {
        const selected = card.id === selectedId;
        return (
          <article
            className={itemClassName}
            data-layout-grid-card
            data-selected={selected ? "true" : "false"}
            key={card.id}
          >
            <button
              aria-expanded={selected}
              onClick={() => setSelectedId(selected ? null : card.id)}
              type="button"
            >
              <span>{card.eyebrow}</span>
              <strong>{card.title}</strong>
              <small>{selected ? "Collapse record" : card.summary}</small>
            </button>
            <div aria-hidden={!selected} data-layout-grid-content>
              {card.content}
            </div>
          </article>
        );
      })}
    </div>
  );
}
