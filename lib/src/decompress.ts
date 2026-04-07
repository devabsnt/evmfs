export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  // Browser: use DecompressionStream API
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(data as unknown as BufferSource);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  // Node.js: use built-in zlib
  const { gunzipSync } = await import("node:zlib");
  return new Uint8Array(gunzipSync(data));
}

export async function tryGunzip(data: Uint8Array): Promise<Uint8Array> {
  // Gzip magic bytes: 0x1f 0x8b
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      return await gunzip(data);
    } catch {
      return data;
    }
  }
  return data;
}
