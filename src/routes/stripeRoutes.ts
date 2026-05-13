import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"
import { sendEmail } from "../lib/email"
import { sendBalancePaymentEmail } from "../services/emailService"

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

// CREATE CHECKOUT SESSION (used by dashboard)
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { event_id, type } = req.body

    const event = await getEvent(event_id)

    const isDeposit = type === "deposit"

    const amount = isDeposit
      ? event.deposit_amount
      : event.balance_due

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      customer_email: event.customer?.email || event.email || undefined,

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: isDeposit
                ? "Tap & Toast Event Deposit"
                : "Tap & Toast Event Balance",
            },
            unit_amount: Math.round((amount || 0) * 100),
          },
          quantity: 1,
        },
      ],

      success_url: `https://www.coloradotapandtoast.com/success?event_id=${event_id}`,
      cancel_url: `https://www.coloradotapandtoast.com/book`,

      metadata: {
        event_id,
        type,
      },
    })

    res.json({
      success: true, // 🔥 REQUIRED
      url: session.url,
    })

  } catch (err) {
    console.error("Stripe session error", err)
    res.status(500).json({ error: "Failed to create session" })
  }
})

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

    // Send email with payment link
    await sendEmail({
      to: event.customer?.email,
      subject: "Complete Your Deposit – Colorado Tap & Toast",
      html: `
        <p>Hi ${event.customer?.name || "there"},</p>

        <p>Please secure your event date by completing your deposit below:</p>

        <p>
          <a href="${session.url as string}" target="_blank">
            Pay Deposit
          </a>
        </p>

        <p>We look forward to serving you!</p>
        <p>— Colorado Tap & Toast</p>
      `,
    })

    res.json({ success: true, url: session.url as string })
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

    // Send styled balance email
    await sendBalancePaymentEmail(event, session.url as string)

    res.json({ success: true, url: session.url as string })
  } catch (err) {
    console.error("Balance link error:", err)
    res.status(500).json({ error: "Failed to send balance link" })
  }
})

// STRIPE WEBHOOK - MARK EVENT PAID
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"] as string

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    )

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session

      const eventId = session.metadata?.event_id
      const type = session.metadata?.type

      if (!eventId) {
        console.error("No event_id in metadata")
        return res.status(400).send("Missing event_id")
      }

      if (type === "deposit") {
        await supabase
          .from("events")
          .update({
            deposit_paid: true,
            event_status: "confirmed",
          })
          .eq("id", eventId)

        console.log("Deposit marked paid for event:", eventId)
      }

      if (type === "balance") {
        await supabase
          .from("events")
          .update({
            balance_due: 0,
            deposit_paid: true,
            balance_paid: true,
            event_status: "confirmed",
          })
          .eq("id", eventId)

        console.log("Balance marked paid for event:", eventId)
      }
    }

    res.json({ received: true })
  } catch (err) {
    console.error("Webhook error:", err)
    res.status(400).send(`Webhook Error: ${err}`)
  }
})

export default router