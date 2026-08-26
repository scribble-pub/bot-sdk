/// <reference types="node" />

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import ScribblePubBot from "../src/index.mjs"

const PORT = 3005
const BOT_TOKEN = process.env.BOT_TOKEN || "test-secret-token"

// Where the platform should send hooks, e.g., "http://localhost:3005/webhook"
const PUBLIC_URL = process.env.PUBLIC_URL

// Seeding from the clock keeps local IDs unique across restarts without any storage.
// A bot that persists state should count in its DB.
let localIdSeq = Date.now()
const nextLocalId = () => ++localIdSeq

const bot = new ScribblePubBot({
    token: BOT_TOKEN,
    baseUrl: process.env.API_BASE_URL,
})

bot.on("chat.addressed", (trigger) => {
    const parent = trigger.replyTo

    // A reply to the bot's own message gets the localId the bot sent it with.
    if (parent?.localId) {
        console.log(`[Bot] ${trigger.username} replied to own #${parent.localId}: '${parent.text}'`)
        return [
            {
                type: "chat.addMessage",
                text: parent.quoteText
                    ? `You quoted '${parent.quoteText}'.`
                    : `You replied '${trigger.text}'.`,
                localId: nextLocalId(),
                replyTo: { messageId: trigger.messageId },
            },
        ]
    }

    console.log(`[Bot] Addressed by ${trigger.username}`)
    return [
        {
            type: "chat.addMessage",
            text: `Hi ${trigger.username}! You wrote '${trigger.text}' to me.`,
            // Comes back as replyTo.localId when somebody replies to this message.
            localId: nextLocalId(),
            replyTo: { messageId: trigger.messageId },
        },
    ]
})

// Anything the handler above didn't take. Trigger types this SDK version doesn't support
// are acknowledged by the SDK and never get here.
bot.on("hook", (trigger) => {
    console.log(`[Bot] Unhandled trigger: ${trigger.type}`)
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
