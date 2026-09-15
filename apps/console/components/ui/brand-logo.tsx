import Image from "next/image";

type BrandLogoProps = {
  variant?: "console" | "marketing" | "auth" | "footer";
  priority?: boolean;
};

// One square asset preserves the mark, product name, and tagline together.
export function BrandLogo({ variant = "console", priority = false }: BrandLogoProps) {
  return (
    <span className={`certflow-logo certflow-logo-${variant}`}>
      <Image
        className="certflow-logo-image"
        src="/brand/certflow-logo.jpg"
        width={1024}
        height={1024}
        alt="CertFlow"
        priority={priority}
      />
    </span>
  );
}
