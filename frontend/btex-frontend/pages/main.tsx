import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DecisionWorkbench from "../app/workbench";
import "../app/globals.css";

if (typeof document !== "undefined") {
  const root = document.getElementById("root");

  if (!root) {
    throw new Error("Missing #root element");
  }

  createRoot(root).render(
    <StrictMode>
      <DecisionWorkbench />
    </StrictMode>,
  );
}
