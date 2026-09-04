import React from "react";

interface GradientBarsProps {
  numBars?: number;
  gradientFrom?: string;
  gradientTo?: string;
  animationDuration?: number;
  className?: string;
}

const GradientBars: React.FC<GradientBarsProps> = ({
  numBars = 19,
  gradientFrom = "#6050DC",
  gradientTo = "transparent",
  animationDuration = 2.8,
  className = "",
}) => {
  const calculateHeight = (index: number, total: number) => {
    const position = index / (total - 1);
    const maxHeight = 100;
    const minHeight = 28;

    const center = 0.5;
    const distanceFromCenter = Math.abs(position - center);
    const heightPercentage = Math.pow(distanceFromCenter * 2, 1.2);

    return minHeight + (maxHeight - minHeight) * heightPercentage;
  };

  return (
    <>
      <style>{`
        @keyframes pulseBar {
          0% { transform: scaleY(var(--initial-scale)); }
          100% { transform: scaleY(calc(var(--initial-scale) * 0.62)); }
        }
        @keyframes neonWaveGlow {
          0%, 100% { opacity: 0.60; }
          50% { opacity: 0.90; }
        }
      `}</style>

      <div className={`absolute inset-0 z-0 overflow-hidden pointer-events-none ${className}`}>
        <div
          className="flex h-full items-end"
          style={{
            width: "100%",
            transform: "translateZ(0)",
            backfaceVisibility: "hidden",
            WebkitFontSmoothing: "antialiased",
            filter: "drop-shadow(0 0 16px rgba(96, 80, 220, 0.40))",
          }}
        >
          {Array.from({ length: numBars }).map((_, index) => {
            const height = calculateHeight(index, numBars);
            const isEven = index % 2 === 0;
            const barGradient = isEven
              ? `linear-gradient(to top, #00D9FF 0%, rgba(0, 217, 255, 0.78) 15%, rgba(96, 80, 220, 0.60) 45%, rgba(165, 148, 253, 0.25) 75%, ${gradientTo} 100%)`
              : `linear-gradient(to top, ${gradientFrom} 0%, rgba(96, 80, 220, 0.82) 15%, rgba(123, 104, 238, 0.55) 40%, rgba(0, 217, 255, 0.30) 70%, ${gradientTo} 100%)`;

            return (
              <div
                key={index}
                style={{
                  flex: `1 0 calc(100% / ${numBars})`,
                  maxWidth: `calc(100% / ${numBars})`,
                  height: "100%",
                  background: barGradient,
                  transform: `scaleY(${height / 100})`,
                  transformOrigin: "bottom",
                  transition: "transform 0.6s ease-in-out",
                  animation: `pulseBar ${animationDuration}s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate`,
                  animationDelay: `${index * 0.1}s`,
                  outline: "1px solid rgba(0, 0, 0, 0)",
                  boxSizing: "border-box",
                  // @ts-ignore
                  "--initial-scale": height / 100,
                }}
              />
            );
          })}
        </div>
        {/* Névoa de brilho neon no rodapé */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "180px",
            background: "radial-gradient(ellipse at 50% 100%, rgba(96, 80, 220, 0.50) 0%, rgba(0, 217, 255, 0.30) 45%, transparent 75%)",
            filter: "blur(28px)",
            pointerEvents: "none",
            animation: "neonWaveGlow 4s ease-in-out infinite",
          }}
        />
      </div>
    </>
  );
};

interface ComponentProps {
  numBars?: number;
  gradientFrom?: string;
  gradientTo?: string;
  animationDuration?: number;
  backgroundColor?: string;
  children?: React.ReactNode;
}

export default function Component({
  numBars = 19,
  gradientFrom = "#6050DC",
  gradientTo = "transparent",
  animationDuration = 2.8,
  backgroundColor = "#060810",
  children,
}: ComponentProps) {
  return (
    <section
      className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor }}
    >
      <GradientBars
        numBars={numBars}
        gradientFrom={gradientFrom}
        gradientTo={gradientTo}
        animationDuration={animationDuration}
      />

      {children && (
        <div className="relative z-10 w-full h-full flex items-center justify-center px-4">
          {children}
        </div>
      )}
    </section>
  );
}

export { Component, GradientBars };
