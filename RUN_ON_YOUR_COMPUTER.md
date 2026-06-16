# Running the App on Your Own Computer

A simple guide to run the Marketing Workflow app **and** the local AI worker
(Codex) on your machine. The worker is what powers the **"Generate with Local AI"**
button — it makes posters using the ChatGPT subscription instead of paid OpenAI.

> You only need this if you want to run it yourself (for testing/demo).
> To just *use* the app normally, open the deployed (Vercel) link — no setup needed.

---

## 1. One-time setup

Do these once.

1. **Install Node.js (v20 or newer)** — download from <https://nodejs.org> and install.
   - Check it worked: open a terminal and run `node -v` (should print v20+).

2. **Install Codex and sign in** (this is the AI engine for the local button):
   ```
   npm install -g @openai/codex
   codex login
   ```
   - When `codex login` opens, choose **"Sign in with ChatGPT"** and use the
     subscription account.

3. **Get the project code** (ask Abhishek for the repo link):
   ```
   git clone <repo-link>
   cd marketing-workflow-app
   npm install
   ```

4. **Get the secrets file** — Abhishek will send you a file called **`.env.local`**.
   Put it in the project folder (`marketing-workflow-app`). Don't share it.

That's it for setup.

---

## 2. Every time you want to run it

Open the project folder in **two** terminals.

**Terminal 1 — the app:**
```
npm run dev
```
Then open <http://localhost:3000> in your browser.

**Terminal 2 — the local AI worker:**

- On **Windows (PowerShell):**
  ```
  $env:MODEL_ENGINE='codex'; npm run worker
  ```
- On **Mac / Linux:**
  ```
  MODEL_ENGINE=codex npm run worker
  ```

Leave both running while you use the app.

---

## 3. Using it

- **"Generate with AI"** → the cloud path (OpenAI). Needs OpenAI credit.
- **"Generate with Local AI"** → runs on *your computer* through Codex.
  Free with the ChatGPT subscription. **Terminal 2 (the worker) must be running.**
- A local poster takes about **6–8 minutes** (it's doing all the AI work on your
  machine). That's normal.

---

## 4. Important notes

- ⚠️ **Only ONE worker should run at a time.** You and Abhishek share the same
  database, so don't both run the worker at once — coordinate who runs it.
- **To stop:** press `Ctrl + C` in each terminal.
- If the app says "not connected" or logs you out, it's usually a Wi-Fi/network
  blip — check your internet and sign in again.
- If the local button does nothing, make sure **Terminal 2 (the worker) is running**
  and shows `[Worker] started`.
