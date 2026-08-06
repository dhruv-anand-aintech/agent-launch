import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentMcpError } from "./errors.mjs";

const VERSION = 1;

export class SessionRegistry {
  constructor(filePath, ownerId = `owner_${randomUUID()}`) {
    this.filePath = filePath;
    this.ownerId = ownerId;
    this.records = new Map();
    this.locks = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed.version !== VERSION || !Array.isArray(parsed.sessions)) return;
      for (const record of parsed.sessions) {
        if (record?.owner === this.ownerId && typeof record.id === "string") {
          this.records.set(record.id, record);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new AgentMcpError("registry_error", "Could not read the session registry", {
          path: this.filePath,
        });
      }
    }
  }

  async persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = join(dirname(this.filePath), `.${randomUUID()}.tmp`);
    const body = JSON.stringify({ version: VERSION, sessions: [...this.records.values()] }, null, 2);
    await writeFile(temporary, `${body}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  async create(input) {
    await this.load();
    const now = new Date().toISOString();
    const record = {
      id: `asm_${randomUUID()}`,
      owner: this.ownerId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      cwd: input.cwd,
      title: input.title ?? null,
      status: input.status ?? "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    await this.persist();
    return { ...record };
  }

  async get(id) {
    await this.load();
    const record = this.records.get(id);
    if (!record) throw new AgentMcpError("session_not_found", `Unknown session: ${id}`, { sessionId: id });
    return { ...record };
  }

  async update(id, patch) {
    await this.load();
    const record = await this.get(id);
    const updated = { ...record, ...patch, updatedAt: new Date().toISOString() };
    this.records.set(id, updated);
    await this.persist();
    return { ...updated };
  }

  async remove(id) {
    await this.load();
    if (!this.records.delete(id)) {
      throw new AgentMcpError("session_not_found", `Unknown session: ${id}`, { sessionId: id });
    }
    await this.persist();
  }

  async withLock(id, operation) {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.locks.set(id, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }
}
