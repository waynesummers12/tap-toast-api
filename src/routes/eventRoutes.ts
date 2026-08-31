import { Router } from "express"
import { createClient } from "@supabase/supabase-js"
import {
  calculateMountainViewPricing,
  calculateNormalBookingPricing,
  NormalBookingMode,
  NormalPricingTier,
} from "../services/pricingService"
import { requireAdmin } from "../middleware/auth"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

type CreateEventPayload = {
  cid?: string
  name: string
  email: string
  phone?: string
  event_date: string
  location: string
  start_time: string
  hours: number
  bartenders: number
  venue?: string
  package_key?: string
  package_name?: string
  package_price?: number
  guests?: number
  booking_mode?: NormalBookingMode
  pricing_tier?: NormalPricingTier
  rental_delivery_selected?: boolean
  rental_ice_cooler_selected?: boolean
  setup_hour_selected?: boolean
  cocktail_tap_quantity?: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isStringInRange(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

function parseCreateEvent(body: any): CreateEventPayload | null {
  if (!body) return null
  const required = ["name","email","event_date","location","start_time"]
  for (const k of required) {
    if (!body[k]) return null
  }
  if (body.cid && !UUID_PATTERN.test(String(body.cid))) return null
  return {
    cid: body.cid ? String(body.cid) : undefined,
    name: String(body.name),
    email: String(body.email),
    phone: body.phone ? String(body.phone) : undefined,
    event_date: String(body.event_date),
    location: String(body.location),
    start_time: String(body.start_time),
    hours: Number(body.hours || 0),
    bartenders: Number(body.bartenders || 0),
    venue: body.venue ? String(body.venue) : undefined,
    package_key: body.package_key ? String(body.package_key) : undefined,
    package_name: body.package_name ? String(body.package_name) : undefined,
    package_price: body.package_price ? Number(body.package_price) : undefined,
    guests: body.guests !== undefined ? Number(body.guests) : undefined,
    booking_mode: body.booking_mode,
    pricing_tier: body.pricing_tier,
    rental_delivery_selected: body.rental_delivery_selected,
    rental_ice_cooler_selected: body.rental_ice_cooler_selected,
    setup_hour_selected: body.setup_hour_selected,
    cocktail_tap_quantity: Number(body.cocktail_tap_quantity),
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

    const normalPricing = isMountainView ? null : calculateNormalBookingPricing({
      bookingMode: parsed.booking_mode as NormalBookingMode,
      pricingTier: parsed.pricing_tier as NormalPricingTier,
      hours: parsed.hours,
      bartenders: parsed.bartenders,
      guests: Number(parsed.guests),
      rentalDeliverySelected: parsed.rental_delivery_selected as boolean,
      rentalIceCoolerSelected: parsed.rental_ice_cooler_selected as boolean,
      setupHourSelected: parsed.setup_hour_selected as boolean,
      cocktailTapQuantity: Number(parsed.cocktail_tap_quantity),
    })

    if (!isMountainView && !normalPricing) {
      return res.status(400).json({ error: "Invalid normal pricing selections" })
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

    const hours = mountainViewPricing?.serviceHours ?? normalPricing!.hours
    const bartenders = mountainViewPricing?.bartendersNeeded ?? normalPricing!.bartenders
    const safeTotal = mountainViewPricing?.totalPrice ?? normalPricing!.totalPrice
    const deposit = mountainViewPricing?.depositAmount ?? normalPricing!.depositAmount
    const balance = mountainViewPricing?.balanceDue ?? normalPricing!.balanceDue

    const eventData = {
      customer_id: customer.id,
      event_date: parsed.event_date,
      location: parsed.location,
      start_time: parsed.start_time,
      hours,

      // 🔥 MATCH SCHEMA
      bartenders_needed: bartenders,
      guest_count: parsed.guests ?? null,
      ...(mountainViewPricing
        ? {
            venue: mountainViewPricing.venue,
            package_key: mountainViewPricing.packageKey,
            package_name: mountainViewPricing.packageName
          }
        : {}),
      ...(!isMountainView && normalPricing
        ? {
            pricing_version: normalPricing.pricingVersion,
            booking_mode: normalPricing.bookingMode,
            pricing_tier: normalPricing.pricingTier,
            rental_delivery_selected: normalPricing.rentalDeliverySelected,
            rental_ice_cooler_selected: normalPricing.rentalIceCoolerSelected,
            setup_hour_selected: normalPricing.setupHourSelected,
            cocktail_tap_quantity: normalPricing.cocktailTapQuantity,
          }
        : {}),

      base_price: 600,
      bartender_rate: mountainViewPricing ? 25 : normalPricing!.bartenderRate,

      custom_total_price: null,
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

    res.json({ success: true, event, cid: parsed.cid })

  } catch (err) {
    console.error("Create event error:", err)
    res.status(500).json({ error: "Failed to create event" })
  }
})

// GET all events
router.get("/", requireAdmin, async (req, res) => {
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

router.get("/:eventId/payment-status", async (req, res) => {
  try {
    const { eventId } = req.params
    const paymentType = req.query.type === "balance" ? "balance" : "deposit"
    if (!UUID_PATTERN.test(eventId)) {
      return res.status(400).json({ success: false, error: "Invalid event id" })
    }

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, deposit_paid, balance_paid, event_status")
      .eq("id", eventId)
      .maybeSingle()

    if (eventError) throw eventError
    if (!event) {
      return res.status(404).json({ success: false, deposit_confirmed: false })
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id")
      .eq("event_id", eventId)
      .eq("type", paymentType)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle()

    if (paymentError) throw paymentError

    const eventPaymentConfirmed = paymentType === "deposit"
      ? event.deposit_paid === true
      : event.balance_paid === true
    const paymentConfirmed =
      eventPaymentConfirmed &&
      event.event_status === "confirmed" &&
      Boolean(payment)

    return res.json({ success: true, payment_confirmed: paymentConfirmed })
  } catch (err) {
    console.error("Payment status error:", err)
    return res.status(500).json({ success: false, error: "Failed to verify payment" })
  }
})

// MARK EVENT FULLY PAID
router.post("/mark-paid", requireAdmin, async (req, res) => {
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
router.post("/cancel", requireAdmin, async (req, res) => {
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

router.post("/update-price", requireAdmin, async (req, res) => {
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

router.get("/:id/bartenders", requireAdmin, async (req, res) => {
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
router.post("/assign-bartenders", requireAdmin, async (req, res) => {
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
      cid,
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

    if (!cid || !UUID_PATTERN.test(String(cid))) {
      return res.status(400).json({ error: "Invalid cid" })
    }

    const hasValue = (value: unknown) => value !== undefined && value !== null && value !== ""
    const validUpgrades = upgrades === undefined || (
      Array.isArray(upgrades) && upgrades.length <= 20 &&
      upgrades.every((value) => isStringInRange(value, 1, 50))
    )
    const validPayload =
      isStringInRange(name, 1, 100) &&
      isStringInRange(email, 3, 254) && EMAIL_PATTERN.test(email) &&
      (phone === undefined || phone === null || isStringInRange(phone, 0, 30)) &&
      (!hasValue(location) || isStringInRange(location, 1, 300)) &&
      typeof event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event_date) &&
      (!hasValue(start_time) || (typeof start_time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(start_time))) &&
      (!hasValue(hours) || isIntegerInRange(hours, 1, 10)) &&
      (!hasValue(guests) || isIntegerInRange(guests, 1, 300)) &&
      (!hasValue(bartenders) || isIntegerInRange(bartenders, 0, 5)) &&
      (!hasValue(event_type) || isStringInRange(event_type, 1, 100)) &&
      validUpgrades &&
      (!hasValue(estimated_total) || (Number.isFinite(estimated_total) && estimated_total >= 0 && estimated_total <= 1000000)) &&
      (!hasValue(deposit) || (Number.isFinite(deposit) && deposit >= 0 && deposit <= 1000000))

    if (!validPayload) {
      return res.status(400).json({ error: "Invalid quote payload" })
    }

    const { data: existingQuote, error: lookupError } = await supabase
      .from("quotes")
      .select("status, converted, email")
      .eq("cid", cid)
      .maybeSingle()

    if (lookupError) {
      console.error("❌ Quote lookup failed")
      return res.status(500).json({ error: "Failed to save quote" })
    }

    if (existingQuote?.converted === true || existingQuote?.status === "converted") {
      return res.json({ success: true, cid, converted: true })
    }

    if (existingQuote?.email && existingQuote.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(409).json({ error: "Quote email cannot be changed" })
    }

    const { data, error } = await supabase
      .from("quotes")
      .upsert([
        {
          cid,
          name,
          email,
          event_date,
          ...(hasValue(phone) ? { phone } : {}),
          ...(hasValue(location) ? { location } : {}),
          ...(hasValue(start_time) ? { start_time } : {}),
          ...(hasValue(hours) ? { hours } : {}),
          ...(hasValue(guests) ? { guests } : {}),
          ...(hasValue(bartenders) ? { bartenders } : {}),
          ...(hasValue(event_type) ? { event_type } : {}),
          ...(upgrades !== undefined ? { upgrades } : {}),
          ...(hasValue(estimated_total) ? { estimated_total } : {}),
          ...(hasValue(deposit) ? { deposit } : {}),
          updated_at: new Date().toISOString()
        }
      ], { onConflict: "cid" })
      .select()

    if (error) {
      console.error("❌ Quote save error:", error)
      return res.status(500).json({ error: "Failed to save quote" })
    }

    const { error: statusError } = await supabase
      .from("quotes")
      .update({ status: "pending" })
      .eq("cid", cid)
      .or("converted.is.null,converted.eq.false")

    if (statusError) {
      console.error("❌ Quote status update failed")
      return res.status(500).json({ error: "Failed to save quote" })
    }

    console.log("💾 QUOTE SAVED:", data?.[0]?.id)

    return res.json({ success: true, cid })

  } catch (err) {
    console.error("❌ Save quote crash:", err)
    return res.status(500).json({ error: "Server error" })
  }
})

export default router