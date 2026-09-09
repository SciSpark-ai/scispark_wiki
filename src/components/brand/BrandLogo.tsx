import Image from "next/image";
import { cn } from "@/components/ui/cn";
import styles from "./BrandLogo.module.css";

/** Transparent wordmark extracted from the user's logo reference.
 * Alpha is preserved in both themes; no paper-background compositing. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="SciSpark" data-brand-logo className={cn(styles.logo, className)}>
      <Image
        src="/brand/scispark-wordmark-transparent.png"
        alt=""
        width={1774}
        height={887}
        sizes="116px"
        loading="eager"
        className={styles.artwork}
      />
    </span>
  );
}
