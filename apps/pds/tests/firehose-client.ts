import { decode, decodeFirst } from "@atcute/cbor";
import { exports } from "cloudflare:workers";
import { assert, expect, vi } from "vitest";
import z from "zod";

const headerSchema = z.union([
  z.object({ op: z.literal(1), t: z.string() }),
  z.object({ op: z.literal(-1) }),
]);

export interface FirehoseFrame {
  header: z.infer<typeof headerSchema>;
  // Decoded DAG-CBOR; tests parse it with the matching Lexicon schema.
  body: ReturnType<typeof decode>;
  bodyBytes: Uint8Array;
}

// Binary WebSocket messages arrive as Blobs in the Workers test runtime.
const readFrame = async (
  data: MessageEvent["data"]
): Promise<FirehoseFrame> => {
  const bytes = new Uint8Array(await new Response(data).arrayBuffer());
  const [header, bodyBytes] = decodeFirst(bytes);
  return {
    body: decode(bodyBytes),
    bodyBytes,
    header: headerSchema.parse(header),
  };
};

/** Connect to subscribeRepos and collect every frame the PDS sends. */
export const subscribe = async (cursor?: number) => {
  const url = new URL("https://pds.test/xrpc/com.atproto.sync.subscribeRepos");
  if (cursor !== undefined) {
    url.searchParams.set("cursor", String(cursor));
  }
  const response = await exports.default.fetch(
    new Request(url, { headers: { Upgrade: "websocket" } })
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  assert.isNotNull(socket);
  // Pending reads stay in arrival order.
  const frames: Promise<FirehoseFrame>[] = [];
  let closeCode: number | undefined;
  socket.addEventListener("message", (event) => {
    frames.push(readFrame(event.data));
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  socket.accept();

  /** All frames received so far. */
  const received = () => Promise.all(frames);

  /** Wait until `count` frames match and return them in arrival order. */
  const take = (count: number, matches: (frame: FirehoseFrame) => boolean) =>
    vi.waitFor(async () => {
      const all = await received();
      const matched = all.filter(matches);
      assert.isAtLeast(matched.length, count);
      return matched.slice(0, count);
    });

  const closed = () =>
    vi.waitFor(() => {
      assert.isDefined(closeCode);
      return closeCode;
    });

  return { close: () => socket.close(), closed, received, take };
};

/** Match events about one repository, which name it `repo` or `did`. */
export const aboutRepo = (did: string) => (frame: FirehoseFrame) =>
  frame.body?.repo === did || frame.body?.did === did;
