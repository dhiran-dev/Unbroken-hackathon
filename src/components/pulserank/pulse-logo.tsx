import Image from "next/image";

type PulseLogoProps = {
  className?: string;
  size?: number;
};

export function PulseLogo({ className, size = 32 }: PulseLogoProps) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      src="/pulserank/logo.png"
      style={{ display: "block", height: size, objectFit: "contain", width: size }}
      width={size}
    />
  );
}
