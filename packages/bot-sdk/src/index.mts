import {
    parseHookRequest,
    parseHookResponse,
    parseRegisterWebhookPayload,
    verifySignature,
    ScribblePubClient
} from "@scribble-pub/api"
import type { Action, ErrorResponse, HookRequest } from "@scribble-pub/api"

import { ScribblePubApiError, ScribblePubValidationError } from "./errors.js"

export type { ValidationError } from "@scribble-pub/api"

export type {
    Action,
    AddMessagePayload,
    ErrorResponse,
    HookRequest,
    HookResponse,
    RegisterWebhookPayload,
    Trigger,
} from "@scribble-pub/api"

export { ScribblePubApiError, ScribblePubValidationError }

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
    private readonly client: ScribblePubClient

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
        const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
        
        this.client = new ScribblePubClient(config.token, baseUrl)

        if (baseUrl === DEFAULT_BASE_URL) {
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

        const res = await this.client.registerWebhook(this.client.baseUrl, parsed.data)
        await this.assertOk("register webhook", res)
    }

    /**
     * Sends the given actions, such as new chat messages, to the room.
     *
     * Internal notes: uses {@link ScribblePubBot.roomInstanceMap} to find the right region for the room.
     * If there's no room instance for the given room, the {@link BotConfig.baseUrl} will be used.
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

        const origin = this.roomInstanceMap.get(key) ?? this.client.baseUrl
        const res = await this.client.sendActions(origin, room, parsed.data)
        await this.assertOk("send actions", res)

        if (res.redirected) {
            const servedBy = new URL(res.url).origin
            if (servedBy !== origin) {
                this.roomInstanceMap.set(key, servedBy)
            }
        }
    }

    /**
     * Checks if the response is ok, otherwise reads the error body and throws a ScribblePubApiError.
     */
    private async assertOk(operation: string, res: Response): Promise<void> {
        if (!res.ok) {
            const errorBody = await this.readErrorBody(res)
            throw new ScribblePubApiError(
                `failed to ${operation}: ${res.url} returned ${res.status} ${errorBody}`,
                res.status,
                errorBody,
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

        const verified = await verifySignature(this.config.token, raw, req.headers)
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
}

export default ScribblePubBot
