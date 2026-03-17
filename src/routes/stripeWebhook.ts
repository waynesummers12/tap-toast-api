import express from "express"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { sendBookingConfirmation } from "../services/emailService"
import { createCalendarEvent } from "../services/calendarService"

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

router.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET as string
      )
    } catch (err: any) {
      console.error("Webhook signature verification failed.", err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session

      const eventId = session.metadata?.event_id
      const paymentType = session.metadata?.type || "deposit"
      const stripeSessionId = session.id

      if (!eventId) {
        console.error("No event_id found in Stripe metadata")
        return res.json({ received: true })
      }

      console.log(`Stripe ${paymentType} payment confirmed for event:`, eventId)

      const { data: existingEvent } = await supabase
        .from("events")
        .select("stripe_session_id, balance_paid")
        .eq("id", eventId)
        .single()

      if (existingEvent?.stripe_session_id === stripeSessionId) {
        console.log("Webhook already processed for session", stripeSessionId)
        return res.json({ received: true })
      }

      if (paymentType === "deposit") {
        const { error } = await supabase
          .from("events")
          .update({
            deposit_paid: true,
            event_status: "confirmed",
            stripe_session_id: stripeSessionId
          })
          .eq("id", eventId)

        if (error) {
          console.error("Supabase update error:", error)
          return res.json({ received: true })
        }

        const { data: eventData } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .single()

        if (eventData) {
          try {
            await sendBookingConfirmation(eventData)
            await createCalendarEvent(eventData)
          } catch (err) {
            console.error("Post-payment tasks failed", err)
          }
        }

        console.log("Deposit marked paid for event", eventId)
      }

      if (paymentType === "balance") {
        const { error } = await supabase
          .from("events")
          .update({
            balance_paid: true
          })
          .eq("id", eventId)

        if (error) {
          console.error("Balance payment update error:", error)
          return res.json({ received: true })
        }

        console.log("Balance marked paid for event", eventId)
      }
    }

    res.json({ received: true })
  }
)

export default router