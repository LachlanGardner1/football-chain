import type { UserRepository } from "../../domain/repositories";

const MIN_DISPLAY_NAME_LENGTH = 1;
const MAX_DISPLAY_NAME_LENGTH = 24;

export class UserProfileService {
  constructor(private readonly repo: UserRepository) {}

  async setDisplayName(userId: string, rawName: string): Promise<string> {
    const trimmed = rawName.trim();
    if (trimmed.length < MIN_DISPLAY_NAME_LENGTH || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new Error("INVALID_DISPLAY_NAME");
    }
    await this.repo.setDisplayName(userId, trimmed);
    return trimmed;
  }
}
