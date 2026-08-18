import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import ScribblePubBot, {
    ScribblePubApiError,
    ScribblePubValidationError,
    type ValidationError,
} from "../src/index.mjs"
import type { Action, HookRequest, HookResponse, Trigger } from "../src/index.mjs"

const TOKEN = "test-secret-token"
const AP = "https://ap.scribble.pub"

function hookPayload(overrides: Partial<Trigger> = {}): HookRequest {
    return {
        trigger: {
            trigger: "chat.mention",
            text: "@TestBot hello",
            room: "main",
            timestamp: 1779999999999,
            username: "TheBestArtist",
            directUrl: "https://eu.scribble.pub",
            ...overrides,
        },
    }
}

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

        bot.on("hook", (req) => {
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
                directUrl: "https://eu.scribble.pub",
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

    it("acknowledges with an empty list when the handler returns nothing", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })

        bot.on("hook", () => undefined)

        const payload = JSON.stringify({
            trigger: {
                trigger: "chat.mention",
                text: "@TestBot hello",
                room: "main",
                timestamp: 1779999999999,
                username: "TheBestArtist",
                directUrl: "https://eu.scribble.pub",
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
        expect(await res.json()).toEqual({ actions: [] } as HookResponse)
    })

    it("awaits an async handler before answering", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })

        bot.on("hook", async (req) => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            return [{ type: "addMessage", text: `Hi, ${req.trigger.username}!` }]
        })

        const payload = JSON.stringify({
            trigger: {
                trigger: "chat.mention",
                text: "@TestBot hello",
                room: "main",
                timestamp: 1779999999999,
                username: "TheBestArtist",
                directUrl: "https://eu.scribble.pub",
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
        expect(await res.json()).toEqual({
            actions: [{ type: "addMessage", text: "Hi, TheBestArtist!" }],
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
        bot.on("hook", () => [])

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
        bot.on("hook", () => [])

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
                directUrl: "https://eu.scribble.pub",
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
        bot.on("hook", () => [{ type: "addMessage" }])

        const payload = JSON.stringify({
            trigger: {
                trigger: "chat.mention",
                text: "@TestBot hello",
                room: "main",
                timestamp: 1779999999999,
                username: "TheBestArtist",
                directUrl: "https://eu.scribble.pub",
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

describe("registerWebhook", () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function stubFetch(response: Response) {
        const fetchMock = vi.fn<typeof fetch>(async (url) => {
            if (!response.url) Object.defineProperty(response, "url", { value: url.toString() })
            return response
        })
        vi.stubGlobal("fetch", fetchMock)
        return fetchMock
    }

    it("posts the URL to the register endpoint with the bot token", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN })

        await bot.registerWebhook("https://example.com/hook")

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe("https://scribble.pub/api/v0/bot/webhook/register")
        expect(init.method).toBe("POST")
        expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`)
        expect(JSON.parse(init.body as string)).toEqual({ url: "https://example.com/hook" })
    })

    it("targets a custom baseUrl and trims its trailing slash", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN, baseUrl: "http://localhost:8080/" })

        await bot.registerWebhook("http://localhost:3005/webhook")

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "http://localhost:8080/api/v0/bot/webhook/register",
        )
    })

    it("rejects a malformed URL without hitting the network", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN })

        await expect(bot.registerWebhook("not-a-url")).rejects.toThrow(/invalid webhook URL/)
        await expect(bot.registerWebhook("ftp://example.com/hook")).rejects.toThrow(
            /invalid webhook URL/,
        )
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("throws a ScribblePubApiError carrying the platform's status and body", async () => {
        stubFetch(
            new Response("Bad Request: url must start with http:// or https://\n", {
                status: 400,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
            }),
        )
        const bot = new ScribblePubBot({ token: TOKEN })

        const error = await bot.registerWebhook("https://example.com/hook").catch((e) => e)

        expect(error).toBeInstanceOf(ScribblePubApiError)
        expect(error.status).toBe(400)
        expect(error.body).toBe("Bad Request: url must start with http:// or https://")
        expect(error.message).toBe(
            "failed to register webhook: https://scribble.pub/api/v0/bot/webhook/register" +
                " returned 400 Bad Request: url must start with http:// or https://",
        )
    })

    it("falls back to the status text when the error body is empty", async () => {
        stubFetch(new Response("", { status: 502, statusText: "Bad Gateway" }))
        const bot = new ScribblePubBot({ token: TOKEN })

        const error = await bot.registerWebhook("https://example.com/hook").catch((e) => e)

        expect(error).toBeInstanceOf(ScribblePubApiError)
        expect(error.status).toBe(502)
        expect(error.body).toBe("Bad Gateway")
    })
})

describe("sendActions", () => {
    const HELLO = [{ type: "addMessage", text: "hi" }] as const satisfies Action[]

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    /** A 2xx response that `fetch` produced after following a redirect to `finalUrl` */
    function redirectedTo(finalUrl: string): Response {
        const res = Response.json({ ok: true })
        Object.defineProperty(res, "redirected", { value: true })
        Object.defineProperty(res, "url", { value: finalUrl })
        return res
    }

    function stubFetch(...responses: Response[]) {
        let call = 0
        const fetchMock = vi.fn<typeof fetch>(async (url) => {
            const res = responses[Math.min(call, responses.length - 1)]
            call++
            if (res && !res.url) Object.defineProperty(res, "url", { value: url.toString() })
            return res as Response
        })
        vi.stubGlobal("fetch", fetchMock)
        return fetchMock
    }

    it("posts to the pre-filled region for a known room, not the configured baseUrl", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN, baseUrl: "https://scribble.pub" })

        await bot.sendActions("main", [...HELLO])

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe("https://eu.scribble.pub/api/v0/room/main/actions")
        expect(init.method).toBe("POST")
        expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`)
        expect(JSON.parse(init.body as string)).toEqual({ actions: [...HELLO] })
    })

    it("looks the room up case-insensitively", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN })

        await bot.sendActions("MAIN", [...HELLO])

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "https://eu.scribble.pub/api/v0/room/MAIN/actions",
        )
    })

    it("does not use the production instance table when baseUrl points elsewhere", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN, baseUrl: "http://local.scribble.pub" })

        await bot.sendActions("main", [...HELLO])

        // Seeding production origins here would reach past the local instance into production.
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "http://local.scribble.pub/api/v0/room/main/actions",
        )
    })

    it("falls back to baseUrl for an unknown room", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN, baseUrl: "https://scribble.pub" })

        await bot.sendActions("brand-new-room", [...HELLO])

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "https://scribble.pub/api/v0/room/brand-new-room/actions",
        )
    })

    it("escapes the room id", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN, baseUrl: "https://scribble.pub" })

        await bot.sendActions("art/room #2", [...HELLO])

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "https://scribble.pub/api/v0/room/art%2Froom%20%232/actions",
        )
    })

    it("routes later calls to the region learned from a hook", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN, baseUrl: "https://scribble.pub" })
        bot.on("hook", () => undefined)

        const payload = JSON.stringify(hookPayload({ room: "Quiet", directUrl: AP }))
        await appWithBot(bot).request("/webhook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Scribble-Pub-Signature": await sign(TOKEN, payload),
            },
            body: payload,
        })

        await bot.sendActions("quiet", [...HELLO])

        expect(fetchMock.mock.calls[0]?.[0]).toBe(`${AP}/api/v0/room/quiet/actions`)
    })

    it("rejects malformed actions without hitting the network", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN })

        await expect(
            // @ts-expect-error intentionally malformed to test the guardrail
            bot.sendActions("main", [{ type: "addMessage" }]),
        ).rejects.toThrow(/invalid actions: actions\.0\.text/)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("throws a catchable ScribblePubValidationError listing every bad field", async () => {
        const bot = new ScribblePubBot({ token: TOKEN })

        const error = await bot
            // @ts-expect-error intentionally malformed to test the guardrail
            .sendActions("main", [{ type: "addMessage" }, { type: "nope", text: "x" }])
            .catch((e) => e)

        expect(error).toBeInstanceOf(ScribblePubValidationError)
        expect(error.errors.map((e: ValidationError) => e.path)).toEqual(
            expect.arrayContaining(["actions.0.text", "actions.1.type"]),
        )
        // The message still leads with the first failure, as it did before.
        expect(error.message).toMatch(/^invalid actions: actions\.0\.text/)
    })

    it("reports an empty room as a validation error", async () => {
        const fetchMock = stubFetch(Response.json({ ok: true }))
        const bot = new ScribblePubBot({ token: TOKEN })

        const error = await bot.sendActions("   ", [...HELLO]).catch((e) => e)

        expect(error).toBeInstanceOf(ScribblePubValidationError)
        expect(error.errors).toEqual([{ path: "room", message: "room is required" }])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([
        [403, "Forbidden: no permission to add a message"],
        [404, "Not Found: no such room"],
    ])("receives the %i error from the room endpoint", async (status, body) => {
        stubFetch(new Response(`${body}\n`, { status }))
        const bot = new ScribblePubBot({ token: TOKEN })

        const error = await bot.sendActions("main", [...HELLO]).catch((e) => e)

        expect(error).toBeInstanceOf(ScribblePubApiError)
        expect(error.status).toBe(status)
        expect(error.body).toBe(body)
        expect(error.message).toBe(
            `failed to send actions: https://eu.scribble.pub/api/v0/room/main/actions returned ${status} ${body}`,
        )
    })

    it("unwraps a JSON error envelope", async () => {
        stubFetch(Response.json({ error: "Room is not found" }, { status: 404 }))
        const bot = new ScribblePubBot({ token: TOKEN })

        const error = await bot.sendActions("main", [...HELLO]).catch((e) => e)

        expect(error).toBeInstanceOf(ScribblePubApiError)
        expect(error.status).toBe(404)
        expect(error.body).toBe("Room is not found")
        expect(error.message).toBe(
            "failed to send actions: https://eu.scribble.pub/api/v0/room/main/actions" +
                " returned 404 Room is not found",
        )
    })

    it("keeps the raw body when JSON contains no usable error field", async () => {
        stubFetch(new Response(`{"code":17}`, { status: 500 }))
        const bot = new ScribblePubBot({ token: TOKEN })

        const error = await bot.sendActions("main", [...HELLO]).catch((e) => e)

        expect(error.body).toBe(`{"code":17}`)
    })

    it("caches only the redirect origin, dropping its path and one-shot credential", async () => {
        const fetchMock = stubFetch(
            redirectedTo(`${AP}/api/v0/room/quiet/actions?t=ttl-token`),
            Response.json({ ok: true }),
        )
        const bot = new ScribblePubBot({ token: TOKEN, baseUrl: "https://scribble.pub" })

        await bot.sendActions("quiet", [...HELLO])
        await bot.sendActions("quiet", [...HELLO])

        expect(fetchMock.mock.calls[1]?.[0]).toBe(`${AP}/api/v0/room/quiet/actions`)
    })

    it("follows a real cross-origin 307, which drops the Authorization header", async () => {
        const served: {
            url: string | undefined
            method: string | undefined
            body: string
            auth: string | undefined
        }[] = []
        const region = createServer((req, res) => {
            let body = ""
            req.on("data", (c) => {
                body += c
            })
            req.on("end", () => {
                served.push({
                    url: req.url,
                    method: req.method,
                    body,
                    auth: req.headers.authorization,
                })
                res.writeHead(200, { "content-type": "application/json" })
                res.end(`{"ok":true}`)
            })
        })
        await new Promise<void>((r) => region.listen(0, "127.0.0.1", () => r()))
        const regionPort = (region.address() as AddressInfo).port

        const replica = createServer((req, res) => {
            res.writeHead(307, {
                location: `http://127.0.0.1:${regionPort}${req.url}?et=ttl-token`,
            })
            res.end()
        })
        await new Promise<void>((r) => replica.listen(0, "127.0.0.1", () => r()))
        const replicaPort = (replica.address() as AddressInfo).port

        try {
            const bot = new ScribblePubBot({
                token: TOKEN,
                baseUrl: `http://127.0.0.1:${replicaPort}`,
            })

            await bot.sendActions("unknown-room", [...HELLO])

            expect(served).toHaveLength(1)
            expect(served[0]?.method).toBe("POST")
            expect(JSON.parse(served[0]?.body ?? "{}")).toEqual({ actions: [...HELLO] })
            // The bearer token does not survive the hop; the URL credential is what authenticates.
            expect(served[0]?.auth).toBeUndefined()
            expect(served[0]?.url).toContain("et=ttl-token")
        } finally {
            region.close()
            replica.close()
        }
    })
})
