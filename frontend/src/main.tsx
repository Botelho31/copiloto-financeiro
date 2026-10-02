import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { PersonScopeProvider } from "./lib/personScope";
import { VaultTransitionProvider } from "./lib/vaultTransition";
import "./i18n";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <VaultTransitionProvider>
        <PersonScopeProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </PersonScopeProvider>
      </VaultTransitionProvider>
    </QueryClientProvider>
  </StrictMode>
);
