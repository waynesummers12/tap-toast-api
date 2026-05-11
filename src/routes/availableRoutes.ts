import express from "express"
import { createClient } from "@supabase/supabase-js"

const router = express.Router()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

router.get("/availability", async (req, res) => {
  const { data, error } = await supabase
    .from("events")
    .select("event_date")
    .eq("event_status", "confirmed")

  if (error) {
    console.error(error)
    return res.status(500).json({ error: "Failed to fetch availability" })
  }

  const bookedDates = data.map((e) =>
    new Date(e.event_date).toISOString().split("T")[0]
  )

  res.json({ bookedDates })
})

module.exports = router
module.exports.default = router