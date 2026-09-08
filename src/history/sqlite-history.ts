import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export type StoredMessage = { role: "user" | "assistant"; content: string };
export class SqliteHistory {
  private readonly database: Database.Database;
  constructor(path: string) { mkdirSync(dirname(path), { recursive: true }); this.database = new Database(path); this.database.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_id ON messages (conversation_id, id);"); }
  recent(conversationId: string, limit: number): StoredMessage[] { return (this.database.prepare("SELECT role, content FROM (SELECT role, content, id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC").all(conversationId, limit) as StoredMessage[]); }
  saveTurn(conversationId: string, user: string, assistant: string): void { const insert = this.database.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)"); this.database.transaction(() => { insert.run(conversationId, "user", user); insert.run(conversationId, "assistant", assistant); })(); }
  clear(conversationId: string): void { this.database.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId); }
  close(): void { this.database.close(); }
}
