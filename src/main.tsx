import React from "react";
import ReactDOM from "react-dom/client";
import { AppWalletProvider } from "./components/WalletProvider";
import { VanityGenerator } from "./components/VanityGenerator";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppWalletProvider>
      <VanityGenerator />
    </AppWalletProvider>
  </React.StrictMode>
);
