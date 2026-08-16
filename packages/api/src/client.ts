import type { HookResponse, RegisterWebhookPayload } from "./schemas.js"

/**
 * A thin, unopinionated HTTP client for the scribble.pub API.
 * It strictly handles authorization headers and JSON payloads, leaving higher-level logic 
 * like region caching and 307 redirect management to the SDK wrapper.
 *
 * It can be used to generate other clients by using LLMs or AST parsers.
 *
 */
export class ScribblePubClient {
    constructor(private readonly token: string, public readonly baseUrl: string = "https://scribble.pub") {}

    /**
     * Tells the platform which URL it should use to send hooks, replacing the previously registered link.
     * The URL must be publicly reachable by scribble.pub.
     * 
     * Calls `POST /api/v0/bot/webhook/register`
     */
    async registerWebhook(url: string, payload: RegisterWebhookPayload): Promise<Response> {
        return this.post(`${url}/api/v0/bot/webhook/register`, payload)
    }

    /**
     * Tells the platform what actions to execute in the room.
     * 
     * Note: Rooms are served by regional instances.
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
        return this.post(`${url}/api/v0/room/${encodeURIComponent(room)}/actions`, payload)
    }

    /**
     * Issues an authenticated POST. Returns the raw Response object.
     */
    async post(url: string, body: unknown): Promise<Response> {
        return fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify(body),
        })
    }
}
