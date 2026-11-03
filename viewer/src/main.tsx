import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { bindDocumentAttributes } from "./state/store";
import { bindUrlHash } from "./state/url";
import { startPlaybackLoop } from "./state/playback";
import { App } from "./app/App";

bindDocumentAttributes();
bindUrlHash();
startPlaybackLoop();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
