import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SessionPlatform } from "../../src/application/spi.js";

/** Real SQL with only the optional columns supported by this fixture's schema generation. */
export function sqliteFixture(legacy = false) {
  const root = mkdtempSync(join(tmpdir(), "session-sqlite-"));
  const path = join(root, "sessions.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, title TEXT DEFAULT '', directory TEXT DEFAULT '',
      time_created INTEGER DEFAULT 1, time_updated INTEGER DEFAULT 10, version TEXT DEFAULT ''
      ${legacy ? "" : ", parent_id TEXT, time_deleted INTEGER"}
    );
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT
      ${legacy ? "" : ", sequence INTEGER"});
    CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, time_created INTEGER, data TEXT);
  `);
  let id = 0;
  const fixture = {
    root,
    path,
    db,
    materializedMessages: false,
    beforeQuery: undefined as ((sql: string) => void) | undefined,
    session(sessionId: string, parent: string | null = null, title = "", deleted: number | null = null) {
      if (legacy) {
        db.prepare("INSERT INTO session (id, title) VALUES (?, ?)").run(sessionId, title);
      } else {
        db.prepare("INSERT INTO session (id, parent_id, title, time_deleted) VALUES (?, ?, ?, ?)").run(
          sessionId,
          parent,
          title,
          deleted
        );
      }
    },
    message(sessionId: string, data: unknown, time = 1, sequence = id) {
      const messageId = `message-${id++}`;
      if (legacy) {
        db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(messageId, sessionId, time, JSON.stringify(data));
      } else {
        db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
          messageId,
          sessionId,
          time,
          JSON.stringify(data),
          sequence
        );
      }
      return messageId;
    },
    part(sessionId: string, messageId: string, data: unknown, time = 1) {
      return Number(
        db
          .prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
          .run(`part-${id++}`, sessionId, messageId, time, JSON.stringify(data)).lastInsertRowid
      );
    },
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
  const platform: SessionPlatform = {
    fs: {
      async stat(file) {
        const info = statSync(file);
        return { kind: "file", size: info.size, mtimeMs: info.mtimeMs };
      },
      async list() {
        return [];
      },
      async *read() {
        yield new Uint8Array();
      }
    },
    sqlite: {
      open(file, options) {
        if (options?.readonly !== true) {
          throw new Error("SQLite session reads must be read-only");
        }
        const connection = new DatabaseSync(file, { readOnly: true });
        return {
          exec: (sql) => connection.exec(sql),
          close: () => connection.close(),
          prepare(sql) {
            fixture.beforeQuery?.(sql);
            const statement = connection.prepare(sql);
            return {
              run: (...params) => statement.run(...params),
              get: (...params) => statement.get(...params),
              all(...params) {
                if (/FROM message/i.test(sql) && /\bdata\b/.test(sql)) {
                  fixture.materializedMessages = true;
                }
                return statement.all(...params);
              }
            };
          }
        };
      }
    }
  };
  return { ...fixture, platform, controls: fixture };
}
