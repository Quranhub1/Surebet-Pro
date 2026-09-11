import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase] Warning: Supabase credentials were not found in the backend environment.');
}

// Dedicated Supabase client for the backend scanner engine.
export const supabase = createClient(supabaseUrl, supabaseKey);
