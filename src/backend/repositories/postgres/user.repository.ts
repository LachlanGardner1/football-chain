import type { UserRepository } from "../../domain/repositories";
import { pgPool } from "./db";

export class PgUserRepository implements UserRepository {
  async setDisplayName(userId: string, displayName: string): Promise<void> {
    await pgPool.query(
      `INSERT INTO users (id, username)
       VALUES ($1::uuid, $2)
       ON CONFLICT (id) DO NOTHING`,
      [userId, `user-${userId.slice(0, 8)}`],
    );

    await pgPool.query(`UPDATE users SET display_name = $2, updated_at = NOW() WHERE id = $1::uuid`, [
      userId,
      displayName,
    ]);
  }
}
