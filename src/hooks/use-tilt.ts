import { useCallback, useRef, useState } from "react";

/**
 * Pointer-driven 3D tilt with a spring-like release.
 * Disabled automatically on touch/coarse pointers so mobile stays snappy.
 */
export function useTilt(maxDeg = 9) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const node = ref.current;
      if (!node) return;
      if (window.matchMedia("(pointer: coarse)").matches) return;
      const rect = node.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      setStyle({
        transform: `perspective(900px) rotateX(${(-py * maxDeg).toFixed(2)}deg) rotateY(${(px * maxDeg).toFixed(2)}deg) translateZ(10px) scale(1.015)`,
      });
    },
    [maxDeg],
  );

  const onMouseLeave = useCallback(() => {
    setStyle({ transform: "perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0) scale(1)" });
  }, []);

  return { ref, style, onMouseMove, onMouseLeave };
}
