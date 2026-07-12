export function GrainOverlay({
  intensity = "medium",
}: {
  intensity?: "light" | "medium" | "heavy";
}) {
  const opacityClass =
    intensity === "light"
      ? "opacity-[0.12]"
      : intensity === "heavy"
        ? "opacity-[0.30]"
        : "opacity-[0.20]";

  return (
    <div
      className={`absolute inset-0 pointer-events-none ${opacityClass}`}
      style={{
        backgroundImage: "url(/textures/grain.png)",
        backgroundRepeat: "repeat",
      }}
    />
  );
}
