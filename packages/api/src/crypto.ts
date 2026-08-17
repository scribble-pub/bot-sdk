export async function verifySignature(
    token: string,
    raw: string,
    headers: Headers,
): Promise<boolean> {
    const signature = headers.get("x-scribble-pub-signature")

    // The hash signature always starts with sha256= to upgrade seamlessly if needed,
    // similar to https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#validating-webhook-deliveries.
    if (!signature?.startsWith("sha256=")) return false

    const hexSig = signature.substring(7)
    const sigBytes = new Uint8Array(
        (hexSig.match(/.{1,2}/g) ?? []).map((byte) => parseInt(byte, 16)),
    )
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(token),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
    )
    return await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(raw))
}
