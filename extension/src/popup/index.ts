import { CredentialStore } from "../background/credential-store";
import { ServerClient } from "../background/server-client";
import { attemptPairing } from "./pairing-form";

const credentialStore = new CredentialStore();
const serverClient = new ServerClient(() => credentialStore.get());

async function render(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  const credential = await credentialStore.get();

  if (credential) {
    app.innerHTML = `
      <p>Paired &#x2713;</p>
      <button id="run-autofill">Run autofill on this tab</button>
    `;
    document.getElementById("run-autofill")?.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      chrome.runtime.sendMessage({ type: "popup_run_autofill", tabId: tab.id });
      window.close();
    });
  } else {
    app.innerHTML = `
      <p>Paste the pairing code shown on the JobSearch web app:</p>
      <input id="pairing-code" type="text" />
      <button id="pair-button">Pair</button>
      <p id="pairing-message"></p>
    `;
    document.getElementById("pair-button")?.addEventListener("click", async () => {
      const input = document.getElementById("pairing-code") as HTMLInputElement;
      const messageEl = document.getElementById("pairing-message");
      const result = await attemptPairing(input.value.trim(), serverClient, credentialStore);
      if (result.ok) {
        await render();
      } else if (messageEl) {
        messageEl.textContent = result.message;
      }
    });
  }
}

void render();
