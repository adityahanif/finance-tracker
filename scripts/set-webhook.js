// Jalankan sekali setelah deploy: node scripts/set-webhook.js https://domain-kamu.vercel.app
require("dotenv").config();

const url = process.argv[2];
if (!url) {
  console.error("Pakai: node scripts/set-webhook.js https://domain-kamu.vercel.app");
  process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret) {
  console.error("TELEGRAM_BOT_TOKEN dan TELEGRAM_WEBHOOK_SECRET wajib ada di .env");
  process.exit(1);
}

fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${url.replace(/\/$/, "")}/api/telegram-webhook`,
    secret_token: secret,
  }),
})
  .then((r) => r.json())
  .then((d) => console.log(d))
  .catch((e) => console.error(e));
