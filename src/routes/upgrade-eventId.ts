

import express from "express"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

// POST /upgrade
router.post("/upgrade", async (req, res) => {
  try {
    const { eventId, upgradeType } = req.body

    if (!eventId || !upgradeType) {
      return res.status(400).json({ error: "Missing eventId or upgradeType" })
    }

    const { data: event, error } = await supabase
      .from("events")
      .select("*, customers(email, name)")
      .eq("id", eventId)
      .single()

    if (error || !event) {
      return res.status(404).json({ error: "Event not found" })
    }

    if (!event.customers?.email) {
      return res.status(400).json({ error: "Customer email not found for event" })
    }

    // Define upgrade pricing
    let price = 0
    let description = ""

    switch (upgradeType) {
      case "extra_hour":
        price = 100
        description = "Extra Hour of Service"
        break
      case "premium_drinks":
        price = 150
        description = "Premium Drink Package Upgrade"
        break
      case "extra_bartender":
        price = 200
        description = "Additional Bartender"
        break
      default:
        return res.status(400).json({ error: "Invalid upgrade type" })
    }

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000"

    const successUrl = baseUrl.startsWith("http")
      ? `${baseUrl}/success?upgrade=true`
      : `http://${baseUrl}/success?upgrade=true`

    const cancelUrl = baseUrl.startsWith("http")
      ? `${baseUrl}/dashboard`
      : `http://${baseUrl}/dashboard`

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: event.customers?.email,

      metadata: {
        event_id: event.id,
        type: "upsell",
        upgrade_type: upgradeType,
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: description,
            },
            unit_amount: price * 100,
          },
          quantity: 1,
        },
      ],

      success_url: successUrl,
      cancel_url: cancelUrl,
    })

    return res.json({ url: session.url })
  } catch (err) {
    console.error("Upgrade checkout error", err)
    return res.status(500).json({ error: "Server error" })
  }
})

export default router