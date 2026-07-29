import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { RoomVisibilityProvider } from "./app/roomVisibility";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";
import "./styles/navigation.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root 를 찾을 수 없습니다");

createRoot(host).render(
  <StrictMode>
    <BrowserRouter>
      <RoomVisibilityProvider>
        <App />
      </RoomVisibilityProvider>
    </BrowserRouter>
  </StrictMode>,
);
