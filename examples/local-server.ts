/// <reference types="node" />

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import ScribblePubBot from "../src/index.mjs"

const PORT = 3005
const BOT_TOKEN = process.env.BOT_TOKEN || "test-secret-token"

const bot = new ScribblePubBot({ token: BOT_TOKEN })

bot.on("hook", async (req) => {
    console.log(`[Bot] Received event: ${req}`)
    return [
        {
            type: "addMessage",
            text: `Hi ${req.trigger.username}! You wrote '${req.trigger.text}' to me.`,
        },
    ]
})

const app = new Hono()

app.post("/webhook", async (c) => {
    console.log(`\n[Server] POST /webhook`)
    console.log(`[Server] Signature: ${c.req.header("x-scribble-pub-signature")}`)

    const res = await bot.handleHook(c.req.raw)

    console.log(`[Server] Responding with status: ${res.status}`)
    if (res.status >= 400) {
        console.log(`[Server] Error body:`, await res.clone().json())
    }
    return res
})

serve(
    {
        fetch: app.fetch,
        port: PORT,
    },
    (info) => {
        console.log(`🚀 Bot testing server is running on http://localhost:${info.port}/webhook`)
        console.log(`Using token: ${BOT_TOKEN}`)
        console.log(`Waiting for events from local platform instance...`)
    },
)
