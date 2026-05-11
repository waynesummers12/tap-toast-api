import { Router } from "express"
import { createClient } from "@supabase/supabase-js"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

// GET all events
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select(`
        *,
        customers(name,email),
        event_bartenders(id)
      `)
      .order("event_date", { ascending: true })

    if (error) throw error

    type EventWithBartenders = {
      event_bartenders?: { id: string }[]
      [key: string]: unknown
    }

    const events = (data || []).map((e: EventWithBartenders & {
      total_price?: number
      deposit_amount?: number
      deposit_paid?: boolean
      bartenders?: number
      hours?: number
    }) => ({
      ...e,
      assigned_bartenders_count: e.event_bartenders?.length || 0,
      balance_remaining:
        (e.total_price || 0) -
        (e.deposit_paid ? (e.deposit_amount || 0) : 0),
      profit_estimate:
        (e.total_price || 0) - ((e.bartenders || 0) * (e.hours || 0) * 25)
    }))

    res.json(events)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to fetch events" })
  }
})

// GET booked dates (for calendar availability)
router.get("/booked-dates", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("event_date")
      .not("event_date", "is", null)

    if (error) throw error

    const bookedDates = (data || []).map((e: { event_date: string }) =>
      e.event_date.split("T")[0] // normalize to YYYY-MM-DD
    )

    res.json({ bookedDates })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to fetch booked dates" })
  }
})

// MARK EVENT FULLY PAID
router.post("/mark-paid", async (req, res) => {
  try {
    const { eventId } = req.body

    const { error } = await supabase
      .from("events")
      .update({
        deposit_paid: true,
        balance_paid: true,
        balance_due: 0
      })
      .eq("id", eventId)

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to update event" })
  }
})

export default router