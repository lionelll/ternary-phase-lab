import { createRoot } from "react-dom/client";
import TernaryLab from "./app/TernaryLab";
import "./app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root element is missing");
}

createRoot(root).render(<TernaryLab />);
