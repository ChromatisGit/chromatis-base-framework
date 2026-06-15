declare module "@sqlite.org/sqlite-wasm" {
  export interface Sqlite3InitOptions {
    print?: (msg: string) => void;
    printErr?: (msg: string) => void;
  }

  export default function sqlite3InitModule(
    options?: Sqlite3InitOptions,
  ): Promise<unknown>;
}
