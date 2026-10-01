import express from "express"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

import { upgradeOption } from "../services/upgradeService"

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

    const option = upgradeOption(upgradeType)
    if (!option) return res.status(400).json({ error: "Invalid upgrade type" })
    if (!event.deposit_paid || event.event_status !== "confirmed") {
      return res.status(409).json({ error: "Only confirmed bookings can be upgraded" })
    }

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000"

    const successUrl = baseUrl.startsWith("http")
      ? `${baseUrl}/success?upgrade=true&event_id=${event.id}&session_id={CHECKOUT_SESSION_ID}`
      : `http://${baseUrl}/success?upgrade=true&event_id=${event.id}&session_id={CHECKOUT_SESSION_ID}`

    const cancelUrl = baseUrl.startsWith("http")
      ? `${baseUrl}/upgrade?eventId=${event.id}`
      : `http://${baseUrl}/upgrade?eventId=${event.id}`

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
              name: option.label,
            },
            unit_amount: option.cents,
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