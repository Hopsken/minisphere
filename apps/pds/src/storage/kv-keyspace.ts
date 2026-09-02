export const pdsKvKeyspaces = {
  inviteCodes: "invite",
  reservedSigningKeys: "reserved-signing-key",
} as const;

export type PdsKvKeyspaceName =
  (typeof pdsKvKeyspaces)[keyof typeof pdsKvKeyspaces];

export class KvKeyspace {
  private readonly keyPrefix: `${PdsKvKeyspaceName}:`;
  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace, name: PdsKvKeyspaceName) {
    this.keyPrefix = `${name}:`;
    this.kv = kv;
  }

  get(id: string): Promise<string | null> {
    return this.kv.get(this.getKey(id));
  }

  put(
    id: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: KVNamespacePutOptions
  ): Promise<void> {
    return this.kv.put(this.getKey(id), value, options);
  }

  async has(id: string): Promise<boolean> {
    return (await this.get(id)) !== null;
  }

  delete(id: string): Promise<void> {
    return this.kv.delete(this.getKey(id));
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }
}
