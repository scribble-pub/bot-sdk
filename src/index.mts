import type { ValidationError } from "./internal/validation.js"
import {
    parseHookRequest,
    parseHookResponse,
    parseRegisterWebhookPayload,
} from "./internal/validation.js"
import type { Action, ErrorResponse, HookRequest } from "./schemas.js"

export type { ValidationError } from "./internal/validation.js"

export type {
    Action,
    AddMessagePayload,
    ErrorResponse,
    HookRequest,
    HookResponse,
    RegisterWebhookPayload,
    Trigger,
} from "./schemas.js"

const DEFAULT_BASE_URL = "https://scribble.pub"

/**
 * Pre-set production instances serving the most common public rooms, to reduce redirects.
 */
const DEFAULT_ROOM_INSTANCES: Record<string, string> = {
    main: "https://eu.scribble.pub",
    sandbox: "https://eu.scribble.pub",
    chaos: "https://eu.scribble.pub",
    prosto_kot: "https://ap.scribble.pub",
}

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
 * Carries the raw HTTP status and the error message.
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

/**
 * Thrown when arguments fail validation locally, before any request is sent.
 * `errors` lists every field that failed, so a caller can react to the specific problem
 * instead of matching on the message.
 *
 * Only outgoing requests cause this. {@link ScribblePubBot.handleHook} validates the
 * incoming payload and the actions a handler returns, but reports both as HTTP responses
 * (`400` and `500`) rather than by throwing, since it must always answer the platform.
 */
export class ScribblePubValidationError extends Error {
    readonly errors: ValidationError[]

    constructor(message: string, errors: ValidationError[]) {
        super(message)
        this.name = "ScribblePubValidationError"
        this.errors = errors
    }
}

/**
 * You can return an immediate list of actions as a hook response.
 * If some async work is required, send a separate request with the actions by using {@link ScribblePubBot.sendActions},
 * because the platform has a 10-second timeout for hook responses.
 */
export type HookResult = Action[] | undefined

type EventMap = {
    hook: (request: HookRequest) => HookResult
}

class ScribblePubBot {
    private handlers: Partial<{ [K in keyof EventMap]: EventMap[K] }> = {}
    private config: BotConfig
    private readonly baseUrl: string

    /**
     * Root instance lookup dictionary for different rooms.
     * Avoids losing time on 307 "Temporary redirect" when a replica instance is hit.
     *
     * Dynamically updated on {@link ScribblePubBot.handleHook} calls, as well as on 307's received during client-initiated API requests.
     *
     * If {@link BotConfig.baseUrl} is production, it is pre-filled with its most common rooms.
     */
    private readonly roomInstanceMap: Map<string, string>

    constructor(config: BotConfig) {
        this.config = config
        this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")

        if (this.baseUrl === DEFAULT_BASE_URL) {
            this.roomInstanceMap = new Map(Object.entries(DEFAULT_ROOM_INSTANCES))
        } else {
            this.roomInstanceMap = new Map()
        }
    }

    on<K extends keyof EventMap>(event: K, handler: EventMap[K]): this {
        this.handlers[event] = handler
        return this
    }

    /**
     * Tells the platform which URL it should use to send hooks, replacing the previously registered link.
     * The URL must be publicly reachable by scribble.pub
     * and should be the an endpoint that serves {@link ScribblePubBot.handleHook}.
     *
     * @throws {ScribblePubValidationError} if `url` is not an absolute `http`/`https` URL — that is checked
     * locally, before any request goes out.
     * @throws {ScribblePubApiError} if the platform rejects the registration.
     */
    async registerWebhook(url: string): Promise<void> {
        const parsed = parseRegisterWebhookPayload({ url })
        if (!parsed.success) {
            const [first] = parsed.errors
            throw new ScribblePubValidationError(
                `invalid webhook URL: ${first?.message ?? "does not match expected shape"}`,
                parsed.errors,
            )
        }

        await this.post(
            "register webhook",
            `${this.baseUrl}/api/v0/bot/webhook/register`,
            parsed.data,
        )
    }

    /**
     * Sends the given actions, such as new chat messages, to the room.
     *
     * Internal notes: uses {@link ScribblePubBot.roomInstanceMap} to find the right region for the room.
     * If there's no room instance for the given room, the {@link ScribblePubBot.baseUrl} will be used.
     * If it hits a redirect, the corresponding {@link ScribblePubBot.roomInstanceMap} entry will be created or updated with the new URL.
     *
     * @throws {ScribblePubValidationError} if `room` or `actions` fail validation.
     * @throws {ScribblePubApiError} if the platform rejects the request.
     */
    async sendActions(room: string, actions: Action[]): Promise<void> {
        const key = room.trim().toLowerCase()
        if (!key) {
            throw new ScribblePubValidationError("invalid room reference: room is required", [
                { path: "room", message: "room is required" },
            ])
        }

        const parsed = parseHookResponse(actions)
        if (!parsed.success) {
            const [first] = parsed.errors
            throw new ScribblePubValidationError(
                `invalid actions: ${first ? `${first.path} ${first.message}` : "invalid format"}`,
                parsed.errors,
            )
        }

        const origin = this.roomInstanceMap.get(key) ?? this.baseUrl
        const path = `/api/v0/room/${encodeURIComponent(room)}/actions`
        const res = await this.post("send actions", `${origin}${path}`, parsed.data)

        if (res.redirected) {
            const servedBy = new URL(res.url).origin
            if (servedBy !== origin) {
                this.roomInstanceMap.set(key, servedBy)
            }
        }
    }

    /**
     * Issues an authenticated POST, turning any non-2xx answer into a {@link ScribblePubApiError}.
     */
    private async post(operation: string, url: string, body: unknown): Promise<Response> {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.token}`,
            },
            body: JSON.stringify(body),
        })

        if (!res.ok) {
            const errorBody = await this.readErrorBody(res)
            throw new ScribblePubApiError(
                `failed to ${operation}: ${url} returned ${res.status} ${errorBody}`,
                res.status,
                errorBody,
            )
        }

        return res
    }

    private async readErrorBody(res: Response): Promise<string> {
        let raw: string
        try {
            raw = (await res.text()).trim()
        } catch {
            return res.statusText || "no response body"
        }

        if (raw.startsWith("{")) {
            try {
                const parsed: unknown = JSON.parse(raw)
                if (parsed && typeof parsed === "object" && "error" in parsed) {
                    const { error } = parsed as ErrorResponse
                    if (typeof error === "string") {
                        return error
                    }
                }
            } catch {}
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

        this.roomInstanceMap.set(
            parsedRequest.data.trigger.room.toLowerCase(),
            parsedRequest.data.trigger.directUrl,
        )

        const handler = this.handlers.hook
        if (!handler) {
            return Response.json({ error: "no handler registered" }, { status: 501 })
        }

        const actions = handler(parsedRequest.data) ?? []

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
