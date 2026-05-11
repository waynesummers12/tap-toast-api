import express from "express"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { sendBookingConfirmation, sendInternalNotification } from "../services/emailService"
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
  "/api/webhook",
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
      console.log("🔥 Webhook received: checkout.session.completed")

      const eventId = session.metadata?.event_id
      const paymentType = session.metadata?.type || "deposit"
      const stripeSessionId = session.id
      const amount = session.amount_total || 0

      if (!eventId) {
        console.error("No event_id found in Stripe metadata")
        return res.json({ received: true })
      }

      console.log(`💰 Payment received (${paymentType}) for event:`, eventId)

      // Prevent duplicate processing
      const { data: existingPayment } = await supabase
        .from("payments")
        .select("stripe_session_id")
        .eq("stripe_session_id", stripeSessionId)
        .single()

      if (existingPayment) {
        console.log("Webhook already processed for session", stripeSessionId)
        return res.json({ received: true })
      }

      // ✅ SAVE PAYMENT (THIS WAS MISSING)
      await supabase.from("payments").insert({
        event_id: eventId,
        amount: amount,
        type: paymentType,
        status: "completed",
        stripe_session_id: stripeSessionId,
      })

      console.log("✅ Payment saved to database")

      if (paymentType === "deposit") {
        await supabase
          .from("events")
          .update({
            deposit_paid: true,
            event_status: "confirmed",
            stripe_session_id: stripeSessionId
          })
          .eq("id", eventId)

        const { data: eventData } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .single()

        if (eventData) {
          try {
            console.log("📧 Sending booking + internal emails...")
            await sendBookingConfirmation(eventData)
            await sendInternalNotification(eventData)
            await createCalendarEvent(eventData)
            console.log("✅ Emails + calendar event sent")
            console.log("✅ Deposit flow completed")
          } catch (err) {
            console.error("Post-deposit tasks failed", err)
          }
        }
      }

      if (paymentType === "balance") {
        await supabase
          .from("events")
          .update({
            balance_paid: true
          })
          .eq("id", eventId)

        const { data: eventData } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .single()

        if (eventData) {
          try {
            console.log("📧 Sending booking + internal emails (balance)...")
            await sendBookingConfirmation(eventData)
            await sendInternalNotification(eventData)
            console.log("✅ Emails sent (balance)")
            console.log("✅ Balance flow completed")
          } catch (err) {
            console.error("Post-balance tasks failed", err)
          }
        }
      }

      // 🚀 HANDLE UPGRADES
      if (paymentType === "upgrade") {
        console.log("🔥 Upgrade purchased for event:", eventId)

        // OPTIONAL: you can extend this later to update event fields
        // ex: add extra hours, premium bar, etc.
      }
    }

    res.json({ received: true })
  }
)

export default router