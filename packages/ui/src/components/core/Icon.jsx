import React from "react";
import { icons } from "lucide-react";

/** Thin inline Lucide icon (bundled via lucide-react — no CDN, works offline).
 *  Same props API as the design-system original: kebab-case `name`, stroke 1.75. */
export function Icon({ name, size = 20, strokeWidth = 1.75, color = "currentColor", filled = false, style }) {
  const pascal = String(name)
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  const LucideIcon = icons[pascal] || null;
  if (!LucideIcon) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{ flex: "none", ...style }}
        aria-hidden="true"
      />
    );
  }
  return (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      fill={filled ? color : "none"}
      style={{ flex: "none", ...style }}
      aria-hidden="true"
    />
  );
}
