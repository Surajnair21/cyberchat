export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  role: 'admin' | 'member';
  public_key_jwk: JsonWebKey | null;
  disabled_at: string | null;
};

export type Room = {
  id: string;
  name: string;
  slug: string;
  description: string;
  created_by: string | null;
  created_at: string;
};

export type RoomMember = {
  room_id: string;
  user_id: string;
  role: 'owner' | 'member';
  active: boolean;
  joined_at: string;
  removed_at: string | null;
};

export type Invite = {
  id: string;
  username: string;
  code_hash: string;
  created_by: string;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type UserKeyVault = {
  user_id: string;
  salt: string;
  iv: string;
  wrapped_private_key: string;
  public_key_jwk: JsonWebKey;
  kdf: string;
  iterations: number;
};

export type RoomKeyShare = {
  id: string;
  room_id: string;
  user_id: string;
  key_version: number;
  wrapped_room_key: string;
  iv: string;
  created_by: string | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  room_id: string;
  sender_id: string;
  ciphertext: string;
  iv: string;
  key_version: number;
  created_at: string;
};

export type MessageReaction = {
  message_id: string;
  user_id: string;
  reaction: string;
  created_at: string;
};

export type DecryptedMessage = MessageRow & {
  plaintext: string;
  failed?: boolean;
};

export type CryptoIdentity = {
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
};

export type RoomKeyCache = Record<string, Record<number, CryptoKey>>;
