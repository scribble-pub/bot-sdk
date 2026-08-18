import type {
    HookResponse,
    RegisterWebhookPayload,
    RoomStateResponse,
    GetRoomStateMessagesOptions,
    GetRoomPreviewOptions,
    GetLogoOptions,
} from "./schemas.js"

/**
 * Keeps the status, the final redirect URL, and the headers available to the caller,
 * while the signature still states what the response format is.
 */
export interface TypedResponse<T> extends Response {
    json(): Promise<T>
}

/**
 * A thin HTTP client for the scribble.pub API.
 * It strictly handles authorization headers and JSON payloads, leaving higher-level logic
 * like region caching, 307 redirect management, and response parsing to the SDK wrapper.
 *
 * Every method maps one-to-one onto an endpoint and returns the raw `Response`,
 * so the wrapper can read the status and the final redirect URL of any call.
 *
 * It can be used to generate other clients by using LLMs or AST parsers.
 */
export class ScribblePubClient {
    constructor(
        private readonly token: string,
        public readonly baseUrl: string = "https://scribble.pub",
    ) {}

    /**
     * Tells the platform which URL it should use to send hooks, replacing the previously registered link.
     * The URL must be publicly reachable by scribble.pub.
     *
     * Calls `POST /api/v0/bot/webhook/register`
     */
    async registerWebhook(url: string, payload: RegisterWebhookPayload): Promise<Response> {
        return await this.post(`${url}/api/v0/bot/webhook/register`, payload)
    }

    /**
     * Tells the platform what actions to execute in the room.
     *
     * Note: room writes are served by regional instances.
     * If a replica is hit, this endpoint returns a 307 Temporary Redirect.
     * The underlying `fetch` API follows it seamlessly:
     * the platform substitutes encrypted credentials into the redirect URL,
     * so the authorization is never lost even when clients drop the header for cross-origin security.
     *
     * It is highly recommended to directly call the URL you received in {@link Trigger.directUrl}
     * rather than using the default "scribble.pub",
     * or cache per-room redirect domains received in the 307 response.
     * The SDK wrapper does it for you. Custom SDKs should also cache the regional URLs.
     *
     * Calls `POST /api/v0/room/{room}/actions`
     */
    async sendActions(url: string, room: string, payload: HookResponse): Promise<Response> {
        return await this.post(`${url}/api/v0/room/${encodeURIComponent(room)}/actions`, payload)
    }

    /**
     * Gets the state of a room as a list of messages that can be used to restore the state.
     *
     * Currently, this only returns the currently visible static snapshot of the room, omitting full animation timelines.
     * For most layers, this means only the first frame is returned.
     * For layers in "Roll" mode (check it in https://scribble.pub/docs/animations#animation-modes),
     * the currently rolled frame is returned instead.
     * Future versions of the API are going to support full state fetching.
     *
     * Calls `GET /api/v0/room/{room}/state`
     */
    async getRoomState(
        url: string,
        room: string,
        options?: GetRoomStateMessagesOptions,
    ): Promise<TypedResponse<RoomStateResponse>> {
        let endpoint = `${url}/api/v0/room/${encodeURIComponent(room)}/state`
        if (options && Object.keys(options).length > 0) {
            const params = new URLSearchParams()
            for (const [key, value] of Object.entries(options)) {
                if (value !== undefined) {
                    params.set(key, String(value))
                }
            }
            endpoint += `?${params.toString()}`
        }

        return await this.get(endpoint)
    }

    /**
     * Fetches a low-res (600x420px) raster preview of the room, a 0.6px scale of the 1000x700 canvas.
     *
     * The body is a PNG, so read it with `arrayBuffer()` rather than `json()`.
     * Supports `If-Modified-Since` to save bandwidth: if the preview has not been modified,
     * the platform answers 304 with no body at all.
     *
     * Calls `GET /api/v0/room/{room}/preview`
     */
    async getRoomPreview(
        url: string,
        room: string,
        options?: GetRoomPreviewOptions,
    ): Promise<Response> {
        const headers: Record<string, string> = {}
        if (options?.ifModifiedSince) {
            headers["If-Modified-Since"] = options.ifModifiedSince
        }
        return await this.get(`${url}/api/v0/room/${encodeURIComponent(room)}/preview`, headers)
    }

    /**
     * Fetches the site logo, drawn by the community pixel by pixel. See more at https://scribble.pub/docs/getting-started#logo-top-left.
     *
     * The body is a PNG, so read it with `arrayBuffer()` rather than `json()`.
     * Take its dimensions from the image itself and don't hardcode them since the logo can be resized in the future.
     * It is masked to the letter shapes, so everything around them is transparent,
     * and the letters are bordered in the requested theme's color.
     *
     * The logo is not room-scoped, so this needs no room and no room permissions.
     *
     * Supports `If-None-Match` against the returned `ETag` to save bandwidth: if the logo has not
     * been drawn on since, the platform answers 304 with no body at all.
     *
     * Calls `GET /api/v0/logo`
     */
    async getLogo(url: string, options?: GetLogoOptions): Promise<Response> {
        const headers: Record<string, string> = {}
        if (options?.ifNoneMatch) {
            headers["If-None-Match"] = options.ifNoneMatch
        }
        const theme = options?.theme === "dark" ? "?theme=dark" : ""
        return await this.get(`${url}/api/v0/logo${theme}`, headers)
    }

    /**
     * Issues an authenticated GET. Returns the raw Response object.
     */
    async get<T = unknown>(
        url: string,
        headers?: Record<string, string>,
    ): Promise<TypedResponse<T>> {
        return await fetch(url, {
            headers: {
                ...headers,
                Authorization: `Bearer ${this.token}`,
            },
        })
    }

    /**
     * Issues an authenticated POST. Returns the raw Response object.
     */
    async post(url: string, body: unknown): Promise<Response> {
        return await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify(body),
        })
    }
}
