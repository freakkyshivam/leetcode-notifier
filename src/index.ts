import express from "express";
import path from "path";
import { config } from "./config";
import { connectDB } from "./db";
import { router } from "./routes";
import { startScheduler } from "./scheduler";
import { startTelegramBotListener } from "./telegramBot";

const app = express();

app.use(express.json());

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir, { extensions: ["html"] }));

// Route aliases for clean URLs without requiring .html extension
app.get("/signup", (_req, res) => res.sendFile(path.join(publicDir, "signup.html")));
app.get("/login", (_req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(publicDir, "dashboard.html")));
app.get("/developer", (_req, res) => res.sendFile(path.join(publicDir, "developer.html")));

app.use(router);

async function main() {
  try {
    await connectDB();

    app.listen(config.port, () => {
      console.log(`[server] Listening on http://localhost:${config.port}`);

      startScheduler();
      startTelegramBotListener();
    });
  } catch (error) {
    console.error("[server] Failed to start server:", error);
    process.exit(1);
  }
}

main();
