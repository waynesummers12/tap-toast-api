import { Router } from "express"
import { createClient } from "@supabase/supabase-js"
import { sendBookingConfirmation, sendInternalNotification } from "../services/emailService"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

// CREATE EVENT (booking flow + email trigger)
router.post("/create", async (req, res) => {
  try {
    // 🔥 Create or fetch customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert(
        {
          name: req.body.name,
          email: req.body.email,
          phone: req.body.phone
        },
        { onConflict: "email" }
      )
      .select("id, name, email")
      .single()

    if (customerError) throw customerError

    // 🔥 SAFE PRICING CALCULATION (with custom override)
    const hours = Number(req.body.hours || 0)
    const bartenders = Number(req.body.bartenders || 0)
    const base = 600
    const staffing = bartenders * hours * 40

    const customTotal = Number(req.body.custom_total_price || 0)

    const safeTotal = customTotal > 0
      ? customTotal
      : (Number(req.body.total_price) > 0
          ? Number(req.body.total_price)
          : base + staffing)

    const deposit = safeTotal * 0.5
    const balance = safeTotal - deposit

    const eventData = {
      customer_id: customer.id,
      event_date: req.body.event_date,
      location: req.body.location,
      start_time: req.body.start_time,
      hours,
      bartenders,
      custom_total_price: customTotal > 0 ? customTotal : null,
      total_price: safeTotal,
      deposit_amount: deposit,
      balance_due: balance,
      deposit_paid: false,
      balance_paid: false,
      event_status: "pending"
    }

    const { data: event, error } = await supabase
      .from("events")
      .insert([eventData])
      .select(`
        *,
        customer:customers (
          name,
          email
        )
      `)
      .single()

    if (error) throw error

    console.log("📦 EVENT CREATED:", event.id)

    try {
      console.log("📧 Sending booking confirmation emails...")
      await sendBookingConfirmation(event)
      await sendInternalNotification(event)
    } catch (emailErr) {
      console.error("❌ Email send failed (non-blocking):", emailErr)
    }

    res.json({ success: true, event })

  } catch (err) {
    console.error("Create event error:", err)
    res.status(500).json({ error: "Failed to create event" })
  }
})

// GET all events
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select(`
        id,
        event_date,
        location,
        start_time,
        hours,
        bartenders_needed,
        total_price,
        deposit_amount,
        balance_due,
        deposit_paid,
        balance_paid,
        event_status,
        bartenders,
        customers (
          name,
          email
        ),
        event_bartenders (
          id
        )
      `)
      .neq("event_status", "cancelled")
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

// GET booked time slots (for time-based availability)
router.get("/booked-slots", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("event_date, start_time, hours")
      .eq("event_status", "confirmed")

    if (error) throw error

    const slots = (data || []).map((e: { event_date: string; start_time: string; hours: number }) => {
      const [hourStr, minuteStr = "0"] = String(e.start_time || "18:00").split(":")
      const startHour = Number(hourStr)
      const startMinute = Number(minuteStr)

      const start = new Date(
        `${e.event_date}T${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}:00`
      )

      const end = new Date(start.getTime() + (e.hours || 4) * 60 * 60 * 1000)

      return {
        date: e.event_date.split("T")[0],
        start: start.toISOString(),
        end: end.toISOString()
      }
    })

    res.json(slots)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to fetch booked slots" })
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


// CANCEL EVENT (soft delete via status)
router.post("/cancel", async (req, res) => {
  try {
    const { eventId } = req.body

    if (!eventId) {
      return res.status(400).json({ error: "Missing eventId" })
    }

    const { error } = await supabase
      .from("events")
      .update({
        event_status: "cancelled"
      })
      .eq("id", eventId)

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    console.error("Cancel event error:", err)
    res.status(500).json({ error: "Failed to cancel event" })
  }
})

router.post("/update-price", async (req, res) => {
  try {
    const { eventId, custom_total_price } = req.body

    if (!eventId) {
      return res.status(400).json({ success: false, error: "Missing eventId" })
    }

    const custom = Number(custom_total_price || 0)

    // 🔥 Recalculate pricing
    const total = custom
    const deposit = total * 0.5
    const balance = total - deposit

    const { error } = await supabase
      .from("events")
      .update({
        custom_total_price: custom > 0 ? custom : null,
        total_price: total,
        deposit_amount: deposit,
        balance_due: balance
      })
      .eq("id", eventId)

    if (error) {
      console.error("Update price error:", error)
      return res.status(500).json({ success: false })
    }

    return res.json({ success: true })

  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false })
  }
})

router.get("/:id/bartenders", async (req, res) => {
  try {
    const { id: eventId } = req.params

    const { data, error } = await supabase
      .from("event_bartenders")
      .select(`
        hours,
        pay,
        bartenders (
          id,
          name
        )
      `)
      .eq("event_id", eventId)

    if (error) {
      console.error("Fetch bartenders error:", error)
      return res.status(500).json({ bartenders: [] })
    }

    return res.json({
      event_id: eventId,
      bartenders: (data || []).map((b: any) => ({
        name: b.bartenders?.name,
        hours: b.hours,
        pay: b.pay
      }))
    })

  } catch (err) {
    console.error(err)
    return res.status(500).json({ bartenders: [] })
  }
})

// ASSIGN BARTENDERS (relational model)
router.post("/assign-bartenders", async (req, res) => {
  try {
    const { eventId, bartenders } = req.body

    if (!eventId || !Array.isArray(bartenders)) {
      return res.status(400).json({ success: false, error: "Invalid payload" })
    }

    // 🔥 Get bartender IDs from names
    const { data: bartenderRows, error: bartenderError } = await supabase
      .from("bartenders")
      .select("id, name")

    if (bartenderError) throw bartenderError

    const nameToIdMap: Record<string, string> = {}
    ;(bartenderRows || []).forEach((b: any) => {
      nameToIdMap[b.name] = b.id
    })

    // 🔥 Delete existing assignments for this event
    const { error: deleteError } = await supabase
      .from("event_bartenders")
      .delete()
      .eq("event_id", eventId)

    if (deleteError) throw deleteError

    // 🔥 Insert new assignments
    const inserts = bartenders
      .map((b: any) => {
        const bartenderId = nameToIdMap[b.name]

        if (!bartenderId) return null

        return {
          event_id: eventId,
          bartender_id: bartenderId,
          hours: b.hours || 0,
          pay: b.pay || 0
        }
      })
      .filter(Boolean)

    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from("event_bartenders")
        .insert(inserts)

      if (insertError) throw insertError
    }

    return res.json({ success: true })

  } catch (err) {
    console.error("Assign bartenders error:", err)
    return res.status(500).json({ success: false })
  }
})

export default router