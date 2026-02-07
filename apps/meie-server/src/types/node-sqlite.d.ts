// Minimal TypeScript declarations for Node's experimental `node:sqlite` module.
// This repo pins @types/node to v20, which doesn't include these types.
// If you upgrade @types/node to a version that includes `node:sqlite`, you can delete this file.

declare module 'node:sqlite' {
  export class StatementSync {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): { changes: number; lastInsertRowid: number };
  }

  export class DatabaseSync {
    constructor(filename: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}

