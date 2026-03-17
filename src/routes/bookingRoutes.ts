import express from "express"
import { calculateEventPricing } from "../services/pricingService"
import { supabase } from "../lib/supabase"

const router = express.Router()

// POST /api/book-event
// Creates a customer + event record and calculates pricing
router.post("/book-event", async (req: any, res: any) => {
  try {
    const {
      name,
      email,
      phone,
      event_date,
      location,
      guest_count,
      hours,
      bartenders
    } = req.body

    // Basic validation
    if (!name || !email || !event_date || hours === undefined || bartenders === undefined) {
      return res.status(400).json({
        error: "Missing required booking fields"
      })
    }

    // Prevent invalid numeric bookings
    if (Number(hours) <= 0 || Number(bartenders) <= 0) {
      return res.status(400).json({
        error: "Hours and bartenders must be greater than 0"
      })
    }

    // 1️⃣ Calculate pricing
    const pricing = calculateEventPricing({
      hours: Number(hours),
      bartenders: Number(bartenders)
    })

    // 2️⃣ Create customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert(
        {
          name,
          email,
          phone
        },
        { onConflict: "email" }
      )
      .select()
      .single()

    if (customerError) {
      console.error("Customer error:", customerError)
      return res.status(500).json({
        error: "Customer creation failed"
      })
    }

    // 3️⃣ Create event
    const { data: event, error: eventError } = await supabase
      .from("events")
      .insert([
        {
          customer_id: customer.id,
          event_date,
          location,
          guest_count: guest_count || null,
          hours: Number(hours),
          bartenders_needed: Number(bartenders),

          total_price: pricing.totalPrice,
          deposit_amount: pricing.depositAmount,
          balance_due: pricing.balanceDue,
          deposit_paid: false
        }
      ])
      .select()
      .single()

    if (eventError) {
      console.error("Event error:", eventError)
      return res.status(500).json({
        error: "Event creation failed"
      })
    }

    // 4️⃣ Return booking info
    res.json({
      success: true,
      event,
      pricing
    })
  } catch (error) {
    console.error("Booking error:", error)

    res.status(500).json({
      error: "Booking failed"
    })
  }
})

// GET /api/events
// Returns all events for the dashboard with customer details
router.get("/events", async (req: any, res: any) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select(`
        id,
        event_date,
        location,
        guest_count,
        hours,
        bartenders_needed,
        total_price,
        deposit_amount,
        balance_due,
        deposit_paid,
        customers (
          name,
          email
        )
      `)
      .order("event_date", { ascending: true })

    if (error) {
      console.error("Events fetch error:", error)
      return res.status(500).json({ error: "Failed to fetch events" })
    }

    // Flatten customer name for the dashboard
    const formatted = data.map((event: any) => ({
      ...event,
      name: event.customers?.name || "Unknown"
    }))

    res.json(formatted)
  } catch (error) {
    console.error("Dashboard fetch error:", error)
    res.status(500).json({ error: "Failed to fetch events" })
  }
})

export default router