// Minimal types for archiver v8 (ESM-only). The @types/archiver package
// still ships v7 callable-factory typings, which don't match v8.
declare module "archiver" {
  import type { Transform } from "node:stream";

  export interface ArchiverOptions {
    zlib?: { level?: number };
  }

  export interface AppendOptions {
    name: string;
  }

  export class Archiver extends Transform {
    constructor(options?: ArchiverOptions);
    append(source: Buffer | NodeJS.ReadableStream | string, data: AppendOptions): this;
    finalize(): Promise<void>;
  }

  export class ZipArchive extends Archiver {}
  export class TarArchive extends Archiver {}
  export class JsonArchive extends Archiver {}
}
