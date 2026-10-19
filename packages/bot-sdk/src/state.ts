import type {
    AnimationMode,
    RoomMessage,
    ScratchpadLayerMessage,
    ScratchpadObjectMessage,
    ScratchpadObjectPayload,
    ScratchpadSessionMetaMessage,
} from "@scribble-pub/api"

// Viewers' apps start sequential animations over every 15 minutes, which visibleFrameId must follow.
const ANIMATION_PERIOD_MS = 15 * 60 * 1000

/**
 * A layer in the state.
 *
 * The frames are also declared in layers: a frame exists because a layer has its ID in its `frames` array
 * and is dropped as soon as it's no longer there.
 */
export type ScratchpadLayer = {
    layerId: number

    /**
     * The frame program of this layer: one frame ID per tick, in the order they are played. Repeated frames appear
     * several times.
     */
    frames: number[]

    /**
     * How the layer plays its {@link ScratchpadLayer.frames}.
     * See more at https://scribble.pub/docs/animations#animation-modes.
     */
    animationMode: AnimationMode

    lastEventId: number

    /**
     * Your bot's own ID for this layer. Present only on your bot's own layers.
     */
    localId?: number | undefined

    /**
     * The IDs of the layer's frames by your bot's own IDs for them. Present only on your bot's own layers.
     */
    frameIdsByLocalId?: Record<number, number> | undefined
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

    /**
     * Your bot's own ID for this object. Present only on your bot's own objects.
     */
    localId?: number | undefined
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
    public roll = 0
    public ownLayers = new Map<number, ScratchpadLayer>()
    public ownFrames = new Map<number, ScratchpadFrame>()
    public ownObjects = new Map<number, ScratchpadObject>()
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
     * The room's last dice roll, from 0 (inclusive) to 1 (exclusive), which picks the frames of `roll` layers.
     */
    public get roll(): number {
        return this.session.roll
    }

    /**
     * The frame of the layer that viewers see at the given time, picked as viewers' apps do:
     *
     * - **`sequential`:** the frames loop on a clock shared by all viewers, so this is the frame everyone sees.
     * - **`roll`:** the frame selected by the last dice roll, the same for everyone.
     * - **`random`:** every viewer sees random frames of their own. Pass `random` (from 0 to 1, exclusive) to pick
     *   one; viewers use the same number for all layers at a time.
     *
     * Returns `undefined` if the layer is not there.
     */
    public visibleFrameId(
        layerId: number,
        time: number = Date.now(),
        random: number = Math.random(),
    ): number | undefined {
        const layer = this.session.layers.get(layerId)
        if (!layer || layer.frames.length === 0) {
            return undefined
        }
        const count = layer.frames.length
        switch (layer.animationMode) {
            case "roll":
                return layer.frames[Math.min(Math.floor(this.session.roll * count), count - 1)]
            case "random":
                return layer.frames[Math.min(Math.floor(random * count), count - 1)]
            default: {
                // Without a session there are no layers either; the fallback only keeps the types simple.
                const tickMs = this.session.meta?.animationTickMs ?? 125
                const tick = Math.floor(time / tickMs) % (ANIMATION_PERIOD_MS / tickMs)
                return layer.frames[tick % count]
            }
        }
    }

    /**
     * Your bot's own layers, keyed by the `localId` it gave them.
     *
     * Lets a bot that lost its memory (e.g., restarted) find what it has already drawn.
     */
    public get ownLayers(): ReadonlyMap<number, ScratchpadLayer> {
        return this.session.ownLayers
    }

    /**
     * Your bot's own frames, keyed by the local IDs it gave them (`frameLocalIds`), e.g. to draw them again.
     */
    public get ownFrames(): ReadonlyMap<number, ScratchpadFrame> {
        return this.session.ownFrames
    }

    /**
     * Your bot's own objects, keyed by the `localId` it gave them.
     */
    public get ownObjects(): ReadonlyMap<number, ScratchpadObject> {
        return this.session.ownObjects
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
            case "sp.roll":
                this.session.roll = msg.roll
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
                this.unindexOwnFrames(layer)
                for (const frameId of layer.frames) {
                    this.deleteFrame(frameId)
                }
                if (
                    layer.localId !== undefined &&
                    this.session.ownLayers.get(layer.localId) === layer
                ) {
                    this.session.ownLayers.delete(layer.localId)
                }
            }
            return
        }

        if (layer) {
            this.unindexOwnFrames(layer)
            // Delete any frames that were removed in the update.
            const kept = new Set(msg.frames)
            for (const frameId of layer.frames) {
                if (!kept.has(frameId)) {
                    this.deleteFrame(frameId)
                }
            }
            layer.frames = msg.frames
            layer.animationMode = msg.animationMode
            layer.lastEventId = msg.lastEventId
            layer.localId = msg.localId
            layer.frameIdsByLocalId = msg.frameIdsByLocalId
        } else {
            this.session.layers.set(msg.layerId, {
                layerId: msg.layerId,
                frames: msg.frames,
                animationMode: msg.animationMode,
                lastEventId: msg.lastEventId,
                localId: msg.localId,
                frameIdsByLocalId: msg.frameIdsByLocalId,
            })
        }
        const updated = this.session.layers.get(msg.layerId)
        if (updated?.localId !== undefined) {
            this.session.ownLayers.set(updated.localId, updated)
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
        for (const [localId, frameId] of Object.entries(msg.frameIdsByLocalId ?? {})) {
            const frame = this.session.frames.get(frameId)
            if (frame) {
                this.session.ownFrames.set(Number(localId), frame)
            }
        }
    }

    private unindexOwnFrames(layer: ScratchpadLayer): void {
        for (const [localId, frameId] of Object.entries(layer.frameIdsByLocalId ?? {})) {
            if (this.session.ownFrames.get(Number(localId))?.frameId === frameId) {
                this.session.ownFrames.delete(Number(localId))
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
        if (object.localId !== undefined) {
            this.session.ownObjects.set(object.localId, object)
        }
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
                if (!obj) continue
                this.session.objects.delete(obj.objectId)
                if (obj.localId !== undefined && this.session.ownObjects.get(obj.localId) === obj) {
                    this.session.ownObjects.delete(obj.localId)
                }
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
 * No built-in feature uses it, but it's a convenient container with a message router for the final usages.
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
