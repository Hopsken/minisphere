import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { api } from "@/lib/api";
import { configureTownOAuth } from "@/lib/oauth";
import { createAppRouter } from "@/router";

import "./styles.css";

const response = await api.configuration.$get();
if (!response.ok) {
  throw new Error("Town configuration is unavailable");
}
const configuration = configureTownOAuth(await response.json());
const router = createAppRouter(configuration);

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
