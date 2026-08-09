import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import ScribblePubBot from "../src/index.mjs"
import type { HookRequest, HookResponse } from "../src/schemas.js"

const TOKEN = "test-secret-token"

async function sign(token: string, payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(token),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    )
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
    const sigHex = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    return `sha256=${sigHex}`
}

function appWithBot(bot: ScribblePubBot) {
    const app = new Hono()
    app.post("/webhook", (c) => bot.handleHook(c.req.raw))
    return app
}

describe("scribble.pub bot with Hono", () => {
    it("handles webhook correctly with Hono", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })

        bot.on("hook", async (req) => {
            return [
                {
                    type: "addMessage",
                    text: `Responding to ${req.trigger.username} who wrote '${req.trigger.text}'`,
                },
            ]
        })

        const payload = JSON.stringify({
            trigger: {
                trigger: "chat.mention",
                text: "@TestBot hello",
                room: "main",
                timestamp: 1779999999999,
                username: "TheBestArtist",
            },
        } as HookRequest)

        const res = await appWithBot(bot).request("/webhook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Scribble-Pub-Signature": await sign(TOKEN, payload),
            },
            body: payload,
        })

        expect(res.status).toBe(200)

        const data = await res.json()
        expect(data).toEqual({
            actions: [
                {
                    type: "addMessage",
                    text: "Responding to TheBestArtist who wrote '@TestBot hello'",
                },
            ],
        } as HookResponse)
    })

    it("rejects invalid signature", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })

        const res = await appWithBot(bot).request("/webhook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Scribble-Pub-Signature": "sha256=invalid-signature-here",
            },
            body: JSON.stringify({ event: "message" }),
        })

        expect(res.status).toBe(401)
    })

    it("rejects malformed JSON", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })
        bot.on("hook", async () => [])

        const payload = "{not valid json"

        const res = await appWithBot(bot).request("/webhook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Scribble-Pub-Signature": await sign(TOKEN, payload),
            },
            body: payload,
        })

        expect(res.status).toBe(400)
    })

    it("rejects a payload that doesn't match the HookRequest schema", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })
        bot.on("hook", async () => [])

        const payload = JSON.stringify({ event: "message" })

        const res = await appWithBot(bot).request("/webhook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Scribble-Pub-Signature": await sign(TOKEN, payload),
            },
            body: payload,
        })

        expect(res.status).toBe(400)

        const data = await res.json()
        expect(data.error).toBe("invalid payload")
        expect(data.details).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "trigger" })]),
        )
    })

    it("rejects when no handler is registered", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })

        const payload = JSON.stringify({
            trigger: {
                trigger: "chat.mention",
                text: "@TestBot hello",
                room: "main",
                timestamp: 1779999999999,
                username: "TheBestArtist",
            },
        } as HookRequest)

        const res = await appWithBot(bot).request("/webhook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Scribble-Pub-Signature": await sign(TOKEN, payload),
            },
            body: payload,
        })

        expect(res.status).toBe(501)
    })

    it("rejects when the handler returns invalid actions", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })
        // @ts-expect-error intentionally returning a malformed action to test the guardrail
        bot.on("hook", async () => [{ type: "addMessage" }])

        const payload = JSON.stringify({
            trigger: {
                trigger: "chat.mention",
                text: "@TestBot hello",
                room: "main",
                timestamp: 1779999999999,
                username: "TheBestArtist",
            },
        } as HookRequest)

        const res = await appWithBot(bot).request("/webhook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Scribble-Pub-Signature": await sign(TOKEN, payload),
            },
            body: payload,
        })

        expect(res.status).toBe(500)

        const data = await res.json()
        expect(data.error).toBe("handler returned invalid actions")
        expect(data.details).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "actions.0.text" })]),
        )
    })
})
