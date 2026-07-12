import { Star } from "lucide-react";

interface StarsRatingProps {
  rating: number;
  max?: number;
  size?: number;
}

export function StarsRating({ rating, max = 5, size = 12 }: StarsRatingProps) {
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          size={size}
          className={
            i < rating
              ? "fill-warm-tan text-warm-tan"
              : "text-border-warm"
          }
          strokeWidth={1.6}
        />
      ))}
    </div>
  );
}
