import express from "express";
import path from "path";
import { config } from "./config";
import { connectDB } from "./db";
import { router } from "./routes";
import { startScheduler } from "./scheduler";
import { startTelegramBotListener } from "./telegramBot";

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
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
