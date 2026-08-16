import { z } from "zod"
import type {
    Action,
    HookRequest,
    HookResponse,
    RegisterWebhookPayload,
    Trigger,
} from "./schemas.js"

const TriggerSchema: z.ZodType<Trigger> = z.object({
    trigger: z.literal("chat.mention"),
    room: z.string(),
    timestamp: z.number(),
    text: z.string(),
    username: z.string(),
    directUrl: z.string(),
})

const HookRequestSchema: z.ZodType<HookRequest> = z.object({
    trigger: TriggerSchema,
})

const RegisterWebhookPayloadSchema: z.ZodType<RegisterWebhookPayload> = z.object({
    url: z.url({ protocol: /^https?$/ }),
})

const ActionSchema: z.ZodType<Action> = z.object({
    type: z.literal("addMessage"),
    text: z.string(),
})

const HookResponseSchema: z.ZodType<HookResponse> = z.object({
    actions: z.array(ActionSchema),
})

/**
 * An error encountered while validating a request to your service, or a request or response to the scribble.pub API.
 */
export type ValidationError = {
    /** Dot-separated path to the erroring field, e.g. "trigger.timestamp". */
    path: string
    message: string
}

function toValidationErrors(issues: z.core.$ZodIssue[]): ValidationError[] {
    return issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
    }))
}

/**
 * Validates an incoming webhook body against {@link HookRequest}.
 */
export function parseHookRequest(
    data: unknown,
): { success: true; data: HookRequest } | { success: false; errors: ValidationError[] } {
    const result = HookRequestSchema.safeParse(data)
    return result.success
        ? { success: true, data: result.data }
        : { success: false, errors: toValidationErrors(result.error.issues) }
}

/**
 * Validates a webhook URL before it is sent to the platform, so an obviously bad value fails locally.
 */
export function parseRegisterWebhookPayload(
    data: unknown,
): { success: true; data: RegisterWebhookPayload } | { success: false; errors: ValidationError[] } {
    const result = RegisterWebhookPayloadSchema.safeParse(data)
    return result.success
        ? { success: true, data: result.data }
        : { success: false, errors: toValidationErrors(result.error.issues) }
}

/**
 * Validates the actions a bot handler returns against {@link HookResponse}.
 */
export function parseHookResponse(
    actions: unknown,
): { success: true; data: HookResponse } | { success: false; errors: ValidationError[] } {
    const result = HookResponseSchema.safeParse({ actions })
    return result.success
        ? { success: true, data: result.data }
        : { success: false, errors: toValidationErrors(result.error.issues) }
}
