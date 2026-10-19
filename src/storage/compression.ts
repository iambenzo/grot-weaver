export async function drain(readable: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    chunks.push(new Uint8Array(read.value));
  }
  return chunks;
}

export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export async function gzipBlob(blob: Blob): Promise<ArrayBuffer> {
  return joined(await drain(blob.stream().pipeThrough(new CompressionStream('gzip'))));
}

export async function gunzipText(compressed: ArrayBuffer): Promise<string> {
  const chunks = await drain(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')));
  return new TextDecoder().decode(joined(chunks));
}

function joined(chunks: Uint8Array[]): ArrayBuffer {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
