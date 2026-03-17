

import { Router } from "express"

const router = Router()

// Temporary in‑memory store until Supabase wiring is added
interface Bartender {
  id: string
  name: string
  email?: string
  phone?: string
  rate: number
}

let bartenders: Bartender[] = []

// GET all bartenders
router.get("/", (req, res) => {
  res.json(bartenders)
})

// CREATE bartender
router.post("/create", (req, res) => {
  const { name, email, phone, rate } = req.body

  if (!name) {
    return res.status(400).json({ error: "Name required" })
  }

  const newBartender: Bartender = {
    id: crypto.randomUUID(),
    name,
    email,
    phone,
    rate: rate || 25
  }

  bartenders.push(newBartender)

  res.json({ success: true, bartender: newBartender })
})

// DELETE bartender
router.post("/delete", (req, res) => {
  const { id } = req.body

  bartenders = bartenders.filter((b) => b.id !== id)

  res.json({ success: true })
})

export default router