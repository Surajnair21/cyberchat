import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const hasSupabaseConfig =
  Boolean(supabaseUrl) &&
  Boolean(supabaseKey) &&
  !supabaseUrl?.includes('your-project') &&
  !supabaseKey?.includes('your-supabase');

export const initialAdminUsername =
  (import.meta.env.VITE_INITIAL_ADMIN_USERNAME as string | undefined) || 'admin';

export const supabase = createClient(
  supabaseUrl || 'https://example.supabase.co',
  supabaseKey || 'placeholder-key',
);

export function usernameToEmail(username: string) {
  return `${username.trim().toLowerCase()}@cyberchat.app`;
}
