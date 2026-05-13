import "dotenv/config"
import cron from "node-cron"
import { runPaymentReminders } from "../services/reminderService"

console.log("Reminder worker started")

// Run every day at 9 AM
cron.schedule("0 9 * * *", async () => {
  console.log("Running payment reminder job...")

  try {
    await runPaymentReminders()
    console.log("Reminder job completed")
  } catch (err) {
    console.error("Reminder job failed:", err)
  }
})
// 🚀 Run once on startup (important for testing + reliability)
;(async () => {
  try {
    console.log("Running reminder job on startup...")
    await runPaymentReminders()
    console.log("Startup reminder job completed")
  } catch (err) {
    console.error("Startup reminder job failed:", err)
  }
})()