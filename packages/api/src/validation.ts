import { z } from "zod"
import {
    type Action,
    type HookRequest,
    type HookResponse,
    type IncomingTrigger,
    MAX_ACTIONS,
    MAX_PAYLOAD_BYTES,
    type RegisterWebhookPayload,
    type SupportedTriggerType,
} from "./schemas.js"

const baseFields = {
    room: z.string(),
    timestamp: z.number(),
    directUrl: z.string(),
}

// `.int()` already refuses anything outside the safe-integer range, which is exactly MAX_LOCAL_ID.
const localIdField = z
    .number()
    .int()
    .min(0)
    .optional()
    .transform((value) => (value ? value : undefined))

const chatFields = {
    ...baseFields,
    username: z.string(),
    userId: z.string(),
    messageId: z.number(),
    text: z.string(),
}

// Only ever delivered for a live parent, so everything but the conditional fields is required.
const RepliedMessageSchema = z.looseObject({
    messageId: z.number(),
    localId: localIdField,
    username: z.string(),
    userId: z.string(),
    text: z.string(),
    quoteStart: z.number().int().min(0).optional(),
    quoteText: z.string().optional(),
})

const ChatAddressedTriggerSchema = z.looseObject({
    ...chatFields,
    type: z.literal("chat.addressed"),
    replyToMessageId: z.number().optional(),
    replyTo: RepliedMessageSchema.optional(),
})

const triggerSchemasByType: Record<SupportedTriggerType, z.ZodType> = {
    "chat.addressed": ChatAddressedTriggerSchema,
}

// Parse the common base fields first to avoid throwing 400 errors for unsupported trigger types.
// We use a loose object so fields aren't stripped before they can be checked by specific schemas.
// We dispatch manually instead of using `z.union` to provide more accurate error messages.
const TriggerSchema: z.ZodType<IncomingTrigger> = z
    .looseObject({
        ...baseFields,
        type: z.string(),
    })
    .superRefine((trigger, ctx) => {
        const schema = triggerSchemasByType[trigger.type as SupportedTriggerType]
        if (!schema) {
            return
        }

        const result = schema.safeParse(trigger)
        if (!result.success) {
            for (const issue of result.error.issues) {
                ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
            }
        }
    })

const HookRequestSchema: z.ZodType<HookRequest> = z.looseObject({
    trigger: TriggerSchema,
})

const RegisterWebhookPayloadSchema: z.ZodType<RegisterWebhookPayload> = z.object({
    url: z.url({ protocol: /^https?$/ }),
})

const ReplyTargetSchema = z
    .looseObject({
        messageId: z.number().optional(),
        localId: localIdField,
        quoteStart: z.number().int().min(0).optional(),
        quoteLength: z.number().int().positive().optional(),
    })
    .superRefine((replyTo, ctx) => {
        // Choose either `messageId` or `localId`
        if (replyTo.messageId !== undefined && replyTo.localId !== undefined) {
            ctx.addIssue({
                code: "custom",
                path: ["messageId"],
                message: "give either messageId or localId, not both",
            })
        }
        if (replyTo.messageId === undefined && replyTo.localId === undefined) {
            ctx.addIssue({
                code: "custom",
                path: ["messageId"],
                message: "one of messageId or localId is required",
            })
        }
        if ((replyTo.quoteStart === undefined) !== (replyTo.quoteLength === undefined)) {
            ctx.addIssue({
                code: "custom",
                path: [replyTo.quoteStart === undefined ? "quoteStart" : "quoteLength"],
                message: "quoteStart and quoteLength must be given together",
            })
        }
    })

const AddMessageActionSchema = z.looseObject({
    type: z.literal("chat.addMessage"),
    text: z.string(),
    localId: localIdField,
    replyTo: ReplyTargetSchema.optional(),
})

// Unlike in chat, a drawing is identified by its local ID, so it is required and can't be 0.
const drawingLocalIdField = z.number().int().min(1)

const LayerPositionSchema = z
    .looseObject({
        at: z.enum(["top", "bottom", "above", "below"]),
        layerId: z.number().int().min(0).optional(),
        layerLocalId: drawingLocalIdField.optional(),
    })
    .superRefine((position, ctx) => {
        const layers =
            (position.layerId !== undefined ? 1 : 0) + (position.layerLocalId !== undefined ? 1 : 0)
        if (position.at === "top" || position.at === "bottom") {
            if (layers > 0) {
                ctx.addIssue({
                    code: "custom",
                    path: ["at"],
                    message: `position at ${position.at} takes no layer`,
                })
            }
        } else if (layers !== 1) {
            ctx.addIssue({
                code: "custom",
                path: ["layerId"],
                message: `position ${position.at} takes exactly one of layerId or layerLocalId`,
            })
        }
    })

