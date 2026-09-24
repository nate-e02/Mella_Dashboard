import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

/** bcrypt silently truncates at 72 bytes; the validation schema caps passwords well below that. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A real hash of a random value, compared against on the "unknown user"
 * login path so that path costs the same as a wrong password and cannot be
 * used as a timing oracle for account enumeration.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-equalisation", SALT_ROUNDS);

export async function burnPasswordCheck(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
