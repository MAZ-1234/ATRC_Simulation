import { forwardRef, type HTMLAttributes } from "react";
import s from "./Kbd.module.css";

/** A key cap: <Kbd>Space</Kbd>, <Kbd>[</Kbd>. Same font as the UI (no monospace anywhere). */
export const Kbd = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Kbd({ className, ...rest }, ref) {
  return <kbd ref={ref} className={[s.kbd, className].filter(Boolean).join(" ")} {...rest} />;
});
