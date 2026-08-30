import { Router } from "express"
import { createClient } from "@supabase/supabase-js"
import { sendBookingConfirmation, sendInternalNotification, sendAbandonedQuoteEmail } from "../services/emailService"
import { calculateMountainViewPricing } from "../services/pricingService"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

type CreateEventPayload = {
  name: string
  email: string
  phone?: string
  event_date: string
  location: string
  start_time: string
  hours: number
  bartenders: number
  total_price?: number
  custom_total_price?: number
  estimated_total?: number
  deposit_amount?: number
  venue?: string
  package_key?: string
  package_name?: string
  package_price?: number
  guests?: number
}

function parseCreateEvent(body: any): CreateEventPayload | null {
  if (!body) return null
  const required = ["name","email","event_date","location","start_time"]
  for (const k of required) {
    if (!body[k]) return null
  }
  return {
    name: String(body.name),
    email: String(body.email),
    phone: body.phone ? String(body.phone) : undefined,
    event_date: String(body.event_date),
    location: String(body.location),
    start_time: String(body.start_time),
    hours: Number(body.hours || 0),
    bartenders: Number(body.bartenders || 0),
    total_price: body.total_price ? Number(body.total_price) : undefined,
    custom_total_price: body.custom_total_price ? Number(body.custom_total_price) : undefined,
    estimated_total: body.estimated_total ? Number(body.estimated_total) : undefined,
    deposit_amount: body.deposit_amount ? Number(body.deposit_amount) : undefined,
    venue: body.venue ? String(body.venue) : undefined,
    package_key: body.package_key ? String(body.package_key) : undefined,
    package_name: body.package_name ? String(body.package_name) : undefined,
    package_price: body.package_price ? Number(body.package_price) : undefined,
    guests: body.guests !== undefined ? Number(body.guests) : undefined,
  }
}

function parseUpdatePrice(body: any): { eventId: string; custom: number } | null {
  const eventId = body?.eventId || body?.event_id
  if (!eventId) return null
  const custom = Number(body?.custom_total_price || 0)
  return { eventId, custom }
}

// CREATE EVENT (booking flow + email trigger)
router.post("/create", async (req, res) => {
  try {
    const parsed = parseCreateEvent(req.body)
    if (!parsed) {
      return res.status(400).json({ error: "Invalid create payload" })
    }

    const isMountainView = parsed.venue === "mountain-view"
    let mountainViewPricing = null

    if (isMountainView) {
      if (!Number.isFinite(parsed.guests) || !Number.isInteger(parsed.guests) || Number(parsed.guests) <= 0) {
        return res.status(400).json({ error: "Mountain View guests must be a positive whole number" })
      }

      mountainViewPricing = calculateMountainViewPricing(parsed.package_key || "", Number(parsed.guests))
      if (!mountainViewPricing) {
        return res.status(400).json({ error: "Unsupported Mountain View package" })
      }
    }

    // 🔥 Create or fetch customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert(
        {
          name: parsed.name,
          email: parsed.email,
          phone: parsed.phone
        },
        { onConflict: "email" }
      )
      .select("id, name, email")
      .single()

    if (customerError) throw customerError

    // 🔥 SAFE PRICING CALCULATION (with custom override)
    const hours = Number(parsed.hours || 0)
    const bartenders = Number(parsed.bartenders || 0)
    const base = 600
    const staffing = bartenders * hours * 40

    const customTotal = Number(parsed.custom_total_price || 0)
    const estimatedTotal = Number(parsed.estimated_total || 0)

    const normalBookingTotal = customTotal > 0
      ? customTotal
      : estimatedTotal > 0
        ? estimatedTotal
        : Number(parsed.total_price) > 0
          ? Number(parsed.total_price)
          : base + staffing

    const safeTotal = mountainViewPricing?.totalPrice ?? normalBookingTotal
    const deposit = mountainViewPricing?.depositAmount ?? safeTotal * 0.5
    const balance = mountainViewPricing?.balanceDue ?? safeTotal - deposit

    const eventData = {
      customer_id: customer.id,
      event_date: parsed.event_date,
      location: parsed.location,
      start_time: parsed.start_time,
      hours,

      // 🔥 MATCH SCHEMA
      bartenders_needed: bartenders,

      base_price: 600,
      bartender_rate: 25,

      custom_total_price: isMountainView ? null : customTotal > 0 ? customTotal : null,
      total_price: safeTotal,
      deposit_amount: deposit,
      balance_due: balance,

      deposit_paid: false,
      balance_paid: false,

      status: "pending",
      event_status: "pending"
    }

    if (isMountainView) {
      console.log("🏔️ MOUNTAIN VIEW BOOKING:", {
        package_key: parsed.package_key,
        package_name: parsed.package_name,
        package_price: parsed.package_price,
        safeTotal,
        deposit,
        balance
      })
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
    const eventId = req.body.eventId || req.body.event_id

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
    const eventId = req.body.eventId || req.body.event_id

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
    const parsed = parseUpdatePrice(req.body)
    if (!parsed) {
      return res.status(400).json({ success: false, error: "Invalid payload" })
    }
    const { eventId, custom } = parsed

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
    const eventId = req.body.eventId || req.body.event_id
    const { bartenders } = req.body

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

// SAVE QUOTE (auto-save from booking page)
router.post("/save-quote", async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      location,
      event_date,
      start_time,
      hours,
      guests,
      bartenders,
      event_type,
      upgrades,
      estimated_total,
      deposit
    } = req.body

    if (!name || !email || !event_date) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    const { data, error } = await supabase
      .from("quotes")
      .insert([
        {
          name,
          email,
          phone,
          location,
          event_date,
          start_time,
          hours,
          guests,
          bartenders,
          event_type,
          upgrades,
          estimated_total,
          deposit,
          status: "pending"
        }
      ])
      .select()

    if (error) {
      console.error("❌ Quote save error:", error)
      return res.status(500).json({ error: "Failed to save quote" })
    }

    console.log("💾 QUOTE SAVED:", data?.[0]?.id)

    // 🔥 Send abandoned quote email
    try {
      await sendAbandonedQuoteEmail({
        name,
        email,
        event_date,
        location,
        estimated_total,
        deposit
      })
      console.log("📧 Abandoned quote email sent")
    } catch (emailErr) {
      console.error("❌ Abandoned quote email failed (non-blocking):", emailErr)
    }

    return res.json({ success: true })

  } catch (err) {
    console.error("❌ Save quote crash:", err)
    return res.status(500).json({ error: "Server error" })
  }
})

export default router