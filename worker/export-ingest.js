const ZIP_MIME = "application/zip";
const MAX_BYTES = 25 * 1024 * 1024;

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function sameSecret(left, right) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let difference = av.length ^ bv.length;
  for (let index = 0; index < Math.max(av.length, bv.length); index += 1) {
    difference |= (av[index] || 0) ^ (bv[index] || 0);
  }
  return difference === 0;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "agl-recruitment-export-ingest", commit: env.BUILD_COMMIT || "unknown" });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/exports") {
      return json({ error: "not_found" }, 404);
    }

    const authorization = request.headers.get("Authorization") || "";
    if (!env.UPLOAD_TOKEN || !await sameSecret(authorization, `Bearer ${env.UPLOAD_TOKEN}`)) {
      return json({ error: "unauthorized" }, 401);
    }
    if ((request.headers.get("Content-Type") || "").split(";", 1)[0].trim() !== ZIP_MIME) {
      return json({ error: "zip_required" }, 415);
    }
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BYTES) {
      return json({ error: "archive_too_large", max_bytes: MAX_BYTES }, 413);
    }

    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return json({ error: "invalid_archive_size", max_bytes: MAX_BYTES }, bytes.byteLength > MAX_BYTES ? 413 : 400);
    }
    const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
    if (signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b) {
      return json({ error: "invalid_zip" }, 400);
    }

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const object = `candidates/${day}/${crypto.randomUUID()}.zip`;
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const stored = await env.EXPORTS.put(object, bytes, {
      httpMetadata: { contentType: ZIP_MIME },
      customMetadata: { sha256, format: "agl-recruitment-export-v1" },
    });
    return json({ ok: true, object, etag: stored?.httpEtag || stored?.etag || "", sha256 }, 201);
  },
};
