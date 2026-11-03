import { Kbd, Popover } from "../components";
import s from "./ShortcutSheet.module.css";

const ROWS: [string[], string][] = [
  [["Space"], "Play or pause"],
  [["←", "→"], "Step 0.1 s"],
  [["Shift", "←", "→"], "Step 1 s"],
  [["Home", "End"], "Mission start or end"],
  [["[", "]"], "Slower or faster (0.5× to 60×)"],
  [["J", "K"], "Previous or next event (uses the jump filter)"],
  [["G"], "Tour: play every chapter back to back, or stop it"],
  [["1", "2", "3", "4"], "Replay, Results, Scenario, Method"],
  [["T"], "Light or dark theme"],
  [["P"], "Presenter mode (larger text, thicker lines)"],
  [["F"], "Theatre: camera feeds full screen"],
  [["C"], "Theatre: needed camera only, or both cameras"],
  [["?"], "This sheet"],
  [["Esc"], "Close a popover or tooltip"],
];

/** The "?" sheet (DESIGN.md 11). Recommends the light theme for projectors. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Popover open={open} onClose={onClose} placement="center" title="Keyboard shortcuts" width={460}>
      <table className={s.table}>
        <tbody>
          {ROWS.map(([keys, what]) => (
            <tr key={what}>
              <th scope="row">
                {keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
              </th>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.note}>
        Playback keys work in Replay. On a projector, use the light theme and presenter mode.
      </p>
    </Popover>
  );
}
