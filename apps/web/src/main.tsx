import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { bootstrapApp } from "./app/bootstrap";
import "./styles/variables.css";
import "./styles/desktop.css";
import "./styles/mobile.css";
import "./styles/editor.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);

function render() {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrapApp()
  .then(render)
  .catch((error) => {
    console.error(error);
    render();
  });

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
