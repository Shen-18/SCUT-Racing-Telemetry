import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme/fonts.css";
import "./theme/tokens.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
