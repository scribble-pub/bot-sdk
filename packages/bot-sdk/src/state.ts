import type {
    RoomMessage,
    ScratchpadLayerMessage,
    ScratchpadObjectMessage,
    ScratchpadObjectPayload,
    ScratchpadSessionMetaMessage,
} from "@scribble-pub/api"

/**
 * A layer in the state.
 *
 * The frames are also declared in layers: a frame exists because a layer has its ID in its `frames` array
 * and is dropped as soon as it's no longer there.
 */
export type ScratchpadLayer = {
    layerId: number

    /**
     * The IDs of the frames owned by this layer.
     */
    frames: number[]

    lastEventId: number
}

/**
 * A frame in the state. A child node of a layer.
 */
export type ScratchpadFrame = {
    frameId: number

    /**
     * The layer that owns this frame.
     */
    layerId: number

    /**
     * The objects in this frame.
     * Ordered by objectId. Removed objects will be set to null for performance.
     */
    objects: (ScratchpadObject | null)[]
}

/**
 * A drawn object in the state.
 */
export type ScratchpadObject = {
    objectId: number

    frameId: number

    eventId: number
} & ScratchpadObjectPayload

/**
 * Scratchpad state for a single drawing session.
 *
 * Used as the base for a new drawing, created whenever a state snapshot is received or a new session begins.
 */
class DrawingSession {
    public meta: ScratchpadSessionMetaMessage | null = null
    public layers = new Map<number, ScratchpadLayer>()
    public layerOrder: number[] = []
    public objects = new Map<number, ScratchpadObject>()
    public frames = new Map<number, ScratchpadFrame>()
    public lastEventId = -1
}

/**
 * A mutable state for the drawing surface of a scribble.pub room.
 *
 * This class accepts `RoomMessage` events and builds/updates the scratchpad's current state.
 * It is mutable (game-engine style) rather than immutable (React/Redux style)
 * to prevent massive GC overhead when processing tens of thousands of objects.
 */
export class ScratchpadState {
    private session = new DrawingSession()

    /**
     * Builds a state out of arrived messages.
     */
    public static fromMessages(messages: RoomMessage[]): ScratchpadState {
        const state = new ScratchpadState()
        state.applyMessages(messages)
        return state
    }

    /**
     * Metadata of the current drawing session, or null if none has arrived yet.
     */
    public get sessionMeta(): ScratchpadSessionMetaMessage | null {
        return this.session.meta
    }

    /**
     * All active layers in the room, keyed by layerId.
     */
    public get layers(): ReadonlyMap<number, ScratchpadLayer> {
        return this.session.layers
    }

    /**
     * The order of layer IDs from bottom to top.
     */
    public get layerOrder(): readonly number[] {
        return this.session.layerOrder
    }

    /**
     * All objects in the room, keyed by objectId.
     */
    public get objects(): ReadonlyMap<number, ScratchpadObject> {
        return this.session.objects
    }

    /**
     * An index mapping frameId to its ScratchpadFrame.
     */
    public get frames(): ReadonlyMap<number, ScratchpadFrame> {
        return this.session.frames
    }

    /**
     * The scratchpad's event counter, or -1 if nothing has arrived yet.
     * This is the cursor to resume a partial update from, and it resets with the session.
     */
    public get lastEventId(): number {
        return this.session.lastEventId
    }

    /**
     * Applies the given RoomMessage to the state.
     *
     * Unrecognized message types are ignored, so a newer platform can't break an older bot.
     *
     * Don't mutate the messages you pass here, since the state reuses the arrays and objects inside `msg`,
     * which is safe for freshly parsed payloads.
     */
    public applyMessage(msg: RoomMessage): void {
        switch (msg.type) {
            case "sp.sessionMeta":
                this.applySessionMeta(msg)
                break
            case "sp.layer":
                this.applyLayer(msg)
                break
            case "sp.layerOrder":
                this.session.layerOrder = msg.order
                this.trackEventId(msg.lastEventId)
                break
            case "sp.object":
                this.applyObject(msg)
                break
            case "sp.lastEventId":
                this.trackEventId(msg.lastEventId)
                break
        }
    }

