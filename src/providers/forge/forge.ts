import { Injectable } from '@angular/core';
import Forge from 'node-forge';

/*
  Generated class for the ForgeProvider provider.

  See https://angular.io/guide/dependency-injection for more info on providers
  and Angular DI.
*/
@Injectable()
export class ForgeProvider {

  public constructor() { }

  public generateSalt() {
      return Forge.util.encode64(Forge.random.getBytesSync(128));
  }

  public generateIv() {
      return Forge.util.encode64(Forge.random.getBytesSync(16));
  }

  /**
   * encrypt function we are expecting a string to be encrypted, a password to encrypt with which in our case will be the master password, a random salt and a random initialization vector. When the encryption process completes we will be returned a ciphertext string.
   *
   * @param {string} message
   * @param {string} masterPassword
   * @param {*} salt
   * @param {*} iv
   * @returns
   * @memberof ForgeProvider
   */
  // Iteration count for PBKDF2. The previous value of 4 made brute-forcing the
  // master password against a stolen encrypted wallet trivial (a modern GPU
  // can test billions of 4-iteration PBKDF2 candidates per second). OWASP's
  // 2023 guidance for PBKDF2-HMAC-SHA1 is >=1,300,000 iterations; we use
  // 210000 as a floor that balances mobile-device performance with security.
  // NOTE: this is a breaking change for any wallet encrypted under the old
  // iteration count -- see WALLET_MIGRATION.md for the required re-encryption
  // step before shipping this to users with existing wallets.
  private static readonly PBKDF2_ITERATIONS = 210000;
  // Historical iteration count used by every wallet encrypted before this fix.
  // Needed only so existing users' wallets can still be opened and migrated.
  private static readonly LEGACY_PBKDF2_ITERATIONS = 4;

  public encrypt(message: string, masterPassword: string, salt: any, iv: any) {
      let key = Forge.pkcs5.pbkdf2(masterPassword, Forge.util.decode64(salt), ForgeProvider.PBKDF2_ITERATIONS, 16);
      let cipher = Forge.cipher.createCipher('AES-CBC', key);
      cipher.start({iv: Forge.util.decode64(iv)});
      cipher.update(Forge.util.createBuffer(message));
      cipher.finish();
      return Forge.util.encode64(cipher.output.getBytes());
  }


  /**
   * decrypt function will take pretty much the same information, but instead of a plaintext message we’ll pass the ciphertext. Plaintext will be returned after a successful decryption.
   * @param {string} cipherText
   * @param {string} masterPassword
   * @param {string} salt
   * @param {string} iv
   * @returns
   * @memberof ForgeProvider
   */
  public decrypt(cipherText: string, masterPassword: string, salt: string, iv: string) {
      return this.decryptWithIterations(cipherText, masterPassword, salt, iv, ForgeProvider.PBKDF2_ITERATIONS);
  }

  private decryptWithIterations(cipherText: string, masterPassword: string, salt: string, iv: string, iterations: number) {
      let key = Forge.pkcs5.pbkdf2(masterPassword, Forge.util.decode64(salt), iterations, 16);
      let decipher = Forge.cipher.createDecipher('AES-CBC', key);
      decipher.start({iv: Forge.util.decode64(iv)});
      decipher.update(Forge.util.createBuffer(Forge.util.decode64(cipherText)));
      let ok = decipher.finish();
      if (!ok) {
        throw new Error('decrypt failed');
      }
      return decipher.output.toString();
  }

  /**
   * Decrypts data that may have been encrypted under the old, insecure
   * 4-iteration PBKDF2 parameters. Tries the current secure parameters
   * first; if that fails (wrong padding -> AES-CBC decrypt fails), retries
   * under the legacy parameters. Callers should check `migrated` and, if
   * true, re-encrypt and persist the plaintext under the new parameters
   * (via `encrypt`) so the wallet is upgraded on next open.
   */
  public decryptWithMigration(cipherText: string, masterPassword: string, salt: string, iv: string): { plaintext: string, migrated: boolean } {
      try {
        return { plaintext: this.decryptWithIterations(cipherText, masterPassword, salt, iv, ForgeProvider.PBKDF2_ITERATIONS), migrated: false };
      } catch (e) {
        // Fall back to the legacy weak parameters for wallets created before this fix.
        const plaintext = this.decryptWithIterations(cipherText, masterPassword, salt, iv, ForgeProvider.LEGACY_PBKDF2_ITERATIONS);
        return { plaintext, migrated: true };
      }
  }

}
