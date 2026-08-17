import { describe, it, expect } from "vitest"
import type {
    ScratchpadSessionMetaMessage,
    ScratchpadLayerMessage,
    ScratchpadObjectMessage,
} from "@scribble-pub/api"
import { RoomState, ScratchpadState } from "../src/state.js"

const meta = (currentSession: number, eventId = 1): ScratchpadSessionMetaMessage => ({
    type: "sp.sessionMeta",
    currentSession,
    eventId,
    seqId: 100,
    canvasWidth: 1000,
    canvasHeight: 700,
})

const layer = (layerId: number, frames: number[], lastEventId: number): ScratchpadLayerMessage => ({
    type: "sp.layer",
    layerId,
    frames,
    lastEventId,
})

const object = (objectId: number, frameId: number, eventId: number): ScratchpadObjectMessage => ({
    type: "sp.object",
    objectId,
    frameId,
    eventId,
    objectType: "line.floats",
    rgba: 0xff0000ff,
    lineWidth: 5,
    points: [0, 0, 10, 10],
})

describe("ScratchpadState", () => {
    it("should process session meta and reset state", () => {
        const state = ScratchpadState.fromMessages([
            meta(1),
            layer(10, [100], 2),
            { type: "sp.layerOrder", order: [10], lastEventId: 3 },
            object(1000, 100, 4),
        ])

        expect(state.layers.size).toBe(1)
        expect(state.layerOrder).toEqual([10])
        expect(state.objects.size).toBe(1)
        expect(state.lastEventId).toBe(4)

        state.applyMessage(meta(2))

        // State should be wiped, including the event cursor
        expect(state.sessionMeta?.currentSession).toBe(2)
        expect(state.layers.size).toBe(0)
        expect(state.layerOrder).toEqual([])
        expect(state.objects.size).toBe(0)
        expect(state.frames.size).toBe(0)
        expect(state.lastEventId).toBe(1)
    })

    it("should let layers own frame lifetime", () => {
        const state = ScratchpadState.fromMessages([meta(1), layer(1, [100, 101], 2)])

        // Frames exist as soon as the layer declares them, even while empty
        expect(state.frames.size).toBe(2)
        expect(state.frames.get(100)?.layerId).toBe(1)
        expect(state.frames.get(101)?.objects).toEqual([])
    })

    it("should drop objects for undeclared frames", () => {
        const state = ScratchpadState.fromMessages([meta(1), object(1000, 999, 5)])

        expect(state.objects.size).toBe(0)
        expect(state.frames.size).toBe(0)
        expect(state.lastEventId).toBe(1)
    })

    it("should garbage collect objects when their frame is removed", () => {
        const state = ScratchpadState.fromMessages([
            meta(1),
            layer(1, [100, 101], 2),
            object(1000, 100, 3),
            object(1001, 101, 4),
        ])

        expect(state.objects.size).toBe(2)
        expect(state.frames.get(101)?.objects[0]?.objectId).toBe(1001)

        state.applyMessage(layer(1, [100], 5))

        expect(state.objects.has(1000)).toBe(true)
        expect(state.objects.has(1001)).toBe(false)
        expect(state.frames.has(101)).toBe(false)
    })

    it("should prune a deleted layer from the layer order", () => {
        const state = ScratchpadState.fromMessages([
            meta(1),
            layer(1, [100], 2),
            layer(2, [200], 3),
            { type: "sp.layerOrder", order: [1, 2], lastEventId: 4 },
            object(1000, 200, 5),
        ])

        state.applyMessage(layer(2, [], 6))

        expect(state.layers.size).toBe(1)
        expect(state.layerOrder).toEqual([1])
        expect(state.objects.size).toBe(0)
        expect(state.frames.has(200)).toBe(false)
    })

    it("should never let a frame and the object index disagree", () => {
        const state = ScratchpadState.fromMessages([
            meta(1),
            layer(1, [100], 2),
            object(1000, 100, 3),
        ])

        state.applyMessage({ ...object(1000, 100, 7), lineWidth: 12 })

        // One objectId is one object, in both views of it.
        expect(state.objects.size).toBe(1)
        expect(state.frames.get(100)?.objects).toHaveLength(1)
        expect(state.objects.get(1000)?.lineWidth).toBe(12)
        expect(state.frames.get(100)?.objects[0]?.lineWidth).toBe(12)
        expect(state.lastEventId).toBe(7)
    })

    it("should take the cursor from the closing sp.lastEventId", () => {
        const state = ScratchpadState.fromMessages([
            meta(1),
            layer(1, [100], 2),
            object(1000, 100, 3),
            // Ahead of every message, e.g. because an object was erased
            { type: "sp.lastEventId", lastEventId: 12 },
        ])

        expect(state.objects.size).toBe(1)
        expect(state.lastEventId).toBe(12)
    })

    it("should track the event cursor as a running max", () => {
        const state = ScratchpadState.fromMessages([
            meta(1, 9),
            layer(1, [100], 4),
            // Snapshots hardcode -1 for the layer order
            { type: "sp.layerOrder", order: [1], lastEventId: -1 },
        ])

        expect(state.lastEventId).toBe(9)
    })
})

describe("RoomState", () => {
    it("should route messages to the scratchpad, which keeps its own cursor", () => {
        const state = RoomState.fromMessages([
            meta(1),
            layer(1, [100], 2),
            object(1000, 100, 3),
            { type: "sp.lastEventId", lastEventId: 12 },
        ])

        expect(state.scratchpad.objects.size).toBe(1)
        expect(state.scratchpad.layers.size).toBe(1)
        expect(state.scratchpad.lastEventId).toBe(12)
    })

    it("should keep applying onto an existing state", () => {
        const state = RoomState.fromMessages([meta(1), layer(1, [100], 2)])
        state.applyMessage(object(1000, 100, 3))

        expect(state.scratchpad.objects.size).toBe(1)
        expect(state.scratchpad.lastEventId).toBe(3)
    })
})
