import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://szcsbbjpzuzguwxjodjq.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Y3NiYmpwenV6Z3V3eGpvZGpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTgxMDgsImV4cCI6MjA4NjA3NDEwOH0.UWUVaaH0y8OsAwqkeDSrrSrM8xAvvVYCjVU8ujJEu8I';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);