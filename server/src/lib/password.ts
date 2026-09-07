import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

// Valid cost-12 bcrypt encoding used only to perform comparison work for denied/unknown
// accounts. It is never stored as a credential and a match never authorizes anything.
export const DUMMY_PASSWORD_HASH = '$2a$12$' + '.'.repeat(53);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
