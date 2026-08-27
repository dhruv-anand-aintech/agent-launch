import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/export-ingest.js";

function environment() {
  const writes = [];
  return {
    writes,
    env: {
      UPLOAD_TOKEN: "test-token",
      BUILD_COMMIT: "test-commit",
      EXPORTS: {
        async put(key, bytes, options) {
          writes.push({ key, bytes: new Uint8Array(bytes), options });
          return { httpEtag: '"test-etag"' };
        },
      },
    },
  };
}

test("rejects unauthenticated uploads and exposes no object reads", async () => {
  const { env, writes } = environment();
  const unauthorized = await worker.fetch(new Request("https://agl-exports.ainorthstar.tech/v1/exports", { method: "POST", headers: { "Content-Type": "application/zip" }, body: new Uint8Array([0x50, 0x4b, 3, 4]) }), env);
  assert.equal(unauthorized.status, 401);
  const read = await worker.fetch(new Request("https://agl-exports.ainorthstar.tech/candidates/private.zip"), env);
  assert.equal(read.status, 404);
  assert.equal(writes.length, 0);
});

test("health identifies the deployed commit", async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request("https://agl-exports.ainorthstar.tech/health"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commit, "test-commit");
});

test("stores authenticated ZIPs under server-generated keys", async () => {
  const { env, writes } = environment();
  const response = await worker.fetch(new Request("https://agl-exports.ainorthstar.tech/v1/exports", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/zip" },
    body: new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]),
  }), env);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.match(payload.object, /^candidates\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.zip$/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.httpMetadata.contentType, "application/zip");
  assert.equal(writes[0].options.customMetadata.format, "agl-recruitment-export-v1");
});
