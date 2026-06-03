import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

export type CaptureOutboxStatus = "queued" | "delivered";

type CaptureOutboxBase = {
  id: string;
  status: CaptureOutboxStatus;
  createdAt: string;
  updatedAt: string;
  deliveryAttempts: number;
  lastDeliveredAt?: string;
  lastError?: string;
};

export type CaptureUrlOutboxItem = CaptureOutboxBase & {
  kind: "url";
  url: string;
};

export type CaptureFileOutboxItem = CaptureOutboxBase & {
  kind: "file";
  name: string;
  mimeType: string;
  filePath: string;
  size: number;
};

export type CaptureOutboxItem =
  | CaptureUrlOutboxItem
  | CaptureFileOutboxItem;

export type PublicCaptureOutboxItem =
  | CaptureUrlOutboxItem
  | Omit<CaptureFileOutboxItem, "filePath">;

type CaptureOutboxIndex = {
  version: 1;
  items: CaptureOutboxItem[];
};

const INDEX_FILE = "index.json";

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return crypto.randomUUID();
}

function publicItem(item: CaptureOutboxItem): PublicCaptureOutboxItem {
  if (item.kind === "url") return { ...item };
  const { filePath: _filePath, ...safeItem } = item;
  return { ...safeItem };
}

export class CaptureOutbox {
  private readonly rootDir: string;
  private readonly filesDir: string;
  private readonly indexPath: string;
  private items: CaptureOutboxItem[] = [];

  constructor(userDataPath: string) {
    this.rootDir = path.join(userDataPath, "capture-outbox");
    this.filesDir = path.join(this.rootDir, "files");
    this.indexPath = path.join(this.rootDir, INDEX_FILE);
  }

  async load() {
    await fs.mkdir(this.filesDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as CaptureOutboxIndex;
      this.items = Array.isArray(parsed.items)
        ? parsed.items.map((item) => ({
            ...item,
            deliveryAttempts: item.deliveryAttempts ?? 0,
          }))
        : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[oneaction] failed to load capture outbox:", err);
      }
      this.items = [];
      await this.save();
    }
  }

  list(): PublicCaptureOutboxItem[] {
    return this.items.map(publicItem);
  }

  queued(): CaptureOutboxItem[] {
    return this.items
      .filter((item) => item.status === "queued")
      .map((item) => ({ ...item }));
  }

  get(id: string): CaptureOutboxItem | null {
    const item = this.items.find((candidate) => candidate.id === id);
    return item ? { ...item } : null;
  }

  async enqueueUrl(url: string): Promise<CaptureUrlOutboxItem> {
    const timestamp = nowIso();
    const item: CaptureUrlOutboxItem = {
      id: makeId(),
      kind: "url",
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      deliveryAttempts: 0,
      url,
    };
    this.items.push(item);
    await this.save();
    return { ...item };
  }

  async enqueueFile(
    sourcePath: string,
    mimeType: string,
  ): Promise<CaptureFileOutboxItem> {
    const id = makeId();
    const ext = path.extname(sourcePath).toLowerCase();
    const destinationPath = path.join(this.filesDir, `${id}${ext}`);
    await fs.copyFile(sourcePath, destinationPath);
    const stat = await fs.stat(destinationPath);
    const timestamp = nowIso();
    const item: CaptureFileOutboxItem = {
      id,
      kind: "file",
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      deliveryAttempts: 0,
      name: path.basename(sourcePath),
      mimeType,
      filePath: destinationPath,
      size: stat.size,
    };
    this.items.push(item);
    await this.save();
    return { ...item };
  }

  async markDelivered(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const timestamp = nowIso();
    item.status = "delivered";
    item.updatedAt = timestamp;
    item.lastDeliveredAt = timestamp;
    item.lastError = undefined;
    item.deliveryAttempts = (item.deliveryAttempts ?? 0) + 1;
    await this.save();
  }

  async markDeliveryFailed(id: string, error: unknown) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    item.status = "queued";
    item.updatedAt = nowIso();
    item.lastError =
      error instanceof Error ? error.message : "Failed to deliver capture";
    item.deliveryAttempts = (item.deliveryAttempts ?? 0) + 1;
    await this.save();
  }

  async remove(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    this.items = this.items.filter((candidate) => candidate.id !== id);
    await this.save();
    if (item.kind === "file") {
      await fs.rm(item.filePath, { force: true });
    }
  }

  async readFileBytes(item: CaptureFileOutboxItem): Promise<Uint8Array> {
    const buffer = await fs.readFile(item.filePath);
    return new Uint8Array(buffer);
  }

  private async save() {
    await fs.mkdir(this.rootDir, { recursive: true });
    const index: CaptureOutboxIndex = {
      version: 1,
      items: this.items,
    };
    const tempPath = `${this.indexPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(index, null, 2));
    await fs.rename(tempPath, this.indexPath);
  }
}
