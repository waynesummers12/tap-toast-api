import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"

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
app.use(express.json())

const PORT = Number(process.env.PORT) || 8000

// Health check route
app.get("/", (req: any, res: any) => {
  res.send("Tap & Toast API running")
})

// Routes
import bookingRoutes from "./routes/bookingRoutes"
const stripeRoutes = require("./routes/stripeRoutes")
import stripeWebhook from "./routes/stripeWebhook"
import eventRoutes from "./routes/eventRoutes"
import bartenderRoutes from "./routes/bartenderRoutes"
import assignBartendersRoutes from "./routes/assign-bartenders"

app.use("/api", bookingRoutes)
app.use("/api/stripe", stripeRoutes)
app.use("/api/events", eventRoutes)
app.use("/api/bartenders", bartenderRoutes)
app.use("/api", assignBartendersRoutes)
app.use("/stripe-webhook", stripeWebhook)

// Global error handler (helps debugging on Render)
app.use((err: any, req: any, res: any, next: any) => {
  console.error("🔥 Server Error:", err)
  res.status(500).json({ error: "Internal Server Error" })
})

// Start server (IMPORTANT: bind to 0.0.0.0)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`)
})