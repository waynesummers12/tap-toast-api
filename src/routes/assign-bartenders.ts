import { Router } from "express"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "../middleware/auth"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type BartenderInput = {
  id: string
  hours?: number
  pay?: number
}

type BartenderRoster = {
  id?: string
  name: string
  phone?: string
  pay_rate?: number
}

type AssignBartendersPayload = {
  eventId?: string
  event_id?: string
  bartenders: BartenderInput[]
}

function validateAssignPayload(body: any): { eventId: string; bartenders: BartenderInput[] } | null {
  const eventId = body?.eventId || body?.event_id
  const bartenders = body?.bartenders

  if (!eventId) return null
  if (!Array.isArray(bartenders)) return null

  const valid = bartenders.every(
    (b: any) => typeof b.id === "string"
  )

  if (!valid) return null

  return { eventId, bartenders }
}

// Get bartender roster
router.get("/bartenders", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bartenders")
      .select("id, name, phone, pay_rate")
      .order("name", { ascending: true })

    if (error) {
      console.error(error)
      return res.status(500).json({ error: "Failed to fetch bartenders" })
    }

    res.json(data || [])
  } catch (err) {
    console.error("fetch bartenders error", err)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Add bartender to roster
router.post("/bartenders", requireAdmin, async (req, res) => {
  try {
    const { name, phone, pay_rate } = req.body as BartenderRoster

    if (!name) {
      return res.status(400).json({ error: "name is required" })
    }

    const { data, error } = await supabase
      .from("bartenders")
      .insert({ name, phone: phone ?? null, pay_rate: pay_rate ?? null })
      .select()
      .single()

    if (error) {
      console.error(error)
      return res.status(500).json({ error: "Failed to create bartender" })
    }

    res.json({ success: true, bartender: data })
  } catch (err) {
    console.error("create bartender error", err)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Assign bartenders to an event
router.post("/events/assign-bartenders", requireAdmin, async (req, res) => {
  try {
    const parsed = validateAssignPayload(req.body)

    if (!parsed) {
      return res.status(400).json({
        error: "Invalid payload: expected eventId/event_id and bartenders[]"
      })
    }

    const { eventId, bartenders } = parsed

    if (bartenders.length === 0) {
      return res.status(400).json({
        error: "eventId and bartenders[] are required"
      })
    }

    // Remove existing bartender assignments
    const { error: deleteError } = await supabase
      .from("event_bartenders")
      .delete()
      .eq("event_id", eventId)

    if (deleteError) {
      console.error(deleteError)
      return res.status(500).json({ error: "Failed to clear existing assignments" })
    }

    // Create rows for new assignments
    const rows = bartenders.map((b) => ({
      event_id: eventId,
      bartender_id: b.id,
      hours: b.hours ?? null,
      pay: b.pay ?? null
    }))

    const { error: insertError } = await supabase
      .from("event_bartenders")
      .insert(rows)

    if (insertError) {
      console.error(insertError)
      return res.status(500).json({ error: "Failed to assign bartenders" })
    }

    const { count } = await supabase
      .from("event_bartenders")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)

    res.json({
      success: true,
      event_id: eventId,
      assigned_count: count || 0
    })

  } catch (error) {
    console.error("assign-bartenders error", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

export default router