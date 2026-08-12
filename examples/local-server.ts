/// <reference types="node" />

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import ScribblePubBot from "../src/index.mjs"

const PORT = 3005
const BOT_TOKEN = process.env.BOT_TOKEN || "test-secret-token"

// Where the platform should send hooks, e.g., "http://localhost:3005/webhook"
const PUBLIC_URL = process.env.PUBLIC_URL

const bot = new ScribblePubBot({
    token: BOT_TOKEN,
    baseUrl: process.env.API_BASE_URL,
})

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
    async (info) => {
        console.log(`🚀 Bot testing server is running on http://localhost:${info.port}/webhook`)
        console.log(`Using token: ${BOT_TOKEN}`)

        if (PUBLIC_URL) {
            try {
                await bot.registerWebhook(PUBLIC_URL)
                console.log(`[Bot] Registered webhook URL: ${PUBLIC_URL}`)
            } catch (err) {
                console.error(`[Bot] Failed to register webhook URL:`, err)
            }
        } else {
            console.log(`Set PUBLIC_URL to register this server's webhook URL on boot.`)
        }

        console.log(`Waiting for events from local platform instance...`)
    },
)
