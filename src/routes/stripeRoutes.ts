import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

// Helper to fetch event
const getEvent = async (eventId: string) => {
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
    .eq("id", eventId)
    .single()

  if (error || !event) {
    throw new Error("Event not found")
  }

  return event
}

// SEND DEPOSIT PAYMENT LINK
router.post("/send-deposit", async (req, res) => {
  try {
    const { eventId } = req.body

    const event = await getEvent(eventId)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      customer_email: event.customer?.email || undefined,

      metadata: {
        event_id: event.id,
        type: "deposit",
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tap & Toast Event Deposit",
            },
            unit_amount: Math.round((event.deposit_amount || 0) * 100),
          },
          quantity: 1,
        },
      ],

      success_url: `https://www.coloradotapandtoast.com/success?event_id=${event.id}`,
      cancel_url: "https://www.coloradotapandtoast.com/book",
    })

    res.json({ success: true, url: session.url })
  } catch (err) {
    console.error("Deposit link error:", err)
    res.status(500).json({ error: "Failed to send deposit link" })
  }
})

// SEND BALANCE PAYMENT LINK
router.post("/send-balance", async (req, res) => {
  try {
    const { eventId } = req.body

    const event = await getEvent(eventId)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      customer_email: event.customer?.email || undefined,

      metadata: {
        event_id: event.id,
        type: "balance",
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tap & Toast Event Balance",
            },
            unit_amount: Math.round((event.balance_due || 0) * 100),
          },
          quantity: 1,
        },
      ],

      success_url: `https://www.coloradotapandtoast.com/success?event_id=${event.id}`,
      cancel_url: "https://www.coloradotapandtoast.com/book",
    })

    res.json({ success: true, url: session.url })
  } catch (err) {
    console.error("Balance link error:", err)
    res.status(500).json({ error: "Failed to send balance link" })
  }
})

export default router