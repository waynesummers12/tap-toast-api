import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

router.post("/create-checkout-session", async (req, res) => {
  try {

    const { event_id, landing_page } = req.body

    const { data: event, error } = await supabase
      .from("events")
      .select(`
        *,
        customer:customers (
          id,
          name,
          email,
          phone
        )
      `)
      .eq("id", event_id)
      .single()

    if (error || !event) {
      return res.status(404).json({ error: "Event not found" })
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      customer_email: event.customer?.email || undefined,

      metadata: {
        event_id: event.id,
        name: event.customer?.name || event.name || "",
        email: event.customer?.email || event.email || "",
        phone: event.customer?.phone || "",
        event_date: event.event_date || "",
        event_type: event.event_type || "",
        guests: String(event.guests || ""),
        bartenders: String(event.bartenders || ""),
        hours: String(event.hours || ""),
        upgrades: JSON.stringify(event.upgrades || []),
        landing_page: landing_page || "unknown",
        type: "deposit"
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tap & Toast Event Deposit"
            },
            unit_amount: Math.round((event.deposit_amount || 0) * 100)
          },
          quantity: 1
        }
      ],

      success_url: `https://www.coloradotapandtoast.com/success?event_id=${event.id}`,
      cancel_url: "https://www.coloradotapandtoast.com/book"
    })

    res.json({
      url: session.url
    })

  } catch (error) {

    console.error("Stripe session error:", error)

    res.status(500).json({
      error: "Stripe session failed"
    })
  }
})

module.exports = router
module.exports.default = router