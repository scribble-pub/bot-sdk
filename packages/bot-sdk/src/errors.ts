import type { ValidationError } from "@scribble-pub/api"

/**
 * Thrown when the API answers a bot-initiated request with a non-2xx status.
 * Contains the raw HTTP status and the error message.
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
 */
export class ScribblePubValidationError extends Error {
    readonly errors: ValidationError[]

    constructor(message: string, errors: ValidationError[]) {
        super(message)
        this.name = "ScribblePubValidationError"
        this.errors = errors
    }
}
