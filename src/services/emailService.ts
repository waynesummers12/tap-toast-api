

import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendBookingConfirmation(event: any) {
  try {
    await resend.emails.send({
      from: "Tap & Toast <bookings@tapandtoast.org>",
      to: event.email,
      subject: "🎉 Your Tap & Toast Event is Confirmed",
      html: `
        <h2>Your Tap & Toast Event is Reserved!</h2>

        <p>Hi ${event.name},</p>

        <p>Your deposit has been received and your event is officially booked.</p>

        <p><strong>Event Details</strong></p>

        <p>
        Location: ${event.location}<br/>
        Date: ${event.event_date}<br/>
        Hours: ${event.hours}<br/>
        Bartenders: ${event.bartenders}
        </p>

        <p>Final payment will be due 10 days before the event.</p>

        <p>Cheers! 🍸</p>
        <p>Tap & Toast</p>
      `
    })

    console.log("Confirmation email sent")
  } catch (error) {
    console.error("Email error:", error)
  }
}