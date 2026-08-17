import {
    parseHookRequest,
    parseHookResponse,
    parseRegisterWebhookPayload,
    verifySignature,
    ScribblePubClient,
} from "@scribble-pub/api"
import type {
    Action,
    ErrorResponse,
    HookRequest,
    GetRoomPreviewOptions,
    RoomStateResponse,
} from "@scribble-pub/api"

import { ScribblePubApiError, ScribblePubValidationError } from "./errors.js"
import type { GetRoomStateMessagesOptions } from "@scribble-pub/api"
import { RoomState } from "./state.js"

export * from "./state.js"

export type { ValidationError } from "@scribble-pub/api"

export type {
    Action,
    AddMessagePayload,
    ErrorResponse,
    HookRequest,
    HookResponse,
    RegisterWebhookPayload,
    GetRoomStateMessagesOptions,
    GetRoomPreviewOptions,
    RoomMessage,
    RoomStateResponse,
    Trigger,
} from "@scribble-pub/api"

export { ScribblePubApiError, ScribblePubValidationError }

export { rgbaToHex, rgbaToComponents } from "@scribble-pub/api"
export type { RgbaComponents } from "@scribble-pub/api"

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
        const key = this.assertRoom(room)

        const parsed = parseHookResponse(actions)
        if (!parsed.success) {
            const [first] = parsed.errors
            throw new ScribblePubValidationError(
                `invalid actions: ${first ? `${first.path} ${first.message}` : "invalid format"}`,
                parsed.errors,
            )
        }

        const origin = this.roomInstanceMap.get(key) ?? this.client.baseUrl
        const res = await this.send("send actions", () =>
            this.client.sendActions(origin, room, parsed.data),
        )

        if (res.redirected) {
            const servedBy = new URL(res.url).origin
            if (servedBy !== origin) {
                this.roomInstanceMap.set(key, servedBy)
            }
        }
        await this.assertOk("send actions", res)
    }

    /**
     * Gets the state of a room as a list of messages that can be used to restore the state.
     *
     * Currently, this only returns the currently visible static snapshot of the room, omitting full animation timelines.
     * For most layers, this means only the first frame is returned.
     * For layers in "Roll" mode (check it in https://scribble.pub/docs/animations#animation-modes),
     * the currently rolled frame is returned instead.
     * Future versions of the API are going to provide the full state.
     *
     * @param room The ID of the room.
     * @param options Optional parameters for fetching messages (e.g., { sinceEventId: 1234 }).
     *
     * @throws {ScribblePubValidationError} if `room` fails validation.
     * @throws {ScribblePubApiError} if the platform rejects the request.
     */
    async getRoomStateMessages(
        room: string,
        options?: GetRoomStateMessagesOptions,
    ): Promise<RoomStateResponse> {
        this.assertRoom(room)
        // Reads are served by whichever replica answers.
        const res = await this.send("get room messages", () =>
            this.client.getRoomState(this.client.baseUrl, room, options),
        )
        await this.assertOk("get room messages", res)

        return await res.json()
    }

    /**
     * Fetches the room state and reduces it into a {@link RoomState}.
     *
     * @param room The ID of the room.
     *
     * @throws {ScribblePubValidationError} if `room` fails validation.
     * @throws {ScribblePubApiError} if the platform rejects the request.
     */
    async getRoomState(room: string): Promise<RoomState> {
        const response = await this.getRoomStateMessages(room)
        return RoomState.fromMessages(response.messages)
    }

    /**
     * Fetches a low-res (600x420) raster preview of the room.
     *
     * @param room The ID of the room.
     * @param options Optional parameters (e.g., { ifModifiedSince: "Mon, 17 Aug 2026 13:43:50 GMT" }).
     * @returns An ArrayBuffer containing the PNG image, or null if it was not modified (304).
     *
     * @throws {ScribblePubValidationError} if `room` fails validation.
     * @throws {ScribblePubApiError} if the platform rejects the request.
     */
    async getRoomPreviewImage(
        room: string,
        options?: GetRoomPreviewOptions,
    ): Promise<ArrayBuffer | null> {
        this.assertRoom(room)

        // Reads are served by whichever replica answers.
        const res = await this.send("get room preview", () =>
            this.client.getRoomPreview(this.client.baseUrl, room, options),
        )

        if (res.status === 304) {
            return null
        }
        await this.assertOk("get room preview", res)

        return await res.arrayBuffer()
    }

    /**
     * Checks a room reference and normalizes it into the key
     * used by {@link ScribblePubBot.roomInstanceMap}.
     *
     * @throws {ScribblePubValidationError} if the reference is empty.
     */
    private assertRoom(room: string): string {
        const key = room.trim().toLowerCase()
        if (!key) {
            throw new ScribblePubValidationError("invalid room reference: room is required", [
                { path: "room", message: "room is required" },
            ])
        }
        return key
    }

    /**
     * Runs a platform call, re-wrapping transport failures as ScribblePubApiError.
     * The response status is left to the caller because a 304 is a valid answer for some endpoints.
     */
    private async send(operation: string, call: () => Promise<Response>): Promise<Response> {
        try {
            return await call()
        } catch (error) {
            const message = error instanceof Error ? error.message : "unknown error"
            throw new ScribblePubApiError(`failed to ${operation}: ${message}`, 500, message)
        }
    }

    /**
     * Checks if the response is ok, otherwise reads the error body, and throws a ScribblePubApiError.
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
