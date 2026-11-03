import { EmptyState } from "../components";
import { REGEN_COMMAND, REGEN_CWD, type DataStatus } from "../data/loader";
import s from "./App.module.css";

/** Full-page state when data/*.js did not load (DESIGN.md 10: name what failed and the fix). */
export function DataError({ status }: { status: DataStatus }) {
  return (
    <main className={s.dataError}>
      <h1 className={s.productName}>EDGE-MLC mission viewer</h1>
      <EmptyState kind="bad" title={`The simulation data did not load: ${status.missing.join(", ")} is missing.`}
        command={REGEN_COMMAND} cwd={REGEN_CWD}>
        <p>
          The viewer reads its data from the data folder next to index.html. Export it from the simulator,
          then reload this page. In development the files live in viewer/public/data/; in a build, in dist/data/
          (run npm run build again after exporting).
        </p>
      </EmptyState>
    </main>
  );
}
