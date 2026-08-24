import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import { createDemoApi } from "./demo";
import type { TaskImage } from "./types";

const image: TaskImage = {
  id: "image/1",
  taskId: "task /1",
  fileName: "screen.png",
  mimeType: "image/png",
  sizeBytes: 5,
  createdAt: "2026-08-24T00:00:00.000Z",
};

function stubWindowTimers(): void {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
}

function demoApi(): ReturnType<typeof createDemoApi> {
  stubWindowTimers();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
  return createDemoApi();
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  return btoa(chunks.join(""));
}

const signatures = {
  "image/png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": new Uint8Array([0xff, 0xd8, 0xff]),
  "image/gif": new TextEncoder().encode("GIF89a"),
  "image/webp": new TextEncoder().encode("RIFF\0\0\0\0WEBP"),
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("task image API", () => {
  it("uses the image metadata, upload, content and delete routes", async () => {
    stubWindowTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [image] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(image), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi();

    await expect(api.getTaskImages(image.taskId)).resolves.toEqual([image]);
    await expect(api.uploadTaskImage(image.taskId, {
      fileName: image.fileName,
      mimeType: image.mimeType,
      dataBase64: "aGVsbG8=",
    })).resolves.toEqual(image);
    expect(api.getTaskImageContentUrl(image.taskId, image.id)).toBe(
      "/api/v1/tasks/task%20%2F1/images/image%2F1/content",
    );
    await expect(api.deleteTaskImage(image.taskId, image.id)).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/tasks/task%20%2F1/images",
      "/api/v1/tasks/task%20%2F1/images",
      "/api/v1/tasks/task%20%2F1/images/image%2F1",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("surfaces the server error message and validation detail", async () => {
    stubWindowTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "dataBase64", message: "Image must not exceed 5 MB" }],
      },
    }), { status: 400 })));
    const api = createApi();

    await expect(api.uploadTaskImage("task-1", {
      fileName: "large.png",
      mimeType: "image/png",
      dataBase64: "payload",
    })).rejects.toThrow("dataBase64: Image must not exceed 5 MB");
  });

  it("keeps demo image content in memory and removes it with its metadata", async () => {
    const api = demoApi();
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const uploaded = await api.uploadTaskImage("task-proposal", {
      fileName: "demo.png",
      mimeType: "image/png",
      dataBase64: pngBase64,
    });

    await expect(api.getTaskImages("task-proposal")).resolves.toEqual([uploaded]);
    expect(uploaded.sizeBytes).toBe(atob(pngBase64).length);
    expect(api.getTaskImageContentUrl("task-proposal", uploaded.id)).toBe(
      `data:image/png;base64,${pngBase64}`,
    );
    await api.deleteTaskImage("task-proposal", uploaded.id);
    await expect(api.getTaskImages("task-proposal")).resolves.toEqual([]);
  });
});

describe("demo task image validation", () => {
  it("accepts each supported signature and trims the stored file name", async () => {
    const api = demoApi();
    for (const [mimeType, bytes] of Object.entries(signatures)) {
      const extension = mimeType.split("/")[1];
      const uploaded = await api.uploadTaskImage("task-proposal", {
        fileName: `  valid.${extension}  `,
        mimeType,
        dataBase64: bytesToBase64(bytes),
      });
      expect(uploaded).toMatchObject({
        fileName: `valid.${extension}`,
        mimeType,
        sizeBytes: bytes.length,
      });
    }
  });

  it("rejects empty, oversized and control-character file names", async () => {
    const api = demoApi();
    const valid = {
      mimeType: "image/png",
      dataBase64: bytesToBase64(signatures["image/png"]),
    };

    await expect(api.uploadTaskImage("task-proposal", {
      ...valid,
      fileName: "   ",
    })).rejects.toThrow("File name is required");
    await expect(api.uploadTaskImage("task-proposal", {
      ...valid,
      fileName: "bad\nname.png",
    })).rejects.toThrow("control characters");
    await expect(api.uploadTaskImage("task-proposal", {
      ...valid,
      fileName: `bad${String.fromCharCode(127)}name.png`,
    })).rejects.toThrow("control characters");
    await expect(api.uploadTaskImage("task-proposal", {
      ...valid,
      fileName: "a".repeat(256),
    })).rejects.toThrow("255");
  });

  it("rejects unsupported MIME, empty or malformed base64, and invalid signatures", async () => {
    const api = demoApi();
    const pngBase64 = bytesToBase64(signatures["image/png"]);

    await expect(api.uploadTaskImage("task-proposal", {
      fileName: "vector.svg",
      mimeType: "image/svg+xml",
      dataBase64: pngBase64,
    })).rejects.toThrow("仅支持 PNG");
    await expect(api.uploadTaskImage("task-proposal", {
      fileName: "empty.png",
      mimeType: "image/png",
      dataBase64: "",
    })).rejects.toThrow("must not be empty");
    for (const dataBase64 of ["%%%", "abcde", "AB=="]) {
      await expect(api.uploadTaskImage("task-proposal", {
        fileName: "invalid.png",
        mimeType: "image/png",
        dataBase64,
      })).rejects.toThrow("valid base64");
    }
    await expect(api.uploadTaskImage("task-proposal", {
      fileName: "mismatch.jpg",
      mimeType: "image/jpeg",
      dataBase64: pngBase64,
    })).rejects.toThrow("does not match image/png");
    await expect(api.uploadTaskImage("task-proposal", {
      fileName: "fake.png",
      mimeType: "image/png",
      dataBase64: btoa("not an image"),
    })).rejects.toThrow("unsupported file signature");
  });

  it("rejects decoded content over 5 MB", async () => {
    const api = demoApi();
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set(signatures["image/png"]);

    await expect(api.uploadTaskImage("task-proposal", {
      fileName: "large.png",
      mimeType: "image/png",
      dataBase64: bytesToBase64(oversized),
    })).rejects.toThrow("must not exceed 5 MB");
  });

  it("allows 20 images per task and rejects the twenty-first", async () => {
    const api = demoApi();
    const dataBase64 = bytesToBase64(signatures["image/png"]);
    await Promise.all(Array.from({ length: 20 }, (_, index) => api.uploadTaskImage(
      "task-proposal",
      { fileName: `image-${index}.png`, mimeType: "image/png", dataBase64 },
    )));

    await expect(api.uploadTaskImage("task-proposal", {
      fileName: "image-20.png",
      mimeType: "image/png",
      dataBase64,
    })).rejects.toThrow("最多保存 20 张");
    await expect(api.getTaskImages("task-proposal")).resolves.toHaveLength(20);
  });
});
