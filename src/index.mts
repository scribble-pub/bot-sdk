import type { Action, HookRequest } from "./schemas.js"
import { parseHookRequest, parseHookResponse, parseRegisterWebhookPayload } from "./schemas.js"

export type {
    Action,
    AddMessagePayload,
    HookRequest,
    HookResponse,
    RegisterWebhookPayload,
    Trigger,
    ValidationError,
} from "./schemas.js"

const DEFAULT_BASE_URL = "https://scribble.pub"

export type BotConfig = {
    /**
     * The secret token issued for your bot. Used both to verify incoming webhook
     * signatures and to authenticate the bot's own calls to the platform API.
     */
    token: string

    /**
     * Origin of the scribble.pub API, without a trailing slash.
     * Defaults to "https://scribble.pub".
     */
    baseUrl?: string | undefined
}

/**
 * Thrown when the API answers a bot-initiated request with a non-2xx status.
 * Carries the raw HTTP status and the response body, which the API sends as plain text.
 */
export class ScribblePubApiError extends Error {
    readonly status: number
    readonly body: string

    constructor(message: string, status: number, body: string) {
        super(message)
        this.name = "ScribblePubApiError"
        this.status = status
        this.body = body
    }
}

type EventMap = {
    hook: (request: HookRequest) => Action[] | Promise<Action[]>
}

class ScribblePubBot {
    private handlers: Partial<{ [K in keyof EventMap]: EventMap[K] }> = {}
    private config: BotConfig
    private readonly baseUrl: string

    constructor(config: BotConfig) {
        this.config = config
        this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    }

    on<K extends keyof EventMap>(event: K, handler: EventMap[K]): this {
        this.handlers[event] = handler
        return this
    }

    /**
     * Tells the platform which URL it should use to send hooks, replacing the previously registered link.
     * The URL must be publicly reachable by scribble.pub
     * and should be the same endpoint that serves {@link ScribblePubBot.handleHook}.
     *
     * @throws {Error} if `url` is not an absolute `http`/`https` URL — that is checked
     * locally, before any request goes out.
     * @throws {ScribblePubApiError} if the platform rejects the registration.
     */
    async registerWebhook(url: string): Promise<void> {
        const parsed = parseRegisterWebhookPayload({ url })
        if (!parsed.success) {
            const [first] = parsed.errors
            throw new Error(
                `invalid webhook URL: ${first?.message ?? "does not match expected shape"}`,
            )
        }

        const fullUrl = `${this.baseUrl}/api/v0/bot/webhook/register`
        const res = await fetch(fullUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.token}`,
            },
            body: JSON.stringify(parsed.data),
        })

        if (!res.ok) {
            const body = await this.readErrorBody(res)
            throw new ScribblePubApiError(
                `failed to register webhook: ${fullUrl} returned ${res.status} ${body}`,
                res.status,
                body,
            )
        }
    }

    private async readErrorBody(res: Response): Promise<string> {
        let raw: string
        try {
            raw = (await res.text()).trim()
        } catch {
            return res.statusText || "no response body"
        }

        return raw || res.statusText || "no response body"
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
