import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

router.post("/create-checkout-session", async (req, res) => {
  try {

    const { event_id } = req.body

    const { data: event, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", event_id)
      .single()

    if (error || !event) {
      return res.status(404).json({ error: "Event not found" })
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      customer_email: "jen@coloradotapandtoast.com",

      metadata: {
        event_id: event.id
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tap & Toast Event Deposit"
            },
            unit_amount: event.deposit_amount * 100
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