const PutLayerActionSchema = z.looseObject({
    type: z.literal("sp.putLayer"),
    localId: drawingLocalIdField,
    frameLocalIds: z.array(drawingLocalIdField).min(1).max(256),
    animationMode: z.enum(["sequential", "random", "roll"]).optional(),
    position: LayerPositionSchema.optional(),
})

const RemoveLayerActionSchema = z.looseObject({
    type: z.literal("sp.removeLayer"),
    localId: drawingLocalIdField,
})

const PutObjectActionSchema = z
    .looseObject({
        type: z.literal("sp.putObject"),
        localId: drawingLocalIdField,
        frameId: z.number().int().min(0).optional(),
        frameLocalId: drawingLocalIdField.optional(),
        objectType: z.literal("line.floats"),
        rgba: z.number().int().min(0).max(0xffffffff),
        lineWidth: z.number().min(0).max(100),
        points: z
            .array(z.number())
            .min(2)
            .max(4000)
            .refine((points) => points.length % 2 === 0, {
                message: "points must hold [x, y] pairs",
            }),
    })
    .superRefine((action, ctx) => {
        if ((action.frameId === undefined) === (action.frameLocalId === undefined)) {
            ctx.addIssue({
                code: "custom",
                path: ["frameId"],
                message: "give exactly one of frameId or frameLocalId",
            })
        }
    })

const RemoveObjectActionSchema = z.looseObject({
    type: z.literal("sp.removeObject"),
    localId: drawingLocalIdField,
})

const CheckSessionActionSchema = z.looseObject({
    type: z.literal("sp.checkSession"),
    session: z.number().int().positive(),
})

const ActionSchema: z.ZodType<Action> = z.discriminatedUnion("type", [
    AddMessageActionSchema,
    CheckSessionActionSchema,
    PutLayerActionSchema,
    RemoveLayerActionSchema,
    PutObjectActionSchema,
    RemoveObjectActionSchema,
])

// A frame local ID belongs to a single layer of the bot. Within a request, giving it to another layer is caught
// here; against the layers of earlier requests, only the server can tell, and it skips such an action.
function checkFrameOwners(actions: Action[], ctx: z.RefinementCtx): void {
    const owners = new Map<number, number>()
    const free = (layerLocalId: number) => {
        for (const [frameLocalId, owner] of owners) {
            if (owner === layerLocalId) {
                owners.delete(frameLocalId)
            }
        }
    }
    actions.forEach((action, i) => {
        if (action.type === "sp.removeLayer") {
            free(action.localId)
        }
        if (action.type !== "sp.putLayer") {
            return
        }
        const clash = action.frameLocalIds.find((frameLocalId) => {
            const owner = owners.get(frameLocalId)
            return owner !== undefined && owner !== action.localId
        })
        if (clash !== undefined) {
            ctx.addIssue({
                code: "custom",
                path: [i, "frameLocalIds"],
                message: `frame ${clash} belongs to layer ${owners.get(clash)}: a frame local ID can't be in two layers`,
            })
            return
        }
        free(action.localId)
        for (const frameLocalId of action.frameLocalIds) {
            owners.set(frameLocalId, action.localId)
        }
    })
}

// A drawing is applied all at once, so a check anywhere but first would only let the actions before it through.
function checkSessionFirst(actions: Action[], ctx: z.RefinementCtx): void {
    const drawing = actions
        .map((action, i) => ({ action, i }))
        .filter(({ action }) => action.type.startsWith("sp."))
    for (const { action, i } of drawing.slice(1)) {
        if (action.type === "sp.checkSession") {
            ctx.addIssue({
                code: "custom",
                path: [i, "type"],
                message: "sp.checkSession must come before the other sp.* actions",
            })
        }
    }
}

const HookResponseSchema: z.ZodType<HookResponse> = z.looseObject({
    actions: z
        .array(ActionSchema)
        .max(MAX_ACTIONS)
        .superRefine(checkFrameOwners)
        .superRefine(checkSessionFirst),
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
    if (!result.success) {
        return { success: false, errors: toValidationErrors(result.error.issues) }
    }
    const bytes = new TextEncoder().encode(JSON.stringify(result.data)).length
    if (bytes > MAX_PAYLOAD_BYTES) {
        const message = `the actions take ${bytes} bytes of JSON, more than ${MAX_PAYLOAD_BYTES}`
        return { success: false, errors: [{ path: "actions", message }] }
    }
    return { success: true, data: result.data }
}
