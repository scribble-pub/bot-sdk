import type { Action, HookRequest } from "./schemas.js"
import { parseHookRequest, parseHookResponse } from "./schemas.js"

export type { Action, AddMessagePayload, HookRequest, HookResponse, Trigger } from "./schemas.js"

type EventMap = {
    hook: (request: HookRequest) => Action[] | Promise<Action[]>
}

class ScribblePubBot {
    private handlers: Partial<{ [K in keyof EventMap]: EventMap[K] }> = {}
    private config: { token: string }

    constructor(config: { token: string }) {
        this.config = config
    }

    on<K extends keyof EventMap>(event: K, handler: EventMap[K]): this {
        this.handlers[event] = handler
        return this
    }

    async handleHook(req: Request): Promise<Response> {
        const raw = await req.text()

        const verified = await this.verifySignature(raw, req.headers)
        if (!verified) {
            return Response.json({ error: "invalid signature" }, { status: 401 })
        }

        let body: unknown
        try {
            body = JSON.parse(raw)
        } catch {
            return Response.json({ error: "invalid JSON" }, { status: 400 })
        }

        const parsedRequest = parseHookRequest(body)
        if (!parsedRequest.success) {
            return Response.json(
                { error: "invalid payload", details: parsedRequest.errors },
                { status: 400 },
            )
        }

        const handler = this.handlers.hook
        if (!handler) {
            return Response.json({ error: "no handler registered" }, { status: 501 })
        }

        const actions = await handler(parsedRequest.data)

        const parsedResponse = parseHookResponse(actions)
        if (!parsedResponse.success) {
            return Response.json(
                { error: "handler returned invalid actions", details: parsedResponse.errors },
                { status: 500 },
            )
        }

        return Response.json(parsedResponse.data)
    }

    private async verifySignature(raw: string, headers: Headers): Promise<boolean> {
        const signature = headers.get("x-scribble-pub-signature")

        // The hash signature always starts with sha256= to upgrade seamlessly if needed,
        // similar to https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#validating-webhook-deliveries.
        if (!signature?.startsWith("sha256=")) return false

        const hexSig = signature.substring(7)
        const sigBytes = new Uint8Array(
            (hexSig.match(/.{1,2}/g) ?? []).map((byte) => parseInt(byte, 16)),
        )
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(this.config.token),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"],
        )
        return await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(raw))
    }
}

export default ScribblePubBot
