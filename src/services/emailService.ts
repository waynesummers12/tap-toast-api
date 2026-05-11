import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY as string)
const INTERNAL_EMAILS = [
  "jen@coloradotapandtoast.com",
  "waynesummers12@gmail.com"
]

export async function sendBookingConfirmation(event: any) {
  try {
    await resend.emails.send({
      from: "Tap & Toast <jen@coloradotapandtoast.com>",
      to: event.customer_email || event.email,
      bcc: INTERNAL_EMAILS,
      subject: "🎉 Your Tap & Toast Event is Confirmed",
      html: `
        <h2>Your Tap & Toast Event is Reserved!</h2>

        <p>Hi ${event.customer_name || event.name},</p>

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

export async function sendInternalNotification(event: any) {
  try {
    await resend.emails.send({
      from: "Tap & Toast Alerts <jen@coloradotapandtoast.com>",
      to: ["jen@coloradotapandtoast.com", "waynesummers12@gmail.com"],
      subject: `🚨 New Booking - ${event.event_date}`,
      html: `
        <h2>New Booking 🚨</h2>
        <p><strong>Name:</strong> ${event.customer_name || event.name}</p>
        <p><strong>Email:</strong> ${event.customer_email || event.email}</p>
        <p><strong>Event Date:</strong> ${event.event_date}</p>
        <p><strong>Event Type:</strong> ${event.event_type || "N/A"}</p>
        <p><strong>Location:</strong> ${event.location || "N/A"}</p>
      `,
    })

    console.log("Internal notification email sent")
  } catch (error) {
    console.error("Internal email error:", error)
  }
}