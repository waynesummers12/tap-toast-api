import express from "express"
import { supabase } from "../lib/supabase"
import { sendEmail } from "../lib/email"

const router = express.Router()

router.post("/reminder", async (req, res) => {
  try {
    const { eventId, type } = req.body

    if (!eventId || !type) {
      return res.status(400).json({ error: "Missing eventId or type" })
    }

    // Get event + customer
    const { data: event, error } = await supabase
      .from("events")
      .select(`
        *,
        customers (
          name,
          email
        )
      `)
      .eq("id", eventId)
      .single()

    if (error || !event) {
      return res.status(404).json({ error: "Event not found" })
    }

    const customer = event.customers
    const eventDate = new Date(event.event_date).toLocaleDateString()

    let subject = ""
    let html = ""

    if (type === "deposit_reminder") {
      subject = "Reminder: Secure Your Event Date"

      html = `
        <p>Hi ${customer.name},</p>

        <p>This is a friendly reminder to secure your event date.</p>

        <p><strong>Event:</strong> ${eventDate}</p>
        <p><strong>Deposit Due:</strong> $${event.deposit_amount}</p>

        <p>Please complete your deposit at your earliest convenience.</p>

        <p>— Colorado Tap & Toast</p>
      `
    }

    if (type === "balance_reminder") {
      subject = "Reminder: Final Payment Due"

      html = `
        <p>Hi ${customer.name},</p>

        <p>Your event is coming up soon!</p>

        <p><strong>Event:</strong> ${eventDate}</p>
        <p><strong>Remaining Balance:</strong> $${event.balance_due}</p>

        <p>Please complete your final payment prior to your event.</p>

        <p>— Colorado Tap & Toast</p>
      `
    }

    await sendEmail({
      to: customer.email,
      subject,
      html,
    })

    return res.json({ success: true })

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Failed to send reminder" })
  }
})

export default router