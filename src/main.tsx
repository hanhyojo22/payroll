import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { NotificationHost } from "./shared/notifications/NotificationHost";
import "./shared/notifications/NotificationService";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <NotificationHost />
  </React.StrictMode>,
);
