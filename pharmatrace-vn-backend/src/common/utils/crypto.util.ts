import * as crypto from "crypto";

export class CryptoUtil {
  static generateRandomToken(length: number = 32): string {
    return crypto.randomBytes(length).toString("hex");
  }
}
