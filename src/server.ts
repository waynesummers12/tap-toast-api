import dotenv from "dotenv"
dotenv.config()
console.log("🔑 STRIPE KEY IN USE:", process.env.STRIPE_SECRET_KEY)

import express from "express"
import cors from "cors"
import stripeWebhook from "./routes/stripeWebhook"

// Start background worker (only when enabled)
if (process.env.ENABLE_REMINDERS !== "false") {
  if (!(global as any)._reminderWorkerStarted) {
    (global as any)._reminderWorkerStarted = true
    require("./jobs/reminderWorker")
    console.log("Reminder worker initialized")
  }
}

const app = express()

app.use(cors())

// 🔥 Stripe webhook MUST be defined BEFORE express.json
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
)

// Normal JSON parsing for all other routes
app.use(express.json())

const PORT = Number(process.env.PORT) || 8000

// Health check route
app.get("/", (req: any, res: any) => {
  res.send("Tap & Toast API running")
})

// Routes
import bookingRoutes from "./routes/bookingRoutes"
const stripeRoutes = require("./routes/stripeRoutes").default
import eventRoutes from "./routes/eventRoutes"
import bartenderRoutes from "./routes/bartenderRoutes"
import assignBartendersRoutes from "./routes/assign-bartenders"
import upgradeRoutes from "./routes/upgrade-eventId"
const availableRoutes = require("./routes/availableRoutes")
import emailRoutes from "./routes/emailRoutes"

app.use("/api", bookingRoutes)
app.use("/api/stripe", stripeRoutes)
app.use("/api/events", eventRoutes)
app.use("/api/bartenders", bartenderRoutes)
app.use("/api", assignBartendersRoutes)
app.use("/api", upgradeRoutes)
app.use("/api/availability", availableRoutes)
app.use("/api/email", emailRoutes)

// Global error handler (helps debugging on Render)
app.use((err: any, req: any, res: any, next: any) => {
  console.error("🔥 Server Error:", err)
  res.status(500).json({ error: "Internal Server Error" })
})

// Start server (IMPORTANT: bind to 0.0.0.0)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`)
})