    /**
     * Applies an array of RoomMessages in order.
     */
    public applyMessages(messages: RoomMessage[]): void {
        for (const msg of messages) {
            this.applyMessage(msg)
        }
    }

    private applySessionMeta(msg: ScratchpadSessionMetaMessage): void {
        // Session meta always begins a new drawing.
        this.session = new DrawingSession()
        this.session.meta = msg
        this.trackEventId(msg.eventId)
    }

    private applyLayer(msg: ScratchpadLayerMessage): void {
        const layer = this.session.layers.get(msg.layerId)
        this.trackEventId(msg.lastEventId)

        if (msg.frames.length === 0) {
            // Layer must be deleted.
            this.session.layers.delete(msg.layerId)
            const orderIdx = this.session.layerOrder.indexOf(msg.layerId)
            if (orderIdx !== -1) {
                this.session.layerOrder.splice(orderIdx, 1)
            }
            if (layer) {
                for (const frameId of layer.frames) {
                    this.deleteFrame(frameId)
                }
            }
            return
        }

        if (layer) {
            // Delete any frames that were removed in the update.
            const kept = new Set(msg.frames)
            for (const frameId of layer.frames) {
                if (!kept.has(frameId)) {
                    this.deleteFrame(frameId)
                }
            }
            layer.frames = msg.frames
            layer.lastEventId = msg.lastEventId
        } else {
            this.session.layers.set(msg.layerId, {
                layerId: msg.layerId,
                frames: msg.frames,
                lastEventId: msg.lastEventId,
            })
        }

        // Adding frames introduced by this update.
        for (const frameId of msg.frames) {
            if (!this.session.frames.has(frameId)) {
                this.session.frames.set(frameId, {
                    frameId,
                    layerId: msg.layerId,
                    objects: [],
                })
            }
        }
    }

    private applyObject(msg: ScratchpadObjectMessage): void {
        const frame = this.session.frames.get(msg.frameId)
        if (!frame) {
            // There is nothing to attach the object to.
            // Shouldn't happen, but it's still a defined behavior for implementing clients just in case.
            return
        }
        this.trackEventId(msg.eventId)

        const object: ScratchpadObject = msg

        const existing = this.session.objects.get(msg.objectId)
        this.session.objects.set(msg.objectId, object)
        if (existing) {
            const existingIdx = frame.objects.findIndex((o) => o?.objectId === msg.objectId)
            if (existingIdx !== -1) {
                frame.objects[existingIdx] = object
                return
            }
        }
        // Objects arrive in ascending objectId order, which is also their Z-index.
        frame.objects.push(object)
    }

    private deleteFrame(frameId: number): void {
        const frame = this.session.frames.get(frameId)
        if (frame) {
            for (const obj of frame.objects) {
                if (obj) this.session.objects.delete(obj.objectId)
            }
            this.session.frames.delete(frameId)
        }
    }

    /**
     * Since there is no ordering guarantee for event IDs, and some of them are -1,
     * we must pick the max of the incoming event IDs.
     */
    private trackEventId(eventId: number): void {
        if (eventId > this.session.lastEventId) {
            this.session.lastEventId = eventId
        }
    }
}

/**
 * A mutable state for a scribble.pub room.
 *
 * It holds substates per room apps (scratchpad, chat) and routes incoming `RoomMessage` to them.
 */
export class RoomState {
    /**
     * The drawing surface of the room.
     */
    public readonly scratchpad = new ScratchpadState()

    /**
     * Builds a state out of arrived messages.
     */
    public static fromMessages(messages: RoomMessage[]): RoomState {
        const state = new RoomState()
        state.applyMessages(messages)
        return state
    }

    /**
     * Applies an array of RoomMessages in order.
     */
    public applyMessages(messages: RoomMessage[]): void {
        this.scratchpad.applyMessages(messages)
    }

    /**
     * Applies a single RoomMessage to the substate that owns it.
     */
    public applyMessage(msg: RoomMessage): void {
        this.scratchpad.applyMessage(msg)
    }
